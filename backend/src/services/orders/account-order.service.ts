import { dataSource, inTransaction } from '../../config/database.config';
import { DatabaseOutcomeUnknownError } from '../../config/database-policy';
import type { AuthContext } from '../../types/auth';
import {
  findAccountOrderAttempt,
  lockAccountOrderAttempt,
  reserveAccountOrderAttempt,
} from '../../repositories/accountOrderAttempt.repository';
import {
  findClientOrderDetailById,
  findClientOrdersByClientId,
} from '../../repositories/accountOrder.repository';
import {
  persistAccountOrderRejection,
} from '../../repositories/accountOrderRejection.repository';
import {
  validateConfirmationKey,
  validateOrderIdParam,
} from '../../dtos/orders/account-order.dto';
import { hasDatabaseError } from '../cart.errors';
import { PricingError } from '../pricing/money';
import { AccountOrderError } from './account-order.errors';
import {
  pendingAccountOrder,
  presentStoredAccountOrder,
} from './account-order.recovery';
import { executePendingAccountOrder } from './account-order.transaction';
import { lockAccountOrderContext } from '../../repositories/accountOrderContext.repository';
import { lockAccountOrderCart } from '../../repositories/accountOrderCart.repository';
import { quoteAccountOrderCart } from './account-order.pricing';
import { toCents } from '../../repositories/cuentaCorriente.repository';
import type {
  AccountOrderEligibilityResult,
  AccountOrderResult,
} from './account-order.types';
import { issueAccountOrderQuoteToken } from './account-order-quote-token';

function validateClientAuth(auth: AuthContext): void {
  if (auth.rol !== 'CLIENTE' ||
    !Number.isInteger(auth.id) || auth.id < 1 ||
    auth.id > 2147483647) {
    throw new AccountOrderError(
      'NO_AUTORIZADO', 403,
      'Esta operación requiere una cuenta de cliente.',
    );
  }
}

async function findActiveClient(auth: AuthContext): Promise<number> {
  const [client] = await dataSource.query<{ clientId: number }[]>(`
    SELECT c.id_cliente AS clientId
    FROM USUARIO u
    INNER JOIN CLIENTE c ON c.id_cliente = u.id_cliente
    WHERE u.id_usuario = ? AND u.rol = 'CLIENTE'
      AND u.activo = 1 AND c.activo = 1
  `, [auth.id]);

  if (!client) {
    throw new AccountOrderError(
      'CLIENTE_NO_HABILITADO', 403,
      'La cuenta de cliente no está habilitada.',
    );
  }

  return client.clientId;
}

async function identify(auth: AuthContext, value: unknown) {
  validateClientAuth(auth);
  const key = await validateConfirmationKey(value);
  if (!key.valid) {
    throw new AccountOrderError(key.code, 400, key.message);
  }

  return { clientId: await findActiveClient(auth), key: key.key };
}

async function recover(clientId: number, key: string) {
  let attempt;
  try {
    attempt = await findAccountOrderAttempt(clientId, key);
  } catch {
    return pendingAccountOrder();
  }

  return attempt
    ? presentStoredAccountOrder(attempt)
    : pendingAccountOrder();
}

function rejection(error: unknown): AccountOrderError | null {
  if (error instanceof AccountOrderError) return error;

  if (error instanceof PricingError && error.status < 500) {
    return new AccountOrderError(
      error.code, 422, 'No se pudo verificar el importe del pedido.',
    );
  }

  if (hasDatabaseError(error, 'ER_LOCK_WAIT_TIMEOUT', 1205) ||
    hasDatabaseError(error, 'ER_LOCK_DEADLOCK', 1213) ||
    hasDatabaseError(error, 'ER_STATEMENT_TIMEOUT', 1969)) {
    return new AccountOrderError(
      'CONFLICTO_CONFIRMACION', 409,
      'La operación encontró un conflicto. Revisá el resultado antes de iniciar otro intento.',
    );
  }

  return null;
}

export async function listClientOrders(
  auth: AuthContext,
): Promise<AccountOrderResult> {
  const clientId = await identifyClient(auth);
  const items = await findClientOrdersByClientId(clientId);

  return {
    status: 200,
    body: {
      data: { items },
    },
  };
}

export async function getClientOrderDetail(
  auth: AuthContext,
  orderIdParam: unknown,
): Promise<AccountOrderResult> {
  if (auth.rol !== 'CLIENTE' ||
    !Number.isInteger(auth.id) || auth.id < 1 ||
    auth.id > 2147483647) {
    throw new AccountOrderError(
      'NO_AUTORIZADO', 403,
      'Esta operación requiere una cuenta de cliente.',
    );
  }

  const validation = await validateOrderIdParam(orderIdParam);
  if (!validation.valid) {
    throw new AccountOrderError(
      validation.code,
      400,
      validation.message,
    );
  }

  const clientId = await identifyClient(auth);
  const order = await findClientOrderDetailById(clientId, validation.orderId);

  if (!order) {
    return {
      status: 404,
      body: {
        code: 'PEDIDO_NO_ENCONTRADO',
        message: 'No se encontró el pedido solicitado.',
      },
    };
  }

  return {
    status: 200,
    body: {
      data: order,
    },
  };
}

export async function getAccountOrderResult(
  auth: AuthContext,
  value: unknown,
): Promise<AccountOrderResult> {
  const { clientId, key } = await identify(auth, value);
  const attempt = await findAccountOrderAttempt(clientId, key);

  return attempt ? presentStoredAccountOrder(attempt) : {
    status: 404,
    body: {
      code: 'INTENTO_NO_ENCONTRADO',
      message: 'No se encontró el intento de confirmación.',
    },
  };
}

export async function confirmAccountOrder(
  auth: AuthContext,
  value: unknown,
  quoteToken: unknown,
): Promise<AccountOrderResult> {
  const { clientId, key } = await identify(auth, value);
  const existing = await findAccountOrderAttempt(clientId, key);

  if (existing && existing.state !== 'PENDIENTE') {
    return presentStoredAccountOrder(existing);
  }

  try {
    await reserveAccountOrderAttempt(clientId, key);
  } catch {
    return recover(clientId, key);
  }

  let workFailure: { error: unknown } | undefined;

  try {
    return await inTransaction(async manager => {
      try {
        const attempt = await lockAccountOrderAttempt(manager, clientId, key);

        if (attempt && attempt.state !== 'PENDIENTE') {
          return presentStoredAccountOrder(attempt);
        }

        return await executePendingAccountOrder(
          manager, auth, clientId, key, quoteToken,
        );
      } catch (error) {
        workFailure = { error };
        throw error;
      }
    }, { isolation: 'READ COMMITTED', lockWaitSeconds: 2 });
  } catch (error) {
    if (!workFailure || workFailure.error !== error ||
      error instanceof DatabaseOutcomeUnknownError) {
      return recover(clientId, key);
    }

    const failure = rejection(error);
    const status = failure?.status;

    if (failure && (status === 400 || status === 403 ||
      status === 409 || status === 422)) {
      try {
        const saved = await inTransaction(
          manager => persistAccountOrderRejection(
            manager, clientId, key, status,
            { code: failure.code, message: failure.message },
          ),
          { isolation: 'READ COMMITTED', lockWaitSeconds: 2 },
        );
        return presentStoredAccountOrder(saved);
      } catch {
        return recover(clientId, key);
      }
    }

    return {
      status: 503,
      body: {
        code: 'CONFIRMACION_NO_DISPONIBLE',
        message: 'No se completó la operación. Reintentá utilizando la misma clave.',
      },
    };
  }
}
