import type { EntityManager } from 'typeorm';
import {
  lockAccountOrderAttempt,
  type AccountOrderAttempt,
} from './accountOrderAttempt.repository';
import type {
  AccountOrderFailure,
} from '../services/orders/account-order.types';
import { AccountOrderError } from '../services/orders/account-order.errors';

export async function persistAccountOrderRejection(
  manager: EntityManager,
  clientId: number,
  key: string,
  status: 400 | 403 | 409 | 422,
  failure: AccountOrderFailure,
): Promise<AccountOrderAttempt> {
  const attempt = await lockAccountOrderAttempt(manager, clientId, key);

  if (!attempt) {
    throw new AccountOrderError(
      'INTENTO_NO_ENCONTRADO', 404,
      'No se encontró el intento de confirmación.',
    );
  }

  if (attempt.state !== 'PENDIENTE') return attempt;

  const result = await manager.query(`
    UPDATE CONFIRMACION_PEDIDO_CC
    SET estado = 'RECHAZADO',
        http_status = ?,
        respuesta_json = ?
    WHERE id_cliente = ? AND clave = ? AND estado = 'PENDIENTE'
  `, [status, JSON.stringify(failure), clientId, key]);

  if (result.affectedRows !== 1) {
    throw new AccountOrderError(
      'RESULTADO_NO_DISPONIBLE', 503,
      'No se pudo verificar el resultado del intento.',
    );
  }

  const saved = await lockAccountOrderAttempt(manager, clientId, key);

  if (!saved) {
    throw new AccountOrderError(
      'RESULTADO_NO_DISPONIBLE', 503,
      'No se pudo recuperar el resultado del intento.',
    );
  }

  return saved;
}