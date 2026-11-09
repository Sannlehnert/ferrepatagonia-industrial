import { createHmac, timingSafeEqual } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { inTransaction } from '../config/database.config';
import { env } from '../config/env.config';
import { civilDate } from './pricing/pricing.quote';
import {
    calcularEstadoCuenta,
    consultarVencimientos,
    findCuentaByClienteId,
    fromCents,
    toCents
} from '../repositories/cuentaCorriente.repository';
import type {
    Consulta,
    CursorClaveMovimiento,
    CursorClaveVencimiento,
    CursorPayload,
    Decimal,
    Detalle,
    InstanteUTC,
    Movimiento,
    Resumen,
    Vencimiento
} from '../dtos/cuentaCorriente/cuentaCorriente.dto';

const getSecretKey = (): string => env.jwtSecret || 'ferrepatagonia_cursor_signature_secret';
const CURSOR_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CURSOR_LENGTH = 1024;

interface AccesoClienteResuelto {
    estadoAcceso: 'PERMITIDO' | 'SIN_CUENTA';
    clienteId: number;
}

function createServiceError(message: string, code: string): Error & { code: string } {
    const err = new Error(message) as Error & { code: string };
    err.code = code;
    return err;
}

export function signCursor(payload: CursorPayload): string {
    const serialized = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', getSecretKey()).update(serialized).digest('base64url');
    return `${serialized}.${signature}`;
}

