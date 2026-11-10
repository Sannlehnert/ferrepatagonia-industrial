import type { EntityManager } from 'typeorm';
import { inTransaction } from '../config/database.config';
import { notifyAfterCommit, type NotifyCommittedChange } from '../realtime/committed-change';
import {
    createCart, findCartId, findCartItem, findCartItems, lockCartClient, lockCartProduct, removeCartItem, saveCartItem
} from '../repositories/cart.repository';
import { MariaDbPricingSource } from '../repositories/pricing.source';
import type { AuthContext } from '../types/auth';
import { PricingError } from './pricing/money';
import { PricingService, sumAmounts } from './pricing/pricing.service';
import type { PriceLine } from './pricing/pricing.types';
import { CartError, CartLockStatementTimeout, cartConflict, hasDatabaseError } from './cart.errors';

export type CartMutation =
    | { type: 'add' | 'update'; productoId: number; cantidad: number }
    | { type: 'remove'; productoId: number };

type CartPrice = Pick<PriceLine, 'estadoPrecio' | 'precioComprable' | 'precioUnitarioUSD' | 'subtotalUSD'
    | 'descuentoAplicado' | 'origenDescuento'> & { datosSinteticos: boolean };

function pricing(manager: EntityManager) {
    return new PricingService(new MariaDbPricingSource(undefined, manager));
}

async function withClientCart<T>(auth: AuthContext, signal: AbortSignal,
    work: (manager: EntityManager, clientId: number, cartId: number | null) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        let workFailure: { error: unknown } | undefined;
        try {
            return await inTransaction(async manager => {
                try {
                    const clientId = await lockCartClient(manager, auth.id);
                    if (clientId === null) throw new CartError('NO_AUTORIZADO', 403, 'Cuenta de cliente no habilitada.');
                    const cartId = await findCartId(manager, clientId);
                    signal.throwIfAborted();
                    const result = await work(manager, clientId, cartId);
                    signal.throwIfAborted();
                    return result;
                } catch (error) {
                    workFailure = { error };
                    throw error;
                }
            }, { isolation: 'REPEATABLE READ', lockWaitSeconds: 2 });
        } catch (error) {
            // Classify only failures returned from transaction work after rollback.
            // START/COMMIT/uncertain rollback and connection release errors are separate.
            if (!workFailure || error !== workFailure.error) throw error;
            if (error instanceof CartLockStatementTimeout || hasDatabaseError(error, 'ER_LOCK_WAIT_TIMEOUT', 1205)) {
                throw cartConflict();
            }
            if (!hasDatabaseError(error, 'ER_DUP_ENTRY', 1062) && !hasDatabaseError(error, 'ER_LOCK_DEADLOCK', 1213)) {
                throw error;
            }
            if (attempt === 1) throw cartConflict();
        }
    }
}

export function getAuthenticatedClientCart(auth: AuthContext, signal: AbortSignal) {
    return withClientCart(auth, signal, async (manager, clientId, existingId) => {
        const idCarrito = existingId ?? await createCart(manager, clientId);
        const rawItems = await findCartItems(manager, idCarrito);
        const items = rawItems.map(({ producto_activo, categoria_activa, ...item }) => {
            const active = producto_activo === 1 && categoria_activa === 1;
            const reason = !active ? 'INACTIVO' as const : item.stock < item.cantidad ? 'SIN_STOCK' as const : undefined;
            return { ...item, disponible: reason === undefined, motivo_no_disponible: reason,
                precio: null as CartPrice | null, error_precio: null as string | null };
        });

        const activeItems = items.filter(item => item.motivo_no_disponible !== 'INACTIVO');
        const at = new Date();
        const service = pricing(manager);
        // Keep carts already persisted with more than 100 lines readable on one snapshot.
        for (let start = 0; start < activeItems.length; start += 100) {
            const batch = activeItems.slice(start, start + 100);
            try {
                const lines = await service.quoteCartLines(
                    batch.map(item => ({ productoId: item.id_producto, cantidad: item.cantidad })), auth, at);
                for (const item of batch) {
                    const line = lines.get(item.id_producto)!;
                    if (typeof line === 'string') item.error_precio = line;
                    else item.precio = {
                        estadoPrecio: line.estadoPrecio, precioComprable: line.precioComprable,
                        precioUnitarioUSD: line.precioUnitarioUSD, subtotalUSD: line.subtotalUSD,
                        descuentoAplicado: line.descuentoAplicado, origenDescuento: line.origenDescuento,
                        datosSinteticos: line.evidenciaBaseUSD?.synthetic ?? false,
                    };
                }
            } catch (error) {
                if (!(error instanceof PricingError) || error.status !== 422) throw error;
                for (const item of batch) item.error_precio = error.code;
            }
        }

        let totalUSD: string | null = null;
        let estadoTotal: 'DEFINIDO' | 'ITEMS_INCOMPATIBLES' | 'IMPORTE_FUERA_DE_RANGO' = 'ITEMS_INCOMPATIBLES';
        if (items.every(item => item.disponible && item.precio?.precioComprable)) {
            try {
                totalUSD = sumAmounts(items.map(item => item.precio!.subtotalUSD!));
                estadoTotal = 'DEFINIDO';
            } catch (error) {
                if (!(error instanceof PricingError) || error.code !== 'IMPORTE_FUERA_DE_RANGO') throw error;
                estadoTotal = 'IMPORTE_FUERA_DE_RANGO';
            }
        }

        return {
            id_carrito: idCarrito, items,
            total_items: activeItems.reduce((total, item) => total + item.cantidad, 0),
            tiene_incompatibles: items.some(item => !item.disponible),
            moneda: 'USD', regla: 'FER17-v1', ivaIncluido: true, totalUSD, estado_total: estadoTotal,
        };
    });
}

export async function mutateAuthenticatedClientCart(
    auth: AuthContext, command: CartMutation, signal: AbortSignal, notify?: NotifyCommittedChange,
): Promise<void> {
    const changedClient = await withClientCart(auth, signal, async (manager, clientId, cartId) => {
        const { productoId } = command;
        if (command.type === 'remove') {
            return cartId !== null && await removeCartItem(manager, cartId, productoId) ? clientId : null;
        }

        const existing = cartId === null ? undefined : await findCartItem(manager, cartId, productoId);
        if (command.type === 'update' && !existing) {
            throw new CartError('ITEM_INEXISTENTE', 404, 'El producto no está en el carrito.');
        }

        // These are current locking reads. Establish the pricing snapshot only after acquiring them.
        const product = await lockCartProduct(manager, productoId);
        if (!product) throw new CartError('PRODUCTO_INEXISTENTE', 404, 'El producto no existe.');
        if (product.producto_activo !== 1 || product.categoria_activa !== 1) {
            throw new CartError('PRODUCTO_INACTIVO', 422, 'El producto no está disponible.');
        }
        const { cantidad } = command;
        if (cantidad > product.stock) {
            throw new CartError('STOCK_INSUFICIENTE', 422, 'La cantidad supera el stock disponible.');
        }

        const quote = await pricing(manager).resolve({ moneda: 'USD', productos: [{ productoId, cantidad }] }, 'CLIENTE', auth);
        const line = quote.productos[0];
        if (!line.precioComprable) throw new CartError(line.estadoPrecio, 422, 'El producto no tiene un precio comprable.');

        const idCarrito = cartId ?? await createCart(manager, clientId);
        return await saveCartItem(manager, idCarrito, productoId, cantidad, existing) ? clientId : null;
    });
    if (changedClient !== null) notifyAfterCommit(notify, { kind: 'cart', clientId: changedClient });
}
