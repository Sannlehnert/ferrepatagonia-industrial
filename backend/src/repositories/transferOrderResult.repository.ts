import type { EntityManager } from 'typeorm';
import { lockTransferOrderAttempt } from './transferOrderAttempt.repository';
import { AccountOrderError } from '../services/orders/account-order.errors';
import { academicOrderReference } from '../services/orders/academic-checkout';
import type {
  ConfirmedTransferOrder,
} from '../services/orders/account-order.types';

interface ConfirmedTransferOrderRow {
  pedidoId: number;
  totalUSD: string;
  evidencia: string;
}

export async function completeTransferOrderAttempt(
  manager: EntityManager,
  clientId: number,
  key: string,
  orderId: number,
): Promise<{ data: ConfirmedTransferOrder }> {
  const attempt = await lockTransferOrderAttempt(
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

  const [row] = await manager.query<ConfirmedTransferOrderRow[]>(`
    SELECT
      p.id_pedido AS pedidoId,
      p.total AS totalUSD,
      p.evidencia_total_usd AS evidencia
    FROM PEDIDO p
    LEFT JOIN MOVIMIENTO_CUENTA_CORRIENTE m
      ON m.id_pedido = p.id_pedido
    WHERE p.id_pedido = ?
      AND p.id_cliente = ?
      AND p.estado = 'CONFIRMADO'
      AND p.modalidad_pago = 'TRANSFERENCIA'
      AND p.moneda_total = 'USD'
      AND p.evidencia_total_usd IS NOT NULL
      AND CHAR_LENGTH(TRIM(p.evidencia_total_usd)) > 0
      AND p.total > 0
      AND m.id_movimiento_cuenta IS NULL
    FOR UPDATE
  `, [orderId, clientId]);

  if (!row) {
    throw new AccountOrderError(
      'RESULTADO_PEDIDO_INCONSISTENTE',
      503,
      'No se pudo verificar el resultado de la confirmación.',
    );
  }

  const response: { data: ConfirmedTransferOrder } = {
    data: {
      pedidoId: row.pedidoId,
      estado: 'CONFIRMADO',
      modalidadPago: 'TRANSFERENCIA',
      moneda: 'USD',
      totalUSD: row.totalUSD,
      ...(row.evidencia.startsWith(academicOrderReference) ? { simulado: true as const } : {}),
    },
  };

  const result = await manager.query(`
    UPDATE CONFIRMACION_PEDIDO_TRANSFERENCIA
    SET estado = 'CONFIRMADO',
        id_pedido = ?,
        http_status = 201,
        respuesta_json = ?
    WHERE id_cliente = ?
      AND clave = ?
      AND estado = 'PENDIENTE'
  `, [
    orderId,
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
