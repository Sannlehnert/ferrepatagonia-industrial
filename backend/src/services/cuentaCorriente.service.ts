import { createHmac, timingSafeEqual } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { inTransaction } from '../config/database.config';
import { env } from '../config/env.config';
import { readAccountSummary, readAccountMovements, readAccountDueDates } from './cuentaCorriente.read';
import {
    calcularEstadoCuenta,
    findCuentaByClienteId
} from '../repositories/cuentaCorriente.repository';
import type {
    AdminCursorPayload,
    Consulta,
    CursorClaveMovimiento,
    CursorClaveVencimiento,
    CursorPayload,
    Detalle,
    InstanteUTC,
    Movimiento,
    Vencimiento
} from '../dtos/cuentaCorriente/cuentaCorriente.dto';

const getSecretKey = (): string => env.jwtSecret || 'ferrepatagonia_cursor_signature_secret';
export const CURSOR_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_CURSOR_LENGTH = 1024;

interface AccesoClienteResuelto {
    estadoAcceso: 'PERMITIDO' | 'SIN_CUENTA';
    clienteId: number;
}

function createServiceError(message: string, code: string): Error & { code: string } {
    const err = new Error(message) as Error & { code: string };
    err.code = code;
    return err;
}

export function signCursor(payload: CursorPayload | AdminCursorPayload): string {
    const serialized = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', getSecretKey()).update(serialized).digest('base64url');
    return `${serialized}.${signature}`;
}

export function decodeSignedAccountCursor(cursorStr: string): object {
    if (!cursorStr || typeof cursorStr !== 'string' || cursorStr.length > MAX_CURSOR_LENGTH) {
        throw createServiceError('Cursor inválido.', 'CONSULTA_INVALIDA');
    }

    const parts = cursorStr.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw createServiceError('Cursor inválido.', 'CONSULTA_INVALIDA');
    }

    const [serialized, signature] = parts;
    const expectedSig = createHmac('sha256', getSecretKey()).update(serialized).digest('base64url');

    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        throw createServiceError('Cursor adulterado.', 'CONSULTA_INVALIDA');
    }

    let payload: unknown;
    try {
        payload = JSON.parse(Buffer.from(serialized, 'base64url').toString('utf8'));
    } catch {
        throw createServiceError('Cursor malformado.', 'CONSULTA_INVALIDA');
    }

    if (!payload || typeof payload !== 'object' || 'offset' in payload) {
        throw createServiceError('Estructura de cursor inválida.', 'CONSULTA_INVALIDA');
    }

    return payload;
}

export function verifyAndDecodeCursor(
    cursorStr: string,
    expectedUserId: number,
    expectedScope: 'movimientos' | 'vencimientos'
): CursorPayload {
    const payload = decodeSignedAccountCursor(cursorStr);
    const p = payload as Partial<CursorPayload>;
    if (
        p.userId !== expectedUserId ||
        p.rol !== 'CLIENTE' ||
        p.scope !== expectedScope ||
        typeof p.cuentaId !== 'number' ||
        !Number.isInteger(p.cuentaId) ||
        p.cuentaId <= 0 ||
        typeof p.corte !== 'string' ||
        Number.isNaN(Date.parse(p.corte)) ||
        typeof p.revision !== 'string' ||
        p.revision.trim().length === 0 ||
        typeof p.exp !== 'number' ||
        !Number.isFinite(p.exp) ||
        !p.ultimaClave ||
        typeof p.ultimaClave !== 'object'
    ) {
        throw createServiceError('Campos de cursor inválidos.', 'CONSULTA_INVALIDA');
    }

    if (expectedScope === 'movimientos') {
        const clave = p.ultimaClave as Partial<CursorClaveMovimiento>;
        if (
            typeof clave.fechaOperacion !== 'string' ||
            Number.isNaN(Date.parse(clave.fechaOperacion)) ||
            typeof clave.id !== 'number' ||
            !Number.isInteger(clave.id) ||
            clave.id <= 0
        ) {
            throw createServiceError('Clave de cursor de movimientos inválida.', 'CONSULTA_INVALIDA');
        }
    } else {
        const clave = p.ultimaClave as Partial<CursorClaveVencimiento>;
        if (
            typeof clave.venceEl !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(clave.venceEl) ||
            typeof clave.id !== 'number' ||
            !Number.isInteger(clave.id) ||
            clave.id <= 0
        ) {
            throw createServiceError('Clave de cursor de vencimientos inválida.', 'CONSULTA_INVALIDA');
        }
    }

    return p as CursorPayload;
}

