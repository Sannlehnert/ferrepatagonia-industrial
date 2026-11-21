import { parseInteger, Rule } from '../rules';
import type { DtoPolicy } from '../validation';

export const MAX_PAYMENT_CENTS = 999999999999n;
const AMOUNT_PATTERN = /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type PaymentCurrency = 'USD' | 'ARS';
export type PaymentDocumentState = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';
export type PaymentFinancialState = 'PENDIENTE' | 'ACREDITADO' | 'RECHAZADO' | 'ANULADO';

export function parsePaymentAmount(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const match = AMOUNT_PATTERN.exec(value);
  if (!match) return null;
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (cents <= 0n || cents > MAX_PAYMENT_CENTS) return null;
  return cents;
}

export function formatPaymentAmount(cents: bigint): string {
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

const UTC_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function parseUtcIsoTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!UTC_ISO_PATTERN.test(trimmed)) return null;
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) return null;
  if (parsed.toISOString().slice(0, 10) !== trimmed.slice(0, 10)) return null;
  return parsed;
}

export function normalizePaymentIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return UUID_V4_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeReceiptId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return UUID_V4_PATTERN.test(normalized) ? normalized : null;
}

const optionalText = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim() : value;

const requiredText = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class DeclarePayment {
  @Rule(value => parsePaymentAmount(value) !== null
    ? null
    : 'El importe debe ser una cadena decimal mayor a cero con hasta dos decimales.')
  monto!: string;

  @Rule(value => value === 'USD' || value === 'ARS'
    ? null
    : 'La moneda debe ser USD o ARS.')
  moneda!: PaymentCurrency;

  @Rule(value => normalizeReceiptId(value) !== null
    ? null
    : 'Indicá un comprobante válido.')
  comprobanteId!: string;

  @Rule(value => value === undefined || value === null
    ? null
    : typeof value === 'string' && value.length > 0 && value.length <= 1000
      ? null
      : 'Las observaciones deben contener hasta 1000 caracteres.')
  observaciones?: string | null;
}

export class ReviewPayment {
  @Rule(value => value === 'APROBADO' || value === 'RECHAZADO'
    ? null
    : 'La decisión debe ser APROBADO o RECHAZADO.')
  decision!: 'APROBADO' | 'VALIDADO' | 'RECHAZADO';

  @Rule(value => value === undefined || value === null
    ? null
    : typeof value === 'string' && value.length > 0 && value.length <= 1000
      ? null
      : 'El motivo debe contener hasta 1000 caracteres.')
  motivo?: string | null;
}

export class AccreditPayment {
  @Rule(value => value === undefined || value === null
    || (typeof value === 'string' && value.length > 0 && value.length <= 1000)
    ? null
    : 'La evidencia de acreditación es obligatoria y debe contener hasta 1000 caracteres.')
  evidencia?: string;

  @Rule(value => value === undefined || value === null
    || (typeof value === 'string' && value.length > 0 && value.length <= 1000)
    ? null
    : 'La evidencia de acreditación es obligatoria y debe contener hasta 1000 caracteres.')
  evidenciaAcreditacion?: string;

  @Rule(value => value === undefined || value === null || parseUtcIsoTimestamp(value) !== null
    ? null
    : 'La fecha de acreditación debe ser un instante UTC válido en formato RFC 3339 (Z).')
  fechaAcreditacionUtc?: string;

  @Rule(value => value === undefined || value === null
    ? null
    : typeof value === 'string' && value.length > 0 && value.length <= 1000
      ? null
      : 'Las observaciones deben contener hasta 1000 caracteres.')
  observaciones?: string | null;
}

export class PaymentIdParams {
  @Rule(value => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 2147483647
    ? null
    : 'ID de pago inválido.')
  id!: number;
}

const bodyPolicy = <T extends object>(
  type: DtoPolicy<T>['type'],
  fields: readonly string[],
  prepare?: (input: Record<string, unknown>) => Record<string, unknown>,
): DtoPolicy<T> => ({
  type,
  fields,
  prepare,
  unknownError: 'La solicitud contiene campos no permitidos.',
  objectError: 'El cuerpo de la solicitud debe ser un objeto JSON.',
});

export const declarePaymentPolicy: DtoPolicy<DeclarePayment> = bodyPolicy(
  DeclarePayment,
  ['monto', 'moneda', 'comprobanteId', 'observaciones'],
  input => ({
    monto: typeof input.monto === 'string' ? input.monto.trim() : input.monto,
    moneda: input.moneda,
    comprobanteId: typeof input.comprobanteId === 'string'
      ? input.comprobanteId.trim().toLowerCase() : input.comprobanteId,
    observaciones: input.observaciones === null ? null : optionalText(input.observaciones),
  }),
);

export const reviewPaymentPolicy: DtoPolicy<ReviewPayment> = bodyPolicy(
  ReviewPayment,
  ['decision', 'motivo'],
  input => {
    const normalized = typeof input.decision === 'string'
      ? input.decision.trim().toUpperCase() : input.decision;
    return {
      decision: normalized === 'VALIDADO' ? 'APROBADO' : normalized,
      motivo: input.motivo === null ? null : optionalText(input.motivo),
    };
  },
);

export const accreditPaymentPolicy: DtoPolicy<AccreditPayment> = {
  ...bodyPolicy(
    AccreditPayment,
    ['evidencia', 'evidenciaAcreditacion', 'fechaAcreditacionUtc', 'observaciones'],
    input => ({
      evidencia: requiredText(input.evidencia),
      evidenciaAcreditacion: requiredText(input.evidenciaAcreditacion),
      fechaAcreditacionUtc: requiredText(input.fechaAcreditacionUtc),
      observaciones: input.observaciones === null ? null : optionalText(input.observaciones),
    }),
  ),
  check: input => {
    const evidence = typeof input.evidencia === 'string' && input.evidencia.trim().length > 0
      ? input.evidencia.trim()
      : typeof input.evidenciaAcreditacion === 'string' && input.evidenciaAcreditacion.trim().length > 0
        ? input.evidenciaAcreditacion.trim()
        : '';
    return evidence ? null : 'La evidencia de acreditación es obligatoria.';
  },
};

export const paymentIdPolicy: DtoPolicy<PaymentIdParams> = {
  type: PaymentIdParams,
  fields: ['id'],
  prepare: input => ({ id: parseInteger(input.id, 2147483647) }),
  unknownError: 'ID de pago inválido.',
  objectError: 'ID de pago inválido.',
};

export interface PaymentListQuery {
  pagina: number;
}

export function parsePaymentListQuery(url: string): PaymentListQuery {
  const separator = url.indexOf('?');
  if (separator < 0) return { pagina: 1 };
  const raw = url.slice(separator + 1);
  if (!raw) throw new Error('CONSULTA_INVALIDA');
  const pairs = raw.split('&');
  const seen = new Set<string>();
  for (const pair of pairs) {
    if (!pair) throw new Error('CONSULTA_INVALIDA');
    const equals = pair.indexOf('=');
    const key = equals < 0 ? pair : pair.slice(0, equals);
    const value = equals < 0 ? '' : pair.slice(equals + 1);
    if (key !== 'pagina' || seen.has(key) || !/^[1-9]\d{0,7}$/.test(value)) {
      throw new Error('CONSULTA_INVALIDA');
    }
    seen.add(key);
  }
  return { pagina: Number(raw.slice(raw.indexOf('=') + 1)) };
}
