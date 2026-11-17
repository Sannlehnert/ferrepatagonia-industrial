import { integer, parseInteger, Rule } from '../rules';
import type { DtoPolicy } from '../validation';
import { invalidCreditRequest } from '../../services/credit/credit-workflow.errors';

export type CreditRequestState = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';

/** DECIMAL(12,2): 10 enteros y 2 decimales. Se opera siempre con BigInt. */
export const MAX_CREDIT_CENTS = 999999999999n;
const AMOUNT_PATTERN = /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/;
const IDEMPOTENCY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REQUEST_STATES = new Set<CreditRequestState>(['PENDIENTE', 'APROBADA', 'RECHAZADA']);
const EVENT_TYPES = [
  'SOLICITUD_CREADA', 'SOLICITUD_APROBADA', 'SOLICITUD_RECHAZADA',
  'CUENTA_HABILITADA', 'CUENTA_DESHABILITADA', 'LIMITE_MODIFICADO',
] as const;
export type CreditEventType = typeof EVENT_TYPES[number];
const EVENT_TYPE_SET: ReadonlySet<string> = new Set(EVENT_TYPES);

function isCreditEventType(value: string): value is CreditEventType {
  return EVENT_TYPE_SET.has(value);
}

export function parseCreditAmount(value: unknown, allowZero = false): bigint | null {
  if (typeof value !== 'string') return null;
  const match = AMOUNT_PATTERN.exec(value);
  if (!match) return null;
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (cents > MAX_CREDIT_CENTS) return null;
  if (!allowZero && cents === 0n) return null;
  return cents;
}

export function formatCreditAmount(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

export function normalizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return IDEMPOTENCY_PATTERN.test(normalized) ? normalized : null;
}

// Preserve supplied values so the rules can reject non-text and blank text.
const optionalText = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim() : value;

const requiredText = (value: unknown, _max: number): string | undefined =>
  typeof value === 'string' ? value.trim() : undefined;

const amountMessage = (allowZero: boolean) => allowZero
  ? 'El límite debe ser una cadena decimal USD no negativa con hasta dos decimales.'
  : 'El monto solicitado debe ser una cadena decimal USD mayor a cero con hasta dos decimales.';

export class CreateCreditRequest {
  @Rule(value => parseCreditAmount(value, false) !== null ? null : amountMessage(false))
  montoSolicitado!: string;

  @Rule(value => value === 30 || value === 60 ? null : 'El plazo debe ser 30 o 60 días.')
  plazoDias!: number;

  @Rule(value => value === undefined || value === null
    || (typeof value === 'string' && value.length > 0 && value.length <= 1000)
    ? null
    : 'Las observaciones deben contener hasta 1000 caracteres.')
  observaciones?: string | null;
}

export class ApproveCreditRequest {
  @Rule(value => parseCreditAmount(value, false) !== null ? null : amountMessage(false))
  limiteAutorizado!: string;

  @Rule(value => value === 30 || value === 60 ? null : 'El plazo debe ser 30 o 60 días.')
  plazoDias!: number;

  @Rule(value => typeof value === 'string' && value.length > 0 && value.length <= 1000
    ? null
    : 'La evidencia comercial es obligatoria y debe contener hasta 1000 caracteres.')
  evidencia!: string;

  @Rule(value => typeof value === 'string' && value.length > 0 && value.length <= 1000
    ? null
    : 'El motivo es obligatorio y debe contener hasta 1000 caracteres.')
  motivo!: string;
}

export class RejectCreditRequest {
  @Rule(value => typeof value === 'string' && value.length > 0 && value.length <= 1000
    ? null
    : 'El motivo es obligatorio y debe contener hasta 1000 caracteres.')
  motivo!: string;

  @Rule(value => value === undefined || value === null
    || (typeof value === 'string' && value.length > 0 && value.length <= 1000)
    ? null
    : 'La evidencia debe contener hasta 1000 caracteres.')
  evidencia?: string | null;
}