async function resolveClienteAcceso(manager: EntityManager, userId: number): Promise<AccesoClienteResuelto> {
    const [user] = await manager.query(
        'SELECT id_usuario, id_cliente, rol, activo FROM USUARIO WHERE id_usuario = ?',
        [userId]
    );
    if (!user || Number(user.activo) !== 1) {
        throw createServiceError('Usuario inactivo o inexistente.', 'USUARIO_INACTIVO');
    }
    if (user.rol !== 'CLIENTE' || !user.id_cliente) {
        throw createServiceError('El usuario no posee un vínculo de cliente válido.', 'CLIENTE_NO_AUTORIZADO');
    }

    const [client] = await manager.query(
        'SELECT id_cliente, activo, tipo_cliente, estado_aprobacion_empresa FROM CLIENTE WHERE id_cliente = ?',
        [user.id_cliente]
    );
    if (!client || Number(client.activo) !== 1) {
        throw createServiceError('El cliente asociado se encuentra inactivo.', 'CLIENTE_INACTIVO');
    }

    // H03: Todo cliente PARTICULAR activo recibe SIN_CUENTA aunque tenga fila asociada en CUENTA_CORRIENTE
    if (client.tipo_cliente !== 'EMPRESA') {
        return { estadoAcceso: 'SIN_CUENTA', clienteId: Number(client.id_cliente) };
    }

    return { estadoAcceso: 'PERMITIDO', clienteId: Number(client.id_cliente) };
}

export async function getConsultaCuenta(userId: number): Promise<Consulta> {
    const corte: InstanteUTC = new Date().toISOString();
    return inTransaction(async (manager) => {
        const acceso = await resolveClienteAcceso(manager, userId);
        if (acceso.estadoAcceso === 'SIN_CUENTA') {
            return { corte, revision: 'rev-0', estado: 'SIN_CUENTA' };
        }

        const cuenta = await findCuentaByClienteId(acceso.clienteId, manager);
        if (!cuenta) {
            return { corte, revision: 'rev-0', estado: 'SIN_CUENTA' };
        }

        const estado = await calcularEstadoCuenta(cuenta.id_cuenta_corriente, manager);
        if (!estado) {
            return { corte, revision: 'rev-0', estado: 'SIN_CUENTA' };
        }

        const resumen = await readAccountSummary(manager, estado, corte);
        return { corte, revision: estado.revision, ...resumen };
    }, { isolation: 'REPEATABLE READ' });
}

export async function getMovimientosCuenta(
    userId: number,
    limite: number,
    cursorParam?: string
): Promise<Detalle<Movimiento>> {
    const ahoraUTC = new Date().toISOString();
    return inTransaction(async (manager) => {
        // H02: Revalidar autorización y estado activo antes de procesar página
        const acceso = await resolveClienteAcceso(manager, userId);

        let payload: CursorPayload | undefined;
        if (cursorParam !== undefined) {
            payload = verifyAndDecodeCursor(cursorParam, userId, 'movimientos');
        }

        if (acceso.estadoAcceso === 'SIN_CUENTA') {
            return { corte: ahoraUTC, revision: 'rev-0', estado: 'SIN_CUENTA' };
        }

        const cuenta = await findCuentaByClienteId(acceso.clienteId, manager);
        if (!cuenta) {
            return { corte: ahoraUTC, revision: 'rev-0', estado: 'SIN_CUENTA' };
        }

        const estado = await calcularEstadoCuenta(cuenta.id_cuenta_corriente, manager);
        if (!estado) {
            return { corte: ahoraUTC, revision: 'rev-0', estado: 'SIN_CUENTA' };
        }

        let corte = ahoraUTC;

        if (payload) {
            if (payload.cuentaId !== cuenta.id_cuenta_corriente) {
                throw createServiceError('El cursor no pertenece a la cuenta del cliente.', 'CONSULTA_INVALIDA');
            }
            if (payload.revision !== estado.revision || Date.now() > payload.exp) {
                throw createServiceError('Revisión de cuenta desactualizada o cursor expirado.', 'CONSULTA_DESACTUALIZADA');
            }
            corte = payload.corte;
        }

        const movsWithBalance = await readAccountMovements(manager, estado);

        // H04: Paginación por clave (keyset) sin offset
        let filteredMovs = movsWithBalance;
        if (payload) {
            const clave = payload.ultimaClave as CursorClaveMovimiento;
            const cursorTimeMs = Date.parse(clave.fechaOperacion);
            const cursorId = clave.id;
            filteredMovs = movsWithBalance.filter((item) => {
                const itemTimeMs = Date.parse(item.fechaOperacion);
                if (itemTimeMs < cursorTimeMs) return true;
                if (itemTimeMs === cursorTimeMs && Number(item.id) < cursorId) return true;
                return false;
            });
        }

        const items = filteredMovs.slice(0, limite);
        const hasMore = filteredMovs.length > limite;
        const lastItem = items.length > 0 ? items[items.length - 1] : null;

        const siguienteCursor = (hasMore && lastItem)
            ? signCursor({
                userId,
                rol: 'CLIENTE',
                cuentaId: cuenta.id_cuenta_corriente,
                scope: 'movimientos',
                filtros: {},
                corte,
                revision: estado.revision,
                exp: payload ? payload.exp : Date.parse(corte) + CURSOR_TTL_MS,
                ultimaClave: {
                    fechaEfectiva: lastItem.fechaOperacion,
                    fechaOperacion: lastItem.fechaOperacion,
                    id: Number(lastItem.id)
                }
            })
            : null;

        return {
            corte,
            revision: estado.revision,
            estado: estado.habilitada ? 'HABILITADA' : 'INHABILITADA',
            cobertura: estado.cobertura,
            items,
            siguienteCursor
        };
    }, { isolation: 'REPEATABLE READ' });
}

