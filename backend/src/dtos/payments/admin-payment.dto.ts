import { integer, parseInteger, Rule } from '../rules';
import type { DtoPolicy } from '../validation';
import { invalidPaymentRequest } from '../../services/payments/admin-payment.errors';

export const ADMIN_PAYMENT_CURRENCIES = ['USD', 'ARS'] as const;
export type AdminPaymentCurrency = (typeof ADMIN_PAYMENT_CURRENCIES)[number];

export const ADMIN_PAYMENT_CREATION_STATES = ['PENDIENTE', 'ACREDITADO'] as const;
export type AdminPaymentCreationState = (typeof ADMIN_PAYMENT_CREATION_STATES)[number];

export const ADMIN_PAYMENT_STATES = [
  'PENDIENTE',
  'ACREDITADO',
  'RECHAZADO',
  'ANULADO',
] as const;
export type AdminPaymentState = (typeof ADMIN_PAYMENT_STATES)[number];

export const MAX_PAYMENT_CENTS = 999999999999n;
const AMOUNT_PATTERN = /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const PAYMENT_STATE_SET: ReadonlySet<string> = new Set(ADMIN_PAYMENT_STATES);

export function parsePaymentAmount(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const match = AMOUNT_PATTERN.exec(value);
  if (!match) return null;
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (cents <= 0n || cents > MAX_PAYMENT_CENTS) return null;
  return cents;
}

export function formatPaymentAmount(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

export function normalizePaymentIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return UUID_V4_PATTERN.test(normalized) ? normalized : null;
}

export function parseUtcIsoTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!UTC_ISO_PATTERN.test(trimmed)) return null;
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) return null;
  // Evitar rollover de fechas inexistentes como 2026-02-30T00:00:00Z
  if (parsed.toISOString().slice(0, 10) !== trimmed.slice(0, 10)) return null;
  return parsed;
}

const trimOptionalText = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimRequiredText = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.trim() : undefined;

const optionalPositiveInt = (value: unknown): unknown =>
  value === undefined || value === null ? null : value;

export class CreateAdminPaymentDto {
  @Rule(value => value === null || integer(value, 1)
    ? null : 'El identificador de pedido debe ser un entero positivo válido.')
  pedidoId!: number | null;

  @Rule(value => value === null || integer(value, 1)
    ? null : 'El identificador de cuenta corriente debe ser un entero positivo válido.')
  cuentaCorrienteId!: number | null;

  @Rule(value => parsePaymentAmount(value) !== null
    ? null : 'El monto debe ser una cadena decimal mayor a cero con hasta dos decimales.')
  monto!: string;

  @Rule(value => value === 'USD' || value === 'ARS'
    ? null : 'La moneda del pago debe ser USD o ARS.')
  moneda!: AdminPaymentCurrency;

  @Rule(value => typeof value === 'string' && value.length >= 1 && value.length <= 50 && value !== 'DEMO_METODO'
    ? null : 'El método de pago es obligatorio y debe contener entre 1 y 50 caracteres.')
  metodoPago!: string;

  @Rule(value => value === 'PENDIENTE' || value === 'ACREDITADO'
    ? null : 'El estado inicial del pago debe ser PENDIENTE o ACREDITADO.')
  estado!: AdminPaymentCreationState;

  @Rule(value => value === undefined || value === null
    || (typeof value === 'string' && value.length >= 1 && value.length <= 1000)
    ? null : 'La evidencia de acreditación debe contener entre 1 y 1000 caracteres.')
  evidenciaAcreditacion?: string | null;

  @Rule(value => value === undefined || value === null || parseUtcIsoTimestamp(value) !== null
    ? null : 'La fecha de acreditación debe ser un instante UTC válido en formato RFC 3339 (Z).')
  fechaAcreditacionUtc?: string | null;

