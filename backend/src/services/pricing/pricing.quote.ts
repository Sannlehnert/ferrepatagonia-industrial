import { decimal, format, PricingError } from './money';
import type { VerifiedCalendar, VerifiedQuote, PriceResult } from './pricing.types';

const present = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function verifiedTime(value: string, now: Date): number {
  const time = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(time) || time > now.getTime()) throw new PricingError('COTIZACION_INVALIDA');
  const civil = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(civil.getTime()) || civil.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new PricingError('COTIZACION_INVALIDA');
  }
  return time;
}
export function resolveQuote(calendar: VerifiedCalendar | null, quote: VerifiedQuote | null,
  now: Date): NonNullable<PriceResult['cotizacion']> {
  if (!calendar) throw new PricingError('CALENDARIO_NO_VERIFICADO');
  if (![calendar.version, calendar.verifiedBy, calendar.evidence].every(present)) throw new PricingError('CALENDARIO_NO_VERIFICADO');
  verifiedTime(calendar.verifiedAt, now);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const previous = new Date(`${date}T12:00:00Z`);
  let reference: string | undefined;
  // A bounded walk also rejects malformed/uncovered calendars deterministically.
  for (let i = 0; i < 366; i++) {
    previous.setUTCDate(previous.getUTCDate() - 1);
    const key = previous.toISOString().slice(0, 10);
    if (!Object.hasOwn(calendar.days, key) || typeof calendar.days[key] !== 'boolean') {
      throw new PricingError('CALENDARIO_NO_VERIFICADO');
    }
    const weekend = previous.getUTCDay() === 0 || previous.getUTCDay() === 6;
    if (weekend && calendar.days[key]) throw new PricingError('CALENDARIO_NO_VERIFICADO');
    if (calendar.days[key]) { reference = key; break; }
  }
  if (!reference) throw new PricingError('CALENDARIO_NO_VERIFICADO');
  if (!quote) throw new PricingError('COTIZACION_AUSENTE');
  if (quote.valid !== true || quote.referenceDate !== reference || ![quote.id, quote.actor, quote.evidence].every(present)) {
    throw new PricingError('COTIZACION_INVALIDA');
  }
  const loaded = verifiedTime(quote.loadedAt, now);
  const loadedDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(loaded));
  if (loadedDate < reference) throw new PricingError('COTIZACION_INVALIDA');
  if (verifiedTime(quote.verifiedAt, now) < loaded) throw new PricingError('COTIZACION_INVALIDA');
  const rate = decimal(quote.rate, 8, 99999999999999999999n, 'COTIZACION_INVALIDA');
  if (!rate) throw new PricingError('COTIZACION_INVALIDA');
  return { id: quote.id, valor: format(rate, 8), fechaReferencia: reference,
    fechaCarga: quote.loadedAt, verificadaEn: quote.verifiedAt, evidencia: quote.evidence,
    calendarioVersion: calendar.version };
}
