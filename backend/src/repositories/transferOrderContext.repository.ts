import type { EntityManager } from 'typeorm';
import type { AuthContext } from '../types/auth';
import { lockCartClient } from './cart.repository';
import { AccountOrderError } from '../services/orders/account-order.errors';

export async function lockTransferOrderContext(
  manager: EntityManager,
  auth: AuthContext,
  clientId: number,
): Promise<{ clientType: 'PARTICULAR' | 'EMPRESA'; origin: 'REAL' }> {
  if (!manager.queryRunner?.isTransactionActive) {
    throw new Error('La confirmación requiere una transacción activa.');
  }

  if (auth.rol !== 'CLIENTE') {
    throw new AccountOrderError(
      'NO_AUTORIZADO', 403,
      'Esta operación requiere una cuenta de cliente.',
    );
  }

  if (!await lockCartClient(manager, auth.id, clientId)) {
    throw new AccountOrderError(
      'CLIENTE_NO_HABILITADO', 403,
      'La cuenta de cliente no está habilitada.',
    );
  }

  const [client] = await manager.query<{
    type: string;
    approval: string | null;
  }[]>(`
    SELECT
      tipo_cliente AS type,
      estado_aprobacion_empresa AS approval
    FROM CLIENTE
    WHERE id_cliente = ?
    LOCK IN SHARE MODE
  `, [clientId]);

  if (!client) {
    throw new AccountOrderError(
      'CLIENTE_NO_HABILITADO', 403,
      'La cuenta de cliente no está habilitada.',
    );
  }

  if (client.type === 'EMPRESA') {
    if (client.approval !== 'APROBADA') {
      throw new AccountOrderError(
        'EMPRESA_NO_HABILITADA', 403,
        'La empresa no está aprobada para esta operación.',
      );
    }

    return {
      clientType: 'EMPRESA',
      origin: 'REAL',
    };
  }

  if (client.type === 'PARTICULAR') {
    return {
      clientType: 'PARTICULAR',
      origin: 'REAL',
    };
  }

  throw new AccountOrderError(
    'CLIENTE_NO_HABILITADO', 403,
    'La cuenta de cliente no está habilitada.',
  );
}