export class EnableCreditAccount {
  @Rule(value => typeof value === 'string' && value.length > 0 && value.length <= 1000
    ? null
    : 'La evidencia comercial es obligatoria y debe contener hasta 1000 caracteres.')
  evidencia!: string;

  @Rule(value => value === undefined || value === null
    || (typeof value === 'string' && value.length > 0 && value.length <= 1000)
    ? null
    : 'El motivo debe contener hasta 1000 caracteres.')
  motivo?: string | null;
}

export class DisableCreditAccount {
  @Rule(value => typeof value === 'string' && value.length > 0 && value.length <= 1000
    ? null
    : 'El motivo es obligatorio y debe contener hasta 1000 caracteres.')
  motivo!: string;

  @Rule(value => value === undefined || value === null
    || (typeof value === 'string' && value.length > 0 && value.length <= 1000)
    ? null
    : 'La evidencia debe contener hasta 1000 caracteres.')
  evidencia?: string | null;
}

export class ChangeCreditLimit {
  @Rule(value => parseCreditAmount(value, true) !== null ? null : amountMessage(true))
  limite!: string;

  @Rule(value => typeof value === 'string' && value.length > 0 && value.length <= 1000
    ? null
    : 'La evidencia comercial es obligatoria y debe contener hasta 1000 caracteres.')
  evidencia!: string;

  @Rule(value => typeof value === 'string' && value.length > 0 && value.length <= 1000
    ? null
    : 'El motivo es obligatorio y debe contener hasta 1000 caracteres.')
  motivo!: string;
}

export class CreditRequestIdParams {
  @Rule(value => integer(value, 1) ? null : 'ID de solicitud inválido.')
  id!: number;
}

export class CreditClientIdParams {
  @Rule(value => integer(value, 1) ? null : 'ID de cliente inválido.')
  clienteId!: number;
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

export const createCreditRequestPolicy: DtoPolicy<CreateCreditRequest> = bodyPolicy(
  CreateCreditRequest,
  ['montoSolicitado', 'plazoDias', 'observaciones'],
  input => ({
    montoSolicitado: typeof input.montoSolicitado === 'string'
      ? input.montoSolicitado.trim() : input.montoSolicitado,
    plazoDias: input.plazoDias,
    observaciones: optionalText(input.observaciones),
  }),
);

export const approveCreditRequestPolicy: DtoPolicy<ApproveCreditRequest> = bodyPolicy(
  ApproveCreditRequest,
  ['limiteAutorizado', 'plazoDias', 'evidencia', 'motivo'],
  input => ({
    limiteAutorizado: requiredText(input.limiteAutorizado, 13),
    plazoDias: input.plazoDias,
    evidencia: requiredText(input.evidencia, 1000),
    motivo: requiredText(input.motivo, 1000),
  }),
);

export const rejectCreditRequestPolicy: DtoPolicy<RejectCreditRequest> = bodyPolicy(
  RejectCreditRequest,
  ['motivo', 'evidencia'],
  input => ({
    motivo: requiredText(input.motivo, 1000),
    evidencia: optionalText(input.evidencia),
  }),
);

export const enableCreditAccountPolicy: DtoPolicy<EnableCreditAccount> = bodyPolicy(
  EnableCreditAccount,
  ['evidencia', 'motivo'],
  input => ({
    evidencia: requiredText(input.evidencia, 1000),
    motivo: optionalText(input.motivo),
  }),
);

export const disableCreditAccountPolicy: DtoPolicy<DisableCreditAccount> = bodyPolicy(
  DisableCreditAccount,
  ['motivo', 'evidencia'],
  input => ({
    motivo: requiredText(input.motivo, 1000),
    evidencia: optionalText(input.evidencia),
  }),
);

export const changeCreditLimitPolicy: DtoPolicy<ChangeCreditLimit> = bodyPolicy(
  ChangeCreditLimit,
  ['limite', 'evidencia', 'motivo'],
  input => ({
    limite: typeof input.limite === 'string' ? input.limite.trim() : input.limite,
    evidencia: requiredText(input.evidencia, 1000),
    motivo: requiredText(input.motivo, 1000),
  }),
);

export const creditRequestIdPolicy: DtoPolicy<CreditRequestIdParams> = {
  type: CreditRequestIdParams,
  fields: ['id'],
  prepare: input => ({ id: parseInteger(input.id, 2147483647) }),
  unknownError: 'ID de solicitud inválido.',
  objectError: 'ID de solicitud inválido.',
};

export const creditClientIdPolicy: DtoPolicy<CreditClientIdParams> = {
  type: CreditClientIdParams,
  fields: ['clienteId'],
  prepare: input => ({ clienteId: parseInteger(input.clienteId, 2147483647) }),
  unknownError: 'ID de cliente inválido.',
  objectError: 'ID de cliente inválido.',
};

export interface CreditRequestListQuery {
  limite: number;
  antesDeId?: number;
  estado?: CreditRequestState;
  clienteId?: number;
}

export interface CreditEventListQuery {
  limite: number;
  antesDeId?: number;
  clienteId?: number;
  solicitudId?: number;
  tipo?: CreditEventType;
}

const positiveQueryInt = (value: string, message: string): number => {
  if (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2147483647) {
    throw invalidCreditRequest(message);
  }
  return Number(value);
};

function queryParams(url: string): URLSearchParams {
  const separator = url.indexOf('?');
  return new URLSearchParams(separator < 0 ? '' : url.slice(separator + 1));
}

function assertQueryKeys(params: URLSearchParams, allowed: readonly string[]): void {
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) {
      throw invalidCreditRequest('La consulta contiene parámetros inválidos.');
    }
  }
}

