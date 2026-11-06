// FER17-v1 uses bounded fixed scales. BigInt keeps every intermediate exact.
// Values at this boundary are decimal strings, never JS monetary numbers.
export class PricingError extends Error {
  constructor(public readonly code: string, public readonly status = 422) {
    super(code);
  }
}

export const MONEY_MAX = 999999999999n;
export function decimal(value: unknown, scale: number, max: bigint, code = 'DATOS_COMERCIALES_INVALIDOS'): bigint {
  if (typeof value !== 'string' || value.length > 32
    || !new RegExp(`^(0|[1-9][0-9]*)(\\.[0-9]{1,${scale}})?$`).test(value)) {
    throw new PricingError(code);
  }
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole + fraction.padEnd(scale, '0'));
  if (result > max) throw new PricingError(code);
  return result;
}
export function format(value: bigint, scale = 2): string {
  const digits = value.toString().padStart(scale + 1, '0');
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
export const halfUp = (numerator: bigint, denominator: bigint): bigint =>
  (numerator + denominator / 2n) / denominator;
export function bounded(value: bigint): bigint {
  if (value > MONEY_MAX) throw new PricingError('IMPORTE_FUERA_DE_RANGO');
  return value;
}