export async function getVencimientosCuenta(
    userId: number,
    limite: number,
    cursorParam?: string
): Promise<Detalle<Vencimiento>> {
    const ahoraUTC = new Date().toISOString();
    return inTransaction(async (manager) => {
        // H02: Revalidar autorización y estado activo antes de procesar página
        const acceso = await resolveClienteAcceso(manager, userId);

        let payload: CursorPayload | undefined;
        if (cursorParam !== undefined) {
            payload = verifyAndDecodeCursor(cursorParam, userId, 'vencimientos');
        }

        if (acceso.estadoAcceso === 'SIN_CUENTA') {
            return { corte: ahoraUTC, revision: 'rev-0', estado: 'SIN_CUENTA' };
        }

        const cuenta = await findCuentaByClienteId(acceso.clienteId, manager);
        if (!cuenta) {
            return { corte: ahoraUTC, revision: 'rev-0', estado: 'SIN_CUENTA' };
        }

        const estado = await calcularEstadoCuenta(cuenta.id_cuenta_corriente, manager);
        if (!estado) {
            return { corte: ahoraUTC, revision: 'rev-0', estado: 'SIN_CUENTA' };
        }

        let corte = ahoraUTC;

        if (payload) {
            if (payload.cuentaId !== cuenta.id_cuenta_corriente) {
                throw createServiceError('El cursor no pertenece a la cuenta del cliente.', 'CONSULTA_INVALIDA');
            }
            if (payload.revision !== estado.revision || Date.now() > payload.exp) {
                throw createServiceError('Revisión de cuenta desactualizada o cursor expirado.', 'CONSULTA_DESACTUALIZADA');
            }
            corte = payload.corte;
        }

        const allItems = await readAccountDueDates(manager, estado, corte);

        // H04: Paginación por clave (keyset) sin offset
        let filteredItems = allItems;
        if (payload) {
            const clave = payload.ultimaClave as CursorClaveVencimiento;
            const cursorVenceEl = clave.venceEl;
            const cursorId = clave.id;
            filteredItems = allItems.filter((item) => {
                if (item.venceEl > cursorVenceEl) return true;
                if (item.venceEl === cursorVenceEl && Number(item.movimientoId) > cursorId) return true;
                return false;
            });
        }

        const items = filteredItems.slice(0, limite);
        const hasMore = filteredItems.length > limite;
        const lastItem = items.length > 0 ? items[items.length - 1] : null;

        const siguienteCursor = (hasMore && lastItem)
            ? signCursor({
                userId,
                rol: 'CLIENTE',
                cuentaId: cuenta.id_cuenta_corriente,
                scope: 'vencimientos',
                filtros: {},
                corte,
                revision: estado.revision,
                exp: payload ? payload.exp : Date.parse(corte) + CURSOR_TTL_MS,
                ultimaClave: {
                    fechaCivil: lastItem.venceEl,
                    venceEl: lastItem.venceEl,
                    id: Number(lastItem.movimientoId),
                    movimientoId: Number(lastItem.movimientoId)
                }
            })
            : null;

        return {
            corte,
            revision: estado.revision,
            estado: estado.habilitada ? 'HABILITADA' : 'INHABILITADA',
            cobertura: estado.cobertura,
            items,
            siguienteCursor
        };
    }, { isolation: 'REPEATABLE READ' });
}