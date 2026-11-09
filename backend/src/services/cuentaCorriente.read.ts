import type { EntityManager } from 'typeorm';
import type { InstanteUTC, Decimal, Movimiento, Resumen, Vencimiento } from '../dtos/cuentaCorriente/cuentaCorriente.dto';
import { consultarVencimientos, fromCents, toCents, type ResumenCredito } from '../repositories/cuentaCorriente.repository';
import { civilDate } from './pricing/pricing.quote';
import { accountSourceUnavailable } from './adminAccount.errors';

function assertPublishable(state: ResumenCredito): void {
    if (state.origen === 'DEMO' && process.env.NODE_ENV !== 'test') {
        throw accountSourceUnavailable();
    }
}

function diffCivilDays(todayCivil: string, targetCivil: string): number {
    const [y1, m1, d1] = todayCivil.split('-').map(Number);
    const [y2, m2, d2] = targetCivil.split('-').map(Number);
    const utc1 = Date.UTC(y1, m1 - 1, d1);
    const utc2 = Date.UTC(y2, m2 - 1, d2);
    return Math.round((utc1 - utc2) / (1000 * 60 * 60 * 24));
}

export async function readAccountSummary(manager: EntityManager, estado: ResumenCredito, corte: InstanteUTC): Promise<Resumen> {
    assertPublishable(estado);
    const vencimientos = await consultarVencimientos(estado.id_cuenta_corriente, new Date(corte), manager);

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
    return resumen;
}

export async function readAccountMovements(manager: EntityManager, estado: ResumenCredito, accreditedOnly = false): Promise<Movimiento[]> {
    assertPublishable(estado);
    // H01: No seleccionamos ni exponemos m.observaciones bajo ningún concepto
    const rawRows: any[] = await manager.query(
        `SELECT m.id_movimiento_cuenta,
                m.id_cuenta_corriente,
                m.tipo_movimiento,
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
           ${accreditedOnly ? "AND m.moneda = 'USD' AND NULLIF(TRIM(m.evidencia_origen), '') IS NOT NULL AND NULLIF(TRIM(m.huella_registro), '') IS NOT NULL" : ''}
         ORDER BY m.fecha_efectiva ASC, m.id_movimiento_cuenta ASC`,
        [estado.id_cuenta_corriente]
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
            origen: estado.origen,
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
    return movsWithBalance;
}

export async function readAccountDueDates(manager: EntityManager, estado: ResumenCredito, corte: InstanteUTC): Promise<Vencimiento[]> {
    assertPublishable(estado);
    const rawVencimientos = await consultarVencimientos(estado.id_cuenta_corriente, new Date(corte), manager);
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
    return allItems;
}
