import type { EntityManager } from 'typeorm';
import {
  dataSource,
  inTransaction,
} from '../config/database.config';

export interface TransferOrderAttempt {
  clientId: number;
  key: string;
  state: 'PENDIENTE' | 'CONFIRMADO' | 'RECHAZADO';
  orderId: number | null;
  httpStatus: number | null;
  responseJson: string | null;
}

async function readAttempt(
  manager: EntityManager,
  clientId: number,
  key: string,
  lock: boolean,
): Promise<TransferOrderAttempt | null> {
  const rows = await manager.query<TransferOrderAttempt[]>(`
    SELECT
      id_cliente AS clientId,
      clave AS \`key\`,
      estado AS state,
      id_pedido AS orderId,
      http_status AS httpStatus,
      respuesta_json AS responseJson
    FROM CONFIRMACION_PEDIDO_TRANSFERENCIA
    WHERE id_cliente = ? AND clave = ?
    ${lock ? 'FOR UPDATE' : ''}
  `, [clientId, key]);

  return rows[0] ?? null;
}

export function findTransferOrderAttempt(
  clientId: number,
  key: string,
): Promise<TransferOrderAttempt | null> {
  return readAttempt(dataSource.manager, clientId, key, false);
}

export function lockTransferOrderAttempt(
  manager: EntityManager,
  clientId: number,
  key: string,
): Promise<TransferOrderAttempt | null> {
  if (!manager.queryRunner?.isTransactionActive) {
    throw new Error(
      'El bloqueo del intento requiere una transacción activa.',
    );
  }

  return readAttempt(manager, clientId, key, true);
}

export function reserveTransferOrderAttempt(
  clientId: number,
  key: string,
): Promise<TransferOrderAttempt> {
  return inTransaction(async manager => {
    // Reutilizar una clave nunca reinicia su estado ni su resultado.
    await manager.query(`
      INSERT INTO CONFIRMACION_PEDIDO_TRANSFERENCIA (
        id_cliente, clave, estado
      ) VALUES (?, ?, 'PENDIENTE')
      ON DUPLICATE KEY UPDATE clave = VALUES(clave)
    `, [clientId, key]);

    const attempt = await lockTransferOrderAttempt(
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