export function parseCreditRequestListQuery(url: string, admin: boolean): CreditRequestListQuery {
  const params = queryParams(url);
  assertQueryKeys(params, admin
    ? ['limite', 'antesDeId', 'estado', 'clienteId']
    : ['limite', 'antesDeId']);
  const query: CreditRequestListQuery = { limite: 25 };
  if (params.has('limite')) {
    const value = params.get('limite')!;
    if (!/^(?:[1-9]|[1-9]\d|100)$/.test(value)) {
      throw invalidCreditRequest('El límite debe ser un entero entre 1 y 100.');
    }
    query.limite = Number(value);
  }
  if (params.has('antesDeId')) {
    query.antesDeId = positiveQueryInt(params.get('antesDeId')!, 'El cursor es inválido.');
  }
  if (params.has('clienteId')) {
    query.clienteId = positiveQueryInt(params.get('clienteId')!, 'El cliente es inválido.');
  }
  if (params.has('estado')) {
    const raw = params.get('estado')!.toUpperCase() as CreditRequestState;
    if (!REQUEST_STATES.has(raw)) throw invalidCreditRequest('El estado es inválido.');
    query.estado = raw;
  }
  return query;
}

export function parseCreditEventListQuery(url: string): CreditEventListQuery {
  const params = queryParams(url);
  assertQueryKeys(params, ['limite', 'antesDeId', 'clienteId', 'solicitudId', 'tipo']);
  const query: CreditEventListQuery = { limite: 50 };
  if (params.has('limite')) {
    const value = params.get('limite')!;
    if (!/^(?:[1-9]|[1-9]\d|100)$/.test(value)) {
      throw invalidCreditRequest('El límite debe ser un entero entre 1 y 100.');
    }
    query.limite = Number(value);
  }
  if (params.has('antesDeId')) {
    query.antesDeId = positiveQueryInt(params.get('antesDeId')!, 'El cursor es inválido.');
  }
  if (params.has('clienteId')) {
    query.clienteId = positiveQueryInt(params.get('clienteId')!, 'El cliente es inválido.');
  }
  if (params.has('solicitudId')) {
    query.solicitudId = positiveQueryInt(params.get('solicitudId')!, 'La solicitud es inválida.');
  }
  if (params.has('tipo')) {
    const value = params.get('tipo')!;
    if (!isCreditEventType(value)) throw invalidCreditRequest('El tipo de evento es inválido.');
    query.tipo = value;
  }
  return query;
}
