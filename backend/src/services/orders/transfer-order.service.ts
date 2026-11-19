import { dataSource, inTransaction, type ReadQuery } from '../../config/database.config';
import { notifyAfterCommit, type CommittedChange, type NotifyCommittedChange } from '../../realtime/committed-change';
import { DatabaseOutcomeUnknownError } from '../../config/database-policy';
import type { AuthContext } from '../../types/auth';
import {
  findTransferOrderAttempt,
  lockTransferOrderAttempt,
  reserveTransferOrderAttempt,
} from '../../repositories/transferOrderAttempt.repository';
import {
  persistTransferOrderRejection,
} from '../../repositories/transferOrderRejection.repository';
import {
  validateTransferConfirmationKey,
} from '../../dtos/orders/transfer-order.dto';
import { hasDatabaseError } from '../cart.errors';
import { PricingError } from '../pricing/money';
import { AccountOrderError } from './account-order.errors';
import {
  pendingTransferOrder,
  presentStoredTransferOrder,
} from './transfer-order.recovery';
import { executePendingTransferOrder } from './transfer-order.transaction';
import { lockTransferOrderContext } from '../../repositories/transferOrderContext.repository';
import { lockAccountOrderCart } from '../../repositories/accountOrderCart.repository';
import { quoteAccountOrderCart } from './account-order.pricing';
import type {
  TransferOrderEligibilityResult,
  TransferOrderResult,
} from './account-order.types';
import { issueAccountOrderQuoteToken } from './account-order-quote-token';
import type { AcademicCheckout } from './academic-checkout';

function validateClientAuth(auth: AuthContext): void {
  if (
    auth.rol !== 'CLIENTE' ||
    !Number.isInteger(auth.id) ||
    auth.id < 1 ||
    auth.id > 2147483647
  ) {
    throw new AccountOrderError(
      'NO_AUTORIZADO', 403,
      'Esta operación requiere una cuenta de cliente.',
    );
  }
}

