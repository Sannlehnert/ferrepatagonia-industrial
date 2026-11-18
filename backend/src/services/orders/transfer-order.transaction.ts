import type { EntityManager } from 'typeorm';
import type { AuthContext } from '../../types/auth';
import {
  lockTransferOrderContext,
} from '../../repositories/transferOrderContext.repository';
import {
  lockTransferOrderAttempt,
} from '../../repositories/transferOrderAttempt.repository';
import {
  lockAccountOrderCart,
  consumeAccountOrderCart,
} from '../../repositories/accountOrderCart.repository';
import {
  persistTransferOrder,
} from '../../repositories/accountOrder.repository';
import {
  completeTransferOrderAttempt,
} from '../../repositories/transferOrderResult.repository';
import { quoteAccountOrderCart } from './account-order.pricing';
import { AccountOrderError } from './account-order.errors';
import type { ConfirmedTransferOrder } from './account-order.types';
import { assertAccountOrderQuoteToken } from './account-order-quote-token';
import type { AcademicCheckout } from './academic-checkout';

export async function executePendingTransferOrder(
  manager: EntityManager,
  auth: AuthContext,
  clientId: number,
  key: string,
  quoteToken: unknown,
  academicCheckout?: AcademicCheckout,
): Promise<{ status: 201; body: { data: ConfirmedTransferOrder }; productIds: number[] }> {
  const context = await lockTransferOrderContext(
    manager,
    auth,
    clientId,
  );

  const attempt = await lockTransferOrderAttempt(
    manager,
    clientId,
    key,
  );

  if (!attempt) {
    throw new AccountOrderError(
      'INTENTO_NO_ENCONTRADO', 404,
      'No se encontró el intento de confirmación.',
    );
  }

  if (attempt.state !== 'PENDIENTE') {
    throw new AccountOrderError(
      'INTENTO_FINALIZADO', 409,
      'El intento ya tiene un resultado registrado.',
    );
  }

  const cart = await lockAccountOrderCart(manager, auth.id, clientId);
  const academic = academicCheckout && { policy: academicCheckout, origin: context.origin };
  const quote = await quoteAccountOrderCart(manager, auth, cart, academic);
  assertAccountOrderQuoteToken(quoteToken, auth, clientId, cart.cartId, quote);

  const orderId = await persistTransferOrder(manager, clientId, quote, academic);

  await consumeAccountOrderCart(manager, cart);

  const body = await completeTransferOrderAttempt(
    manager,
    clientId,
    key,
    orderId,
  );

  return { status: 201, body, productIds: cart.items.map(item => item.productId) };
}
