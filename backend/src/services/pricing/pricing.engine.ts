import { bounded, decimal, format, halfUp, MONEY_MAX, PricingError } from './money';
import type { PriceProduct, PriceItem, PriceLine } from './pricing.types';

export function calculateLine(product: PriceProduct, item: PriceItem, listPercent: string,
  rate: string | null = null): PriceLine {
  if (!Number.isInteger(item.cantidad) || item.cantidad < 1 || item.cantidad > 2147483647) {
    throw new PricingError('CANTIDAD_INVALIDA', 400);
  }
  const list = decimal(listPercent, 2, 9999n);
  const special = decimal(product.specialPercent ?? '0', 2, 9999n);
  const discount = list > special ? list : special;
  const base = product.baseUSD === null ? null : decimal(product.baseUSD, 2, MONEY_MAX);
  const unit = base === null ? null : halfUp(base * (10000n - discount), 10000n);
  const subtotal = unit === null ? null : bounded(unit * BigInt(item.cantidad));
  let converted: bigint | null = null;
  if (rate !== null) {
    const exactRate = decimal(rate, 8, 99999999999999999999n, 'COTIZACION_INVALIDA');
    if (exactRate === 0n) throw new PricingError('COTIZACION_INVALIDA');
    if (subtotal !== null) converted = bounded(halfUp(subtotal * exactRate, 100000000n));
  }
  const state = base === null ? 'PRECIO_AUSENTE' : base === 0n ? 'BASE_CERO'
    : unit === 0n ? 'FINAL_CERO' : converted === 0n ? 'ARS_CERO' : 'DEFINIDO';
  return {
    productoId: product.id, moneda: rate === null ? 'USD' : 'ARS',
    precioBaseUSD: base === null ? null : format(base), descuentoAplicado: format(discount),
    origenDescuento: discount === 0n ? 'NINGUNO' : list === special ? 'AMBOS'
      : list > special ? 'LISTA' : 'ESPECIAL_PUBLICO',
    precioUnitarioUSD: unit === null ? null : format(unit), cantidad: item.cantidad,
    subtotalUSD: subtotal === null ? null : format(subtotal),
    subtotalARS: converted === null ? null : format(converted),
    estadoPrecio: state, precioComprable: state === 'DEFINIDO',
  };
}