async function findActiveClient(
  auth: AuthContext,
  query: ReadQuery = dataSource.query.bind(dataSource),
): Promise<number> {
  const [client] = await query<{ clientId: number }[]>(`
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
  const key = await validateTransferConfirmationKey(value);
  if (!key.valid) {
    throw new AccountOrderError(key.code, 400, key.message);
  }

  return { clientId: await findActiveClient(auth), key: key.key };
}

async function recover(clientId: number, key: string): Promise<TransferOrderResult> {
  let attempt;
  try {
    attempt = await findTransferOrderAttempt(clientId, key);
  } catch {
    return pendingTransferOrder();
  }

  return attempt
    ? presentStoredTransferOrder(attempt)
    : pendingTransferOrder();
}

function rejection(error: unknown): AccountOrderError | null {
  if (error instanceof AccountOrderError) return error;

  if (error instanceof PricingError && error.status < 500) {
    return new AccountOrderError(
      error.code, 422, 'No se pudo verificar el importe del pedido.',
    );
  }

  if (
    hasDatabaseError(error, 'ER_LOCK_WAIT_TIMEOUT', 1205) ||
    hasDatabaseError(error, 'ER_LOCK_DEADLOCK', 1213) ||
    hasDatabaseError(error, 'ER_STATEMENT_TIMEOUT', 1969)
  ) {
    return new AccountOrderError(
      'CONFLICTO_CONFIRMACION', 409,
      'La operación encontró un conflicto. Revisá el resultado antes de iniciar otro intento.',
    );
  }

  return null;
}

export async function getTransferOrderEligibility(
  auth: AuthContext,
  academicCheckout?: AcademicCheckout,
): Promise<TransferOrderEligibilityResult> {
  validateClientAuth(auth);
  const clientId = await findActiveClient(auth);

  try {
    return await inTransaction(async manager => {
      const context = await lockTransferOrderContext(
        manager, auth, clientId,
      );
      const cart = await lockAccountOrderCart(
        manager, auth.id, clientId,
      );
      const quote = await quoteAccountOrderCart(
        manager, auth, cart,
        academicCheckout && { policy: academicCheckout, origin: context.origin },
      );
      const quoteToken = issueAccountOrderQuoteToken(auth, clientId, cart.cartId, quote);

      return {
        status: 200,
        body: {
          data: {
            elegible: true,
            modalidadPago: 'TRANSFERENCIA',
            moneda: 'USD',
            totalUSD: quote.totalUSD,
            codigo: null,
            mensaje: null,
            cotizacion: quoteToken,
            ...(quote.simulado ? { simulado: true as const } : {}),
          },
        },
      };
    }, { isolation: 'READ COMMITTED', lockWaitSeconds: 2 });
  } catch (error) {
    const failure = rejection(error);
    if (
      !failure ||
      (failure.status !== 403 && failure.status !== 409 && failure.status !== 422)
    ) {
      throw error;
    }

    return {
      status: 200,
      body: {
        data: {
          elegible: false,
          modalidadPago: 'TRANSFERENCIA',
          moneda: 'USD',
          totalUSD: null,
          codigo: failure.code,
          mensaje: failure.message,
          cotizacion: null,
        },
      },
    };
  }
}

export async function getTransferOrderResult(
  auth: AuthContext,
  value: unknown,
): Promise<TransferOrderResult> {
  const { clientId, key } = await identify(auth, value);
  const attempt = await findTransferOrderAttempt(clientId, key);

  return attempt ? presentStoredTransferOrder(attempt) : {
    status: 404,
    body: {
      code: 'INTENTO_NO_ENCONTRADO',
      message: 'No se encontró el intento de confirmación.',
    },
  };
}

export async function confirmTransferOrder(
  auth: AuthContext,
  value: unknown,
  quoteToken: unknown,
  notify?: NotifyCommittedChange,
  academicCheckout?: AcademicCheckout,
): Promise<TransferOrderResult> {
  const { clientId, key } = await identify(auth, value);
  const existing = await findTransferOrderAttempt(clientId, key);

  if (existing && existing.state !== 'PENDIENTE') {
    return presentStoredTransferOrder(existing);
  }

  try {
    await reserveTransferOrderAttempt(clientId, key);
  } catch {
    return recover(clientId, key);
  }

  let workFailure: { error: unknown } | undefined;
  let committed: { result: TransferOrderResult; change?: CommittedChange };

  try {
    committed = await inTransaction(async manager => {
      try {
        const attempt = await lockTransferOrderAttempt(manager, clientId, key);

        if (attempt && attempt.state !== 'PENDIENTE') {
          return { result: presentStoredTransferOrder(attempt) };
        }

        const { productIds, ...result } = await executePendingTransferOrder(
          manager, auth, clientId, key, quoteToken, academicCheckout,
        );
        const { pedidoId, estado } = result.body.data;
        return {
          result,
          change: {
            kind: 'order',
            clientId,
            order: { pedidoId, estado, modalidadPago: 'TRANSFERENCIA' },
            productIds,
          },
        };
      } catch (error) {
        workFailure = { error };
        throw error;
      }
    }, { isolation: 'READ COMMITTED', lockWaitSeconds: 2 });
  } catch (error) {
    // Solo esta coincidencia acredita un fallo del trabajo
    // que inTransaction devolvió después de confirmar el rollback.
    if (
      !workFailure ||
      workFailure.error !== error ||
      error instanceof DatabaseOutcomeUnknownError
    ) {
      return recover(clientId, key);
    }

    const failure = rejection(error);
    const status = failure?.status;

    if (
      failure &&
      (status === 400 || status === 403 || status === 409 || status === 422)
    ) {
      try {
        const saved = await inTransaction(
          manager => persistTransferOrderRejection(
            manager, clientId, key, status,
            { code: failure.code, message: failure.message },
          ),
          { isolation: 'READ COMMITTED', lockWaitSeconds: 2 },
        );
        return presentStoredTransferOrder(saved);
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

  if (committed.change) notifyAfterCommit(notify, committed.change);
  return committed.result;
}