  @Rule(value => value === undefined || value === null
    || (typeof value === 'string' && value.length >= 1 && value.length <= 2048)
    ? null : 'La referencia de comprobante debe contener entre 1 y 2048 caracteres.')
  comprobante?: string | null;

  @Rule(value => value === undefined || value === null
    || (typeof value === 'string' && value.length >= 1 && value.length <= 1000)
    ? null : 'Las observaciones deben contener entre 1 y 1000 caracteres.')
  observaciones?: string | null;
}

export class AccreditAdminPaymentDto {
  @Rule(value => typeof value === 'string' && value.length >= 1 && value.length <= 1000
    ? null : 'La evidencia de acreditación es obligatoria y debe contener hasta 1000 caracteres.')
  evidenciaAcreditacion!: string;

  @Rule(value => parseUtcIsoTimestamp(value) !== null
    ? null : 'La fecha de acreditación debe ser un instante UTC válido en formato RFC 3339 (Z).')
  fechaAcreditacionUtc!: string;

  @Rule(value => value === undefined || value === null
    || (typeof value === 'string' && value.length >= 1 && value.length <= 1000)
    ? null : 'Las observaciones deben contener entre 1 y 1000 caracteres.')
  observaciones?: string | null;
}

export class CloseAdminPaymentDto {
  @Rule(value => typeof value === 'string' && value.length >= 1 && value.length <= 1000
    ? null : 'El motivo es obligatorio y debe contener entre 1 y 1000 caracteres.')
  motivo!: string;
}

export class AdminPaymentIdParams {
  @Rule(value => integer(value, 1) ? null : 'ID de pago inválido.')
  pagoId!: number;
}

export const createAdminPaymentPolicy: DtoPolicy<CreateAdminPaymentDto> = {
  type: CreateAdminPaymentDto,
  fields: [
    'pedidoId',
    'cuentaCorrienteId',
    'monto',
    'moneda',
    'metodoPago',
    'estado',
    'evidenciaAcreditacion',
    'fechaAcreditacionUtc',
    'comprobante',
    'observaciones',
  ],
  unknownError: 'La solicitud contiene campos no permitidos.',
  objectError: 'El cuerpo de la solicitud debe ser un objeto JSON.',
  check: input => {
    const hasPedido = input.pedidoId !== undefined && input.pedidoId !== null;
    const hasCuenta = input.cuentaCorrienteId !== undefined && input.cuentaCorrienteId !== null;
    if (hasPedido === hasCuenta) {
      return 'El pago debe indicar exactamente un destino: pedidoId o cuentaCorrienteId.';
    }
    if (input.estado === 'ACREDITADO') {
      const ev = typeof input.evidenciaAcreditacion === 'string' ? input.evidenciaAcreditacion.trim() : '';
      if (!ev) return 'Acreditar un pago requiere evidenciaAcreditacion no vacía.';
      if (!parseUtcIsoTimestamp(input.fechaAcreditacionUtc)) {
        return 'Acreditar un pago requiere fechaAcreditacionUtc válida en formato UTC (Z).';
      }
    } else if (input.estado === 'PENDIENTE') {
      if ((input.evidenciaAcreditacion !== undefined && input.evidenciaAcreditacion !== null)
        || (input.fechaAcreditacionUtc !== undefined && input.fechaAcreditacionUtc !== null)) {
        return 'Un pago preliminar PENDIENTE no puede incluir evidencia ni fecha de acreditación.';
      }
    }
    return null;
  },
  prepare: input => ({
    pedidoId: optionalPositiveInt(input.pedidoId),
    cuentaCorrienteId: optionalPositiveInt(input.cuentaCorrienteId),
    monto: typeof input.monto === 'string' ? input.monto.trim() : input.monto,
    moneda: typeof input.moneda === 'string' ? input.moneda.trim() : input.moneda,
    metodoPago: trimRequiredText(input.metodoPago),
    estado: typeof input.estado === 'string' ? input.estado.trim() : input.estado,
    evidenciaAcreditacion: trimOptionalText(input.evidenciaAcreditacion),
    fechaAcreditacionUtc: trimOptionalText(input.fechaAcreditacionUtc),
    comprobante: trimOptionalText(input.comprobante),
    observaciones: trimOptionalText(input.observaciones),
  }),
};

