import type { EntityManager } from 'typeorm';
import {
  dataSource,
  inTransaction,
} from '../config/database.config';

export interface AccountOrderAttempt {
  clientId: number;
  key: string;
  state: 'PENDIENTE' | 'CONFIRMADO' | 'RECHAZADO';
  orderId: number | null;
  chargeId: number | null;
  httpStatus: number | null;
  responseJson: string | null;
}

async function readAttempt(
  manager: EntityManager,
  clientId: number,
  key: string,
  lock: boolean,
): Promise<AccountOrderAttempt | null> {
  const rows = await manager.query<AccountOrderAttempt[]>(`
    SELECT
      id_cliente AS clientId,
      clave AS \`key\`,
      estado AS state,
      id_pedido AS orderId,
      id_cargo AS chargeId,
      http_status AS httpStatus,
      respuesta_json AS responseJson
    FROM CONFIRMACION_PEDIDO_CC
    WHERE id_cliente = ? AND clave = ?
    ${lock ? 'FOR UPDATE' : ''}
  `, [clientId, key]);

  return rows[0] ?? null;
}

export function findAccountOrderAttempt(
  clientId: number,
  key: string,
): Promise<AccountOrderAttempt | null> {
  return readAttempt(dataSource.manager, clientId, key, false);
}

export function lockAccountOrderAttempt(
  manager: EntityManager,
  clientId: number,
  key: string,
): Promise<AccountOrderAttempt | null> {
  if (!manager.queryRunner?.isTransactionActive) {
    throw new Error(
      'El bloqueo del intento requiere una transacción activa.',
    );
  }

  return readAttempt(manager, clientId, key, true);
}

export function reserveAccountOrderAttempt(
  clientId: number,
  key: string,
): Promise<AccountOrderAttempt> {
  return inTransaction(async manager => {
    // Reutilizar una clave nunca reinicia su estado ni su resultado.
    await manager.query(`
      INSERT INTO CONFIRMACION_PEDIDO_CC (
        id_cliente, clave, estado
      ) VALUES (?, ?, 'PENDIENTE')
      ON DUPLICATE KEY UPDATE clave = VALUES(clave)
    `, [clientId, key]);

    const attempt = await lockAccountOrderAttempt(
      manager,
      clientId,
      key,
    );

    if (!attempt) {
      throw new Error('No se pudo recuperar el intento reservado.');
    }

    return attempt;
  });
}