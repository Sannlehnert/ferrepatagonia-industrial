import type { EntityManager } from 'typeorm';
import { lockAccountOrderAttempt } from './accountOrderAttempt.repository';
import { AccountOrderError } from '../services/orders/account-order.errors';
import { academicOrderReference } from '../services/orders/academic-checkout';
import type {
  ConfirmedAccountOrder,
} from '../services/orders/account-order.types';

interface ConfirmedOrderRow {
  pedidoId: number;
  totalUSD: string;
  cargoId: number;
  venceEl: string;
  evidencia: string;
}

export async function completeAccountOrderAttempt(
  manager: EntityManager,
  clientId: number,
  key: string,
  orderId: number,
  chargeId: number,
): Promise<{ data: ConfirmedAccountOrder }> {
  const attempt = await lockAccountOrderAttempt(
    manager,
    clientId,
    key,
  );

  if (!attempt) {
    throw new AccountOrderError(
      'INTENTO_NO_ENCONTRADO',
      404,
      'No se encontró el intento de confirmación.',
    );
  }

  if (attempt.state !== 'PENDIENTE') {
    throw new AccountOrderError(
      'INTENTO_FINALIZADO',
      409,
      'El intento ya tiene un resultado registrado.',
    );
  }

  const [row] = await manager.query<ConfirmedOrderRow[]>(`
    SELECT
      p.id_pedido AS pedidoId,
      p.total AS totalUSD,
      m.id_movimiento_cuenta AS cargoId,
      DATE_FORMAT(m.vence_el, '%Y-%m-%d') AS venceEl,
      p.evidencia_total_usd AS evidencia
    FROM PEDIDO p
    INNER JOIN MOVIMIENTO_CUENTA_CORRIENTE m
      ON m.id_pedido = p.id_pedido
    INNER JOIN CUENTA_CORRIENTE c
      ON c.id_cuenta_corriente = m.id_cuenta_corriente
    WHERE p.id_pedido = ?
      AND m.id_movimiento_cuenta = ?
      AND p.id_cliente = ?
      AND c.id_cliente = ?
      AND p.estado = 'CONFIRMADO'
      AND p.modalidad_pago = 'CUENTA_CORRIENTE'
      AND p.moneda_total = 'USD'
      AND p.evidencia_total_usd IS NOT NULL
      AND CHAR_LENGTH(TRIM(p.evidencia_total_usd)) > 0
      AND m.tipo_movimiento = 'CARGO'
      AND m.estado = 'ACREDITADO'
      AND m.moneda = 'USD'
      AND m.vence_el IS NOT NULL
      AND p.total = m.monto
      AND p.total > 0
    FOR UPDATE
  `, [orderId, chargeId, clientId, clientId]);

  if (!row) {
    throw new AccountOrderError(
      'RESULTADO_PEDIDO_INCONSISTENTE',
      503,
      'No se pudo verificar el resultado de la confirmación.',
    );
  }

  const response: { data: ConfirmedAccountOrder } = {
    data: {
      pedidoId: row.pedidoId,
      estado: 'CONFIRMADO',
      modalidadPago: 'CUENTA_CORRIENTE',
      moneda: 'USD',
      totalUSD: row.totalUSD,
      cargoId: String(row.cargoId),
      venceEl: row.venceEl,
      ...(row.evidencia.startsWith(academicOrderReference) ? { simulado: true as const } : {}),
    },
  };

  const result = await manager.query(`
    UPDATE CONFIRMACION_PEDIDO_CC
    SET estado = 'CONFIRMADO',
        id_pedido = ?,
        id_cargo = ?,
        http_status = 201,
        respuesta_json = ?
    WHERE id_cliente = ?
      AND clave = ?
      AND estado = 'PENDIENTE'
  `, [
    orderId,
    chargeId,
    JSON.stringify(response),
    clientId,
    key,
  ]);

  if (result.affectedRows !== 1) {
    throw new AccountOrderError(
      'INTENTO_FINALIZADO',
      409,
      'El intento ya tiene un resultado registrado.',
    );
  }

  return response;
}
