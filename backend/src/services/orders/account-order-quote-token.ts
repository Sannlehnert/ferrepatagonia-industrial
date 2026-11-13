import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.config';
import type { AuthContext } from '../../types/auth';
import type { AccountOrderQuote } from './account-order.pricing';
import { AccountOrderError } from './account-order.errors';

interface Claims {
  v: 1;
  uid: number;
  cid: number;
  cartId: number;
  fingerprint: string;
  exp: number;
}

function fingerprint(cartId: number, quote: AccountOrderQuote): string {
  const lines = quote.lines.map(line => ({
    productoId: line.productoId,
    moneda: line.moneda,
    precioBaseUSD: line.precioBaseUSD,
    descuentoAplicado: line.descuentoAplicado,
    origenDescuento: line.origenDescuento,
    precioUnitarioUSD: line.precioUnitarioUSD,
    cantidad: line.cantidad,
    subtotalUSD: line.subtotalUSD,
    subtotalARS: line.subtotalARS,
    estadoPrecio: line.estadoPrecio,
    precioComprable: line.precioComprable,
    evidenciaBaseUSD: line.evidenciaBaseUSD,
  })).sort((a, b) => a.productoId - b.productoId);
  return createHmac('sha256', env.jwtSecret)
    .update(JSON.stringify({ cartId, totalUSD: quote.totalUSD, lines, simulado: quote.simulado }))
    .digest('hex');
}

function signature(payload: string): Buffer {
  return createHmac('sha256', env.jwtSecret).update(payload).digest();
}

export function issueAccountOrderQuoteToken(
  auth: AuthContext,
  clientId: number,
  cartId: number,
  quote: AccountOrderQuote,
): string {
  const claims: Claims = {
    v: 1, uid: auth.id, cid: clientId, cartId,
    fingerprint: fingerprint(cartId, quote),
    exp: Math.floor(Date.now() / 1000) + 20 * 60,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}

export function assertAccountOrderQuoteToken(
  token: unknown,
  auth: AuthContext,
  clientId: number,
  cartId: number,
  quote: AccountOrderQuote,
): void {
  if (typeof token !== 'string' || token.length > 2048) throw staleQuote();
  const [payload, supplied, extra] = token.split('.');
  if (!payload || !supplied || extra !== undefined) throw staleQuote();
  let actual: Buffer;
  try { actual = Buffer.from(supplied, 'base64url'); } catch { throw staleQuote(); }
  const expected = signature(payload);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw staleQuote();
  let claims: Claims;
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Claims; }
  catch { throw staleQuote(); }
  if (claims.v !== 1 || claims.uid !== auth.id || claims.cid !== clientId ||
      claims.cartId !== cartId || !Number.isInteger(claims.exp) ||
      claims.exp <= Math.floor(Date.now() / 1000) ||
      claims.fingerprint !== fingerprint(cartId, quote)) throw staleQuote();
}

function staleQuote(): AccountOrderError {
  return new AccountOrderError(
    'COTIZACION_DESACTUALIZADA', 409,
    'El carrito o sus precios cambiaron. Revisá el nuevo total y aceptalo para continuar.',
  );
}