export const accreditAdminPaymentPolicy: DtoPolicy<AccreditAdminPaymentDto> = {
  type: AccreditAdminPaymentDto,
  fields: ['evidenciaAcreditacion', 'fechaAcreditacionUtc', 'observaciones'],
  unknownError: 'La solicitud contiene campos no permitidos.',
  objectError: 'El cuerpo de la solicitud debe ser un objeto JSON.',
  prepare: input => ({
    evidenciaAcreditacion: trimRequiredText(input.evidenciaAcreditacion),
    fechaAcreditacionUtc: trimRequiredText(input.fechaAcreditacionUtc),
    observaciones: trimOptionalText(input.observaciones),
  }),
};

export const closeAdminPaymentPolicy: DtoPolicy<CloseAdminPaymentDto> = {
  type: CloseAdminPaymentDto,
  fields: ['motivo'],
  unknownError: 'La solicitud contiene campos no permitidos.',
  objectError: 'El cuerpo de la solicitud debe ser un objeto JSON.',
  prepare: input => ({
    motivo: trimRequiredText(input.motivo),
  }),
};

export const adminPaymentIdPolicy: DtoPolicy<AdminPaymentIdParams> = {
  type: AdminPaymentIdParams,
  fields: ['pagoId'],
  prepare: input => ({ pagoId: parseInteger(input.pagoId, 2147483647) }),
  unknownError: 'ID de pago inválido.',
  objectError: 'ID de pago inválido.',
};

export interface AdminPaymentListQuery {
  limite: number;
  antesDeId?: number;
  estado?: AdminPaymentState;
  pedidoId?: number;
  cuentaCorrienteId?: number;
  clienteId?: number;
}

const positiveQueryInt = (value: string, message: string): number => {
  if (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2147483647) {
    throw invalidPaymentRequest(message);
  }
  return Number(value);
};

export function parseAdminPaymentListQuery(url: string): AdminPaymentListQuery {
  const separator = url.indexOf('?');
  const params = new URLSearchParams(separator < 0 ? '' : url.slice(separator + 1));
  const allowed = ['limite', 'antesDeId', 'estado', 'pedidoId', 'cuentaCorrienteId', 'clienteId'];
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) {
      throw invalidPaymentRequest('La consulta contiene parámetros inválidos.');
    }
  }

  const query: AdminPaymentListQuery = { limite: 25 };
  if (params.has('limite')) {
    const value = params.get('limite')!;
    if (!/^(?:[1-9]|[1-9]\d|100)$/.test(value)) {
      throw invalidPaymentRequest('El límite debe ser un entero entre 1 y 100.');
    }
    query.limite = Number(value);
  }
  if (params.has('antesDeId')) {
    query.antesDeId = positiveQueryInt(params.get('antesDeId')!, 'El cursor es inválido.');
  }
  if (params.has('pedidoId')) {
    query.pedidoId = positiveQueryInt(params.get('pedidoId')!, 'El pedido es inválido.');
  }
  if (params.has('cuentaCorrienteId')) {
    query.cuentaCorrienteId = positiveQueryInt(
      params.get('cuentaCorrienteId')!,
      'La cuenta corriente es inválida.',
    );
  }
  if (params.has('clienteId')) {
    query.clienteId = positiveQueryInt(params.get('clienteId')!, 'El cliente es inválido.');
  }
  if (params.has('estado')) {
    const raw = params.get('estado')!;
    if (!PAYMENT_STATE_SET.has(raw)) {
      throw invalidPaymentRequest('El estado de pago indicado no es válido.');
    }
    query.estado = raw as AdminPaymentState;
  }

  return query;
}
