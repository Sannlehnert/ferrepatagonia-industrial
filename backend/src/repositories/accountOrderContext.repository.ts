import type { EntityManager } from 'typeorm';
import type { AuthContext } from '../types/auth';
import { lockCartClient } from './cart.repository';
import { calcularEstadoCuenta } from './cuentaCorriente.repository';
import { AccountOrderError } from '../services/orders/account-order.errors';

export async function lockAccountOrderContext(
  manager: EntityManager,
  auth: AuthContext,
  clientId: number,
): Promise<{ accountId: number; availableUSD: string; origin: string }> {
  if (!manager.queryRunner?.isTransactionActive) {
    throw new Error('La confirmación requiere una transacción activa.');
  }

  if (auth.rol !== 'CLIENTE') {
    throw new AccountOrderError(
      'NO_AUTORIZADO', 403,
      'Esta operación requiere una cuenta de cliente.',
    );
  }

  const [account] = await manager.query<{ accountId: number; origin: string }[]>(`
    SELECT id_cuenta_corriente AS accountId, origen_datos AS origin
    FROM CUENTA_CORRIENTE
    WHERE id_cliente = ?
    FOR UPDATE
  `, [clientId]);

  if (!account) {
    throw new AccountOrderError(
      'CUENTA_NO_HABILITADA', 403,
      'El cliente no tiene una cuenta corriente habilitada.',
    );
  }

  if (await lockCartClient(manager, auth.id) !== clientId) {
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

  if (!client || client.type !== 'EMPRESA' ||
    client.approval !== 'APROBADA') {
    throw new AccountOrderError(
      'EMPRESA_NO_HABILITADA', 403,
      'La empresa no está aprobada para esta operación.',
    );
  }

  const state = await calcularEstadoCuenta(
    account.accountId,
    manager,
    { lock: true },
  );

  if (!state || !state.habilitada) {
    throw new AccountOrderError(
      'CUENTA_NO_HABILITADA', 403,
      'La cuenta corriente no está habilitada.',
    );
  }

  if (state.libro_mixto ||
    state.cobertura !== 'COMPLETA' ||
    state.deuda_vigente === null ||
    state.limite_credito === null ||
    state.credito_disponible === null) {
    throw new AccountOrderError(
      'CREDITO_NO_VERIFICADO', 422,
      'No se pudo verificar el crédito disponible.',
    );
  }

  if (state.plazo_dias === null) {
    throw new AccountOrderError(
      'PLAZO_NO_HABILITADO', 403,
      'La cuenta no tiene un plazo comercial acreditado.',
    );
  }

  return {
    accountId: account.accountId,
    availableUSD: state.credito_disponible,
    origin: account.origin,
  };
}
