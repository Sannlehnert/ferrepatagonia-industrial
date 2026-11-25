import type {
  AdminCreditCompany,
  AdminCreditCompanyAccount,
  AdminCreditCompanyPage,
  AdminCreditCompanyRequest,
  AdminCreditEvent,
  AdminCreditEventPage,
  CreditCompanyApproval,
  CreditCompanyRequestState,
  CreditEventType,
} from '@/types/adminCreditCompany'

const invalid = (): never => { throw new Error('La respuesta de empresas y crédito no es válida.') }
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : invalid()
const text = (value: unknown): value is string => typeof value === 'string'
const id = (value: unknown) => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2147483647
const nullableId = (value: unknown) => value === null || id(value)
const decimal = (value: unknown, signed = false) => typeof value === 'string' &&
  (signed ? /^-?(?:0|[1-9]\d*)\.\d{2}$/ : /^(?:0|[1-9]\d*)\.\d{2}$/).test(value) && value !== '-0.00'
const nullableDecimal = (value: unknown, signed = false) => value === null || decimal(value, signed)
const utc = (value: unknown) => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) &&
  !Number.isNaN(Date.parse(value))
const nullableUtc = (value: unknown) => value === null || utc(value)
const term = (value: unknown) => value === null || value === 30 || value === 60
const approvalValues = new Set<CreditCompanyApproval>(['PENDIENTE', 'APROBADA', 'RECHAZADA'])
const requestValues = new Set<CreditCompanyRequestState>(['PENDIENTE', 'APROBADA', 'RECHAZADA'])
const eventValues = new Set<CreditEventType>([
  'SOLICITUD_CREADA', 'SOLICITUD_APROBADA', 'SOLICITUD_RECHAZADA',
  'CUENTA_HABILITADA', 'CUENTA_DESHABILITADA', 'LIMITE_MODIFICADO',
])

function account(raw: unknown): AdminCreditCompanyAccount {
  const value = object(raw)
  if (!id(value.cuentaId) ||
    (value.estado !== 'HABILITADA' && value.estado !== 'INHABILITADA') ||
    !nullableDecimal(value.limite) || value.moneda !== 'USD' || !term(value.plazoDias) ||
    !['COMPLETA', 'PARCIAL', 'NO_ACREDITADA'].includes(String(value.cobertura)) ||
    (value.origen !== 'REAL' && value.origen !== 'DEMO')) invalid()
  return value as unknown as AdminCreditCompanyAccount
}

function request(raw: unknown): AdminCreditCompanyRequest {
  const value = object(raw)
  if (!id(value.id) || !requestValues.has(value.estado as CreditCompanyRequestState) ||
    !decimal(value.montoSolicitado) || (value.plazoDias !== 30 && value.plazoDias !== 60) ||
    !nullableUtc(value.fechaSolicitud) || !nullableUtc(value.fechaResolucion) ||
    !nullableDecimal(value.limiteAutorizado) || !term(value.plazoAutorizado)) invalid()
  return value as unknown as AdminCreditCompanyRequest
}

function company(raw: unknown): AdminCreditCompany {
  const value = object(raw)
  const nombreRazonSocial = value.nombreRazonSocial
  const email = value.email
  const cuit = value.cuit
  const activo = value.activo
  if (!id(value.clienteId) || !text(nombreRazonSocial) || !text(email) ||
    !(cuit === null || typeof cuit === 'string') ||
    !(value.estadoAprobacionEmpresa === null ||
      approvalValues.has(value.estadoAprobacionEmpresa as CreditCompanyApproval)) ||
    typeof activo !== 'boolean' ||
    !(value.cuentaCorriente === null || typeof value.cuentaCorriente === 'object') ||
    !(value.solicitudCredito === null || typeof value.solicitudCredito === 'object')) invalid()
  return {
    clienteId: Number(value.clienteId),
    nombreRazonSocial: nombreRazonSocial as string,
    cuit: cuit as string | null,
    email: email as string,
    estadoAprobacionEmpresa: value.estadoAprobacionEmpresa as CreditCompanyApproval | null,
    activo: activo as boolean,
    cuentaCorriente: value.cuentaCorriente === null ? null : account(value.cuentaCorriente),
    solicitudCredito: value.solicitudCredito === null ? null : request(value.solicitudCredito),
  }
}

export function decodeAdminCreditCompanyPage(raw: unknown): AdminCreditCompanyPage {
  const value = object(object(raw).data)
  const empresas = value.empresas
  if (!Array.isArray(empresas)) invalid()
  const pagination = object(value.paginacion)
  if (![pagination.page, pagination.limit, pagination.totalPages].every(Number.isInteger) ||
    Number(pagination.page) < 1 || Number(pagination.limit) < 1 || Number(pagination.limit) > 100 ||
    Number(pagination.totalPages) < 0 || !Number.isInteger(pagination.total) || Number(pagination.total) < 0) {
    invalid()
  }
  return {
    empresas: (empresas as unknown[]).map(company),
    paginacion: {
      page: Number(pagination.page),
      limit: Number(pagination.limit),
      total: Number(pagination.total),
      totalPages: Number(pagination.totalPages),
    },
  }
}

export function decodeAdminCreditCompany(raw: unknown): AdminCreditCompany {
  return company(object(object(raw).data).empresa)
}

function event(raw: unknown): AdminCreditEvent {
  const value = object(raw)
  if (!text(value.id) || !id(value.clienteId) || !nullableId(value.solicitudId) ||
    !nullableId(value.cuentaId) || !eventValues.has(value.tipo as CreditEventType) ||
    !id(value.actorUsuarioId) || (value.rolActor !== 'ADMIN' && value.rolActor !== 'CLIENTE') ||
    !(value.estadoAnterior === null || typeof value.estadoAnterior === 'string') ||
    !text(value.estadoNuevo) || !nullableDecimal(value.limiteAnterior) ||
    !nullableDecimal(value.limiteNuevo) || value.moneda !== 'USD' ||
    !(value.motivo === null || typeof value.motivo === 'string') ||
    !(value.evidencia === null || typeof value.evidencia === 'string') ||
    !(value.revisionCuenta === null || typeof value.revisionCuenta === 'string') ||
    !utc(value.fechaEvento)) invalid()
  return value as unknown as AdminCreditEvent
}

export function decodeAdminCreditEventPage(raw: unknown): AdminCreditEventPage {
  const value = object(object(raw).data)
  const items = value.items
  const next = value.siguienteAntesDeId
  if (!Array.isArray(items) || !(next === null || id(next))) invalid()
  return {
    items: (items as unknown[]).map(event),
    siguienteAntesDeId: next === null ? null : Number(next),
  }
}
