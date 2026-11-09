import type { EntityManager } from 'typeorm';
import type { AuthContext } from '../../types/auth';
import type {
  LockedOrderCart,
} from '../../repositories/accountOrderCart.repository';
import {
  lockAccountOrderPriceInputs,
} from '../../repositories/accountOrderPricing.repository';
import { MariaDbPricingSource } from '../../repositories/pricing.source';
import {
  PricingService,
  sumAmounts,
} from '../pricing/pricing.service';
import { PricingError } from '../pricing/money';
import type { PriceLine } from '../pricing/pricing.types';
import { AccountOrderError } from './account-order.errors';

export interface AccountOrderQuote {
  regla: 'FER17-v1';
  moneda: 'USD';
  ivaIncluido: true;
  aplicadoEn: string;
  totalUSD: string;
  lines: PriceLine[];
}

// Se usa después de bloquear el carrito y sus productos,
// dentro de la transacción de compra READ COMMITTED.
export async function quoteAccountOrderCart(
  manager: EntityManager,
  auth: AuthContext,
  cart: LockedOrderCart,
): Promise<AccountOrderQuote> {
  if (auth.rol !== 'CLIENTE') {
    throw new AccountOrderError(
      'NO_AUTORIZADO',
      403,
      'Esta operación requiere una cuenta de cliente.',
    );
  }

  await lockAccountOrderPriceInputs(
    manager,
    auth.id,
    cart.cartId,
    cart.items.map(item => item.productId),
  );

  const at = new Date();
  const pricing = new PricingService(
    new MariaDbPricingSource(undefined, manager),
  );
  const lines: PriceLine[] = [];

  try {
    for (let start = 0; start < cart.items.length; start += 100) {
      const batch = cart.items.slice(start, start + 100);
      const quoted = await pricing.quoteCartLines(
        batch.map(item => ({
          productoId: item.productId,
          cantidad: item.quantity,
        })),
        auth,
        at,
      );

      for (const item of batch) {
        const line = quoted.get(item.productId);

        if (typeof line === 'string') {
          throw new AccountOrderError(
            line,
            422,
            'No se pudo obtener un precio comprable.',
          );
        }

        if (!line || !line.precioComprable ||
          line.precioUnitarioUSD === null ||
          line.subtotalUSD === null ||
          !line.evidenciaBaseUSD) {
          throw new AccountOrderError(
            line?.estadoPrecio ?? 'PRECIO_NO_DISPONIBLE',
            422,
            'El carrito contiene un precio no disponible.',
          );
        }

        if (line.evidenciaBaseUSD.synthetic) {
          throw new AccountOrderError(
            'PRECIO_SINTETICO',
            422,
            'Los precios de demostración no permiten confirmar pedidos.',
          );
        }

        lines.push(line);
      }
    }

    if (lines.length === 0) {
      throw new AccountOrderError(
        'CARRITO_VACIO',
        422,
        'El carrito está vacío.',
      );
    }

    return {
      regla: 'FER17-v1',
      moneda: 'USD',
      ivaIncluido: true,
      aplicadoEn: at.toISOString(),
      totalUSD: sumAmounts(lines.map(line => line.subtotalUSD!)),
      lines,
    };
  } catch (error) {
    if (!(error instanceof PricingError)) throw error;

    throw new AccountOrderError(
      error.code,
      error.status >= 500 ? 503 :
        error.status === 403 ? 403 : 422,
      'No se pudieron verificar los precios del pedido.',
    );
  }
}