export function verifyAndDecodeCursor(
    cursorStr: string,
    expectedUserId: number,
    expectedScope: 'movimientos' | 'vencimientos'
): CursorPayload {
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

function diffCivilDays(todayCivil: string, targetCivil: string): number {
    const [y1, m1, d1] = todayCivil.split('-').map(Number);
    const [y2, m2, d2] = targetCivil.split('-').map(Number);
    const utc1 = Date.UTC(y1, m1 - 1, d1);
    const utc2 = Date.UTC(y2, m2 - 1, d2);
    return Math.round((utc1 - utc2) / (1000 * 60 * 60 * 24));
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

        const vencimientos = await consultarVencimientos(cuenta.id_cuenta_corriente, new Date(corte), manager);

        let deudaVencidaTotal: Decimal | null = null;
        let deudaVencida30Dias: Decimal | null = null;
        let deudaVencida60Dias: Decimal | null = null;
        let deudaPorVencerTotal: Decimal | null = null;

        if (estado.cobertura === 'COMPLETA' && vencimientos) {
            let centsPorVencer = 0n;
            let centsVencidoTotal = 0n;
            let centsVencido30 = 0n;
            let centsVencido60 = 0n;

            const hoyCivil = civilDate(new Date(corte));

            for (const v of vencimientos) {
                if (v.pendiente === null) continue;
                const pCents = toCents(v.pendiente);
                if (v.estado === 'POR_VENCER') {
                    centsPorVencer += pCents;
                } else if (v.estado === 'VENCIDO') {
                    centsVencidoTotal += pCents;
                    const diasMora = diffCivilDays(hoyCivil, v.venceEl);
                    if (diasMora <= 30) {
                        centsVencido30 += pCents;
                    } else {
                        centsVencido60 += pCents;
                    }
                }
            }

            deudaPorVencerTotal = fromCents(centsPorVencer);
            deudaVencidaTotal = fromCents(centsVencidoTotal);
            deudaVencida30Dias = fromCents(centsVencido30);
            deudaVencida60Dias = fromCents(centsVencido60);
        }

        const resumen: Resumen = {
            estado: estado.habilitada ? 'HABILITADA' : 'INHABILITADA',
            cuentaId: estado.id_cuenta_corriente,
            origen: estado.origen,
            moneda: 'USD',
            plazoDias: estado.plazo_dias,
            saldo: estado.deuda_vigente,
            limite: estado.limite_credito,
            utilizado: estado.utilizado,
            disponible: estado.credito_disponible,
            deudaVencidaTotal,
            deudaVencida30Dias,
            deudaVencida60Dias,
            deudaPorVencerTotal,
            cobertura: estado.cobertura,
            estadoCredito: estado.estado_credito
        };

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

        // H01: No seleccionamos ni exponemos m.observaciones bajo ningún concepto
        const rawRows: any[] = await manager.query(
            `SELECT m.id_movimiento_cuenta,
                    m.id_cuenta_corriente,
                    m.tipo_movimiento,
                    m.origen,
                    m.id_pedido,
                    m.id_pago,
                    m.monto,
                    m.moneda,
                    m.estado,
                    m.plazo_aplicado,
                    m.fecha_efectiva,
                    DATE_FORMAT(m.vence_el, '%Y-%m-%d') AS vence_civil,
                    DATE_FORMAT(m.fecha_efectiva, '%Y-%m-%dT%H:%i:%s.%fZ') AS efectiva_utc
             FROM MOVIMIENTO_CUENTA_CORRIENTE m
             WHERE m.id_cuenta_corriente = ?
             ORDER BY m.fecha_efectiva ASC, m.id_movimiento_cuenta ASC`,
            [cuenta.id_cuenta_corriente]
        );

        let running = 0n;
        const movsWithBalance = rawRows.map((r) => {
            if (r.estado === 'ACREDITADO') {
                if (r.tipo_movimiento === 'CARGO') {
                    running += toCents(r.monto);
                } else if (r.tipo_movimiento === 'ABONO') {
                    running -= toCents(r.monto);
                }
            }

            const saldoResultante = estado.cobertura === 'COMPLETA' ? fromCents(running) : null;
            const fechaOperacion = r.efectiva_utc
                ? new Date(r.efectiva_utc).toISOString().replace('.000Z', 'Z')
                : new Date(r.fecha_efectiva).toISOString().replace('.000Z', 'Z');

            const conceptoPublico = r.tipo_movimiento === 'CARGO'
                ? (r.id_pedido ? `Pedido #${r.id_pedido}` : 'Cargo en cuenta corriente')
                : (r.id_pago ? `Pago #${r.id_pago}` : 'Pago en cuenta corriente');

            const mapped: Movimiento = {
                id: String(r.id_movimiento_cuenta),
                fechaOperacion,
                concepto: conceptoPublico,
                importe: fromCents(toCents(r.monto)),
                saldoResultante,
                moneda: 'USD',
                estado: r.estado === 'ACREDITADO' ? 'VIGENTE' : 'ANULADO',
                origen: r.origen === 'DEMO' || estado.origen === 'DEMO' ? 'DEMO' : 'REAL',
                ...(r.tipo_movimiento === 'CARGO'
                    ? {
                        tipo: 'CARGO' as const,
                        referencia: { pedidoId: r.id_pedido ?? 0 },
                        plazoDias: (r.plazo_aplicado === 30 || r.plazo_aplicado === 60) ? r.plazo_aplicado : null,
                        venceEl: r.vence_civil || null
                    }
                    : {
                        tipo: 'ABONO' as const,
                        referencia: { pagoId: r.id_pago ?? 0 },
                        venceEl: null,
                        plazoDias: null
                    })
            };
            return mapped;
        });

        // Orden descendente estable por fecha efectiva UTC e ID descendente
        movsWithBalance.reverse();

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

        const rawVencimientos = await consultarVencimientos(cuenta.id_cuenta_corriente, new Date(corte), manager);
        const allItems: Vencimiento[] = (rawVencimientos ?? []).map((v) => ({
            movimientoId: String(v.movimientoId),
            venceEl: v.venceEl,
            plazoDias: (v.plazoDias === 30 || v.plazoDias === 60) ? v.plazoDias : null,
            moneda: 'USD' as const,
            pendiente: v.pendiente,
            estado: v.estado as Vencimiento['estado'],
            origen: estado.origen
        }));

        // Orden ascendente estable por fecha civil e ID de movimiento
        allItems.sort((a, b) => {
            if (a.venceEl !== b.venceEl) return a.venceEl.localeCompare(b.venceEl);
            return Number(a.movimientoId) - Number(b.movimientoId);
        });

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