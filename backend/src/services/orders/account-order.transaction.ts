import type { EntityManager } from 'typeorm';
import type { AuthContext } from '../../types/auth';
import {
  lockAccountOrderContext,
} from '../../repositories/accountOrderContext.repository';
import {
  lockAccountOrderAttempt,
} from '../../repositories/accountOrderAttempt.repository';
import {
  lockAccountOrderCart,
  consumeAccountOrderCart,
} from '../../repositories/accountOrderCart.repository';
import {
  persistAccountOrder,
} from '../../repositories/accountOrder.repository';
import {
  completeAccountOrderAttempt,
} from '../../repositories/accountOrderResult.repository';
import {
  registrarCargoPorPedido,
  toCents,
} from '../../repositories/cuentaCorriente.repository';
import { quoteAccountOrderCart } from './account-order.pricing';
import { AccountOrderError } from './account-order.errors';
import type { ConfirmedAccountOrder } from './account-order.types';
import { assertAccountOrderQuoteToken } from './account-order-quote-token';
import { academicOrderNote, type AcademicCheckout } from './academic-checkout';

export async function executePendingAccountOrder(
  manager: EntityManager,
  auth: AuthContext,
  clientId: number,
  key: string,
  quoteToken: unknown,
  academicCheckout?: AcademicCheckout,
): Promise<{ status: 201; body: { data: ConfirmedAccountOrder }; productIds: number[] }> {
  const context = await lockAccountOrderContext(
    manager,
    auth,
    clientId,
  );

  const attempt = await lockAccountOrderAttempt(
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

  if (toCents(quote.totalUSD) > toCents(context.availableUSD)) {
    throw new AccountOrderError(
      'CREDITO_INSUFICIENTE', 409,
      'El crédito disponible no alcanza para confirmar el pedido.',
    );
  }

  const orderId = await persistAccountOrder(manager, clientId, quote, academic);

  const chargeId = await registrarCargoPorPedido({
    id_cuenta_corriente: context.accountId,
    id_pedido: orderId,
    monto: quote.totalUSD,
    moneda: 'USD',
    ...(quote.simulado ? { observaciones: academicOrderNote } : {}),
  }, manager);

  await consumeAccountOrderCart(manager, cart);

  const body = await completeAccountOrderAttempt(
    manager,
    clientId,
    key,
    orderId,
    chargeId,
  );

  return { status: 201, body, productIds: cart.items.map(item => item.productId) };
}
