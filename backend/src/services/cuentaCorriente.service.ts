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
    CursorPayload,
    Decimal,
    Detalle,
    InstanteUTC,
    Movimiento,
    Resumen,
    Vencimiento
} from '../dtos/cuentaCorriente/cuentaCorriente.dto';

const getSecretKey = (): string => env.jwtSecret || 'ferrepatagonia_cursor_signature_secret';

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
    const parts = cursorStr.split('.');
    if (parts.length !== 2) {
        throw new Error('CONSULTA_INVALIDA');
    }
    const [serialized, signature] = parts;
    const expectedSig = createHmac('sha256', getSecretKey()).update(serialized).digest('base64url');

    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        throw new Error('CONSULTA_INVALIDA');
    }

    try {
        const payload = JSON.parse(Buffer.from(serialized, 'base64url').toString('utf8')) as CursorPayload;
        if (
            payload.userId !== expectedUserId ||
            payload.scope !== expectedScope ||
            typeof payload.cuentaId !== 'number' ||
            typeof payload.offset !== 'number' ||
            typeof payload.corte !== 'string' ||
            typeof payload.revision !== 'string'
        ) {
            throw new Error('CONSULTA_INVALIDA');
        }
        return payload;
    } catch {
        throw new Error('CONSULTA_INVALIDA');
    }
}

function diffCivilDays(todayCivil: string, targetCivil: string): number {
    const [y1, m1, d1] = todayCivil.split('-').map(Number);
    const [y2, m2, d2] = targetCivil.split('-').map(Number);
    const utc1 = Date.UTC(y1, m1 - 1, d1);
    const utc2 = Date.UTC(y2, m2 - 1, d2);
    return Math.round((utc1 - utc2) / (1000 * 60 * 60 * 24));
}

async function resolveClienteId(manager: EntityManager, userId: number): Promise<number | null> {
    const [user] = await manager.query(
        'SELECT id_usuario, id_cliente, rol, activo FROM USUARIO WHERE id_usuario = ?',
        [userId]
    );
    if (!user || user.activo !== 1 || user.rol !== 'CLIENTE' || !user.id_cliente) {
        return null;
    }
    const [client] = await manager.query(
        'SELECT id_cliente, activo, tipo_cliente, estado_aprobacion_empresa FROM CLIENTE WHERE id_cliente = ?',
        [user.id_cliente]
    );
    if (!client || client.activo !== 1) {
        return null;
    }
    return client.id_cliente;
}

export async function getConsultaCuenta(userId: number): Promise<Consulta> {
    const corte: InstanteUTC = new Date().toISOString();
    return inTransaction(async (manager) => {
        const clienteId = await resolveClienteId(manager, userId);
        if (!clienteId) {
            return { corte, revision: 'rev-0', estado: 'SIN_CUENTA' };
        }

        const cuenta = await findCuentaByClienteId(clienteId, manager);
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
    let payload: CursorPayload | undefined;
    if (cursorParam) {
        payload = verifyAndDecodeCursor(cursorParam, userId, 'movimientos');
    }

    const ahoraUTC = new Date().toISOString();
    return inTransaction(async (manager) => {
        const clienteId = await resolveClienteId(manager, userId);
        if (!clienteId) {
            return { corte: ahoraUTC, revision: 'rev-0', estado: 'SIN_CUENTA' };
        }

        const cuenta = await findCuentaByClienteId(clienteId, manager);
        if (!cuenta) {
            return { corte: ahoraUTC, revision: 'rev-0', estado: 'SIN_CUENTA' };
        }

        const estado = await calcularEstadoCuenta(cuenta.id_cuenta_corriente, manager);
        if (!estado) {
            return { corte: ahoraUTC, revision: 'rev-0', estado: 'SIN_CUENTA' };
        }

        let corte = ahoraUTC;
        let offset = 0;

        if (payload) {
            if (payload.revision !== estado.revision) {
                const err = new Error('Revisión de cuenta desactualizada.');
                (err as unknown as { code: string }).code = 'CONSULTA_DESACTUALIZADA';
                throw err;
            }
            corte = payload.corte;
            offset = payload.offset;
        }

        const rawRows: any[] = await manager.query(
            `SELECT m.*, DATE_FORMAT(m.vence_el, '%Y-%m-%d') AS vence_civil,
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

            const mapped: Movimiento = {
                id: String(r.id_movimiento_cuenta),
                fechaOperacion,
                concepto: r.observaciones || (r.tipo_movimiento === 'CARGO' ? `Pedido #${r.id_pedido}` : `Pago #${r.id_pago}`),
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

        movsWithBalance.reverse();

        const items = movsWithBalance.slice(offset, offset + limite);
        const nextOffset = offset + limite;
        const siguienteCursor = nextOffset < movsWithBalance.length
            ? signCursor({
                userId,
                cuentaId: cuenta.id_cuenta_corriente,
                scope: 'movimientos',
                corte,
                revision: estado.revision,
                offset: nextOffset
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
    let payload: CursorPayload | undefined;
    if (cursorParam) {
        payload = verifyAndDecodeCursor(cursorParam, userId, 'vencimientos');
    }

    const ahoraUTC = new Date().toISOString();
    return inTransaction(async (manager) => {
        const clienteId = await resolveClienteId(manager, userId);
        if (!clienteId) {
            return { corte: ahoraUTC, revision: 'rev-0', estado: 'SIN_CUENTA' };
        }

        const cuenta = await findCuentaByClienteId(clienteId, manager);
        if (!cuenta) {
            return { corte: ahoraUTC, revision: 'rev-0', estado: 'SIN_CUENTA' };
        }

        const estado = await calcularEstadoCuenta(cuenta.id_cuenta_corriente, manager);
        if (!estado) {
            return { corte: ahoraUTC, revision: 'rev-0', estado: 'SIN_CUENTA' };
        }

        let corte = ahoraUTC;
        let offset = 0;

        if (payload) {
            if (payload.revision !== estado.revision) {
                const err = new Error('Revisión de cuenta desactualizada.');
                (err as unknown as { code: string }).code = 'CONSULTA_DESACTUALIZADA';
                throw err;
            }
            corte = payload.corte;
            offset = payload.offset;
        }

        const rawVencimientos = await consultarVencimientos(cuenta.id_cuenta_corriente, new Date(corte), manager);
        const allItems: Vencimiento[] = (rawVencimientos ?? []).map((v) => ({
            movimientoId: v.movimientoId,
            venceEl: v.venceEl,
            plazoDias: (v.plazoDias === 30 || v.plazoDias === 60) ? v.plazoDias : null,
            moneda: 'USD' as const,
            pendiente: v.pendiente,
            estado: v.estado as Vencimiento['estado'],
            origen: estado.origen
        }));

        const items = allItems.slice(offset, offset + limite);
        const nextOffset = offset + limite;
        const siguienteCursor = nextOffset < allItems.length
            ? signCursor({
                userId,
                cuentaId: cuenta.id_cuenta_corriente,
                scope: 'vencimientos',
                corte,
                revision: estado.revision,
                offset: nextOffset
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