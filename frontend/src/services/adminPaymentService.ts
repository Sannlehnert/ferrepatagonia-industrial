import api from './api'

export type PaymentCurrency = 'USD' | 'ARS'
export type DocumentState = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO'
export type FinancialState = 'PENDIENTE' | 'ACREDITADO' | 'RECHAZADO' | 'ANULADO'
export type ReviewDecision = 'APROBADO' | 'RECHAZADO'
export type ReceiptMime = 'application/pdf' | 'image/jpeg' | 'image/png'

export interface AdminPayment {
  id: number
  clienteId: number
  cliente: string
  cuentaCorrienteId: number | null
  declaranteUsuarioId: number | null
  revisadoPorUsuarioId: number | null
  acreditadoPorUsuarioId: number | null
  claveIdempotencia: string | null
  claveAcreditacion: string | null
  comprobanteId: string | null
  comprobanteTipoMime: ReceiptMime | null
  comprobanteBytes: number | null
  comprobanteRevisadoEn: string | null
  pedidoId: number | null
  monto: string
  montoUsd: string | null
  moneda: PaymentCurrency | null
  observaciones: string | null
  estado: FinancialState | string
  estadoDocumental: DocumentState
  motivoRevision: string | null
  evidenciaAcreditacion: string | null
  fecha: string
  revisadoEn: string | null
  acreditadoEn: string | null
  movimientoId: number | null
  movimientoEstado: string | null
  movimientoMonto: string | null
}

export interface AdminPaymentPage {
  items: AdminPayment[]
  paginaSiguiente: number | null
}

export const DOCUMENT_LABELS: Record<DocumentState, string> = {
  PENDIENTE: 'Pendiente de revisión',
  APROBADO: 'Documento aprobado',
  RECHAZADO: 'Documento rechazado',
}

export const FINANCIAL_LABELS: Record<FinancialState, string> = {
  PENDIENTE: 'Pendiente de acreditación',
  ACREDITADO: 'Acreditado',
  RECHAZADO: 'Pago rechazado',
  ANULADO: 'Anulado',
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MONEY = /^(?:0|[1-9]\d{0,9})\.\d{2}$/
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/

const invalid = (): never => {
  throw new Error('La respuesta de pagos administrativos no es válida.')
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : invalid()

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const id = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 2147483647
const optionalId = (value: unknown): value is number | null => value === null || id(value)
const optionalText = (value: unknown): value is string | null => value === null || typeof value === 'string'
const money = (value: unknown): value is string => typeof value === 'string' && MONEY.test(value)
const optionalMoney = (value: unknown): value is string | null => value === null || money(value)
const instant = (value: unknown): value is string => typeof value === 'string' && UTC.test(value) && Number.isFinite(Date.parse(value))
const optionalInstant = (value: unknown): value is string | null => value === null || instant(value)
const documentState = (value: unknown): value is DocumentState =>
  value === 'PENDIENTE' || value === 'APROBADO' || value === 'RECHAZADO'
const mime = (value: unknown): value is ReceiptMime | null =>
  value === null || value === 'application/pdf' || value === 'image/jpeg' || value === 'image/png'

function decodePayment(raw: unknown): AdminPayment {
  const value = object(raw)

  if (!id(value.id) || !id(value.clienteId) || !optionalId(value.cuentaCorrienteId)
    || !text(value.cliente) || !money(value.monto) || !optionalMoney(value.montoUsd)
    || !(value.moneda === 'USD' || value.moneda === 'ARS' || value.moneda === null)
    || !documentState(value.estadoDocumental) || typeof value.estado !== 'string'
    || !instant(value.fecha) || !optionalInstant(value.revisadoEn) || !optionalInstant(value.acreditadoEn)
    || !optionalId(value.declaranteUsuarioId) || !optionalId(value.revisadoPorUsuarioId)
    || !optionalId(value.acreditadoPorUsuarioId) || !optionalId(value.pedidoId)
    || (value.cuentaCorrienteId === null && value.pedidoId === null)
    || !optionalText(value.claveIdempotencia) || !optionalText(value.claveAcreditacion)
    || !optionalText(value.comprobanteId) || !mime(value.comprobanteTipoMime)
    || !(value.comprobanteBytes === null || (Number.isSafeInteger(value.comprobanteBytes) && Number(value.comprobanteBytes) > 0))
    || !optionalInstant(value.comprobanteRevisadoEn) || !optionalText(value.observaciones)
    || !optionalText(value.motivoRevision) || !optionalText(value.evidenciaAcreditacion)
    || !optionalId(value.movimientoId) || !optionalText(value.movimientoEstado)
    || !optionalMoney(value.movimientoMonto)) invalid()

  return value as unknown as AdminPayment
}

export function decodeAdminPaymentPage(raw: unknown): AdminPaymentPage {
  const value = object(raw)
  const items = value.items
  if (!Array.isArray(items) || items.length > 50
    || !(value.paginaSiguiente === null || id(value.paginaSiguiente))) invalid()

  return {
    items: (items as unknown[]).map(decodePayment),
    paginaSiguiente: value.paginaSiguiente as number | null,
  }
}

export function decodeAdminPayment(raw: unknown): AdminPayment {
  return decodePayment(raw)
}

export function documentLabel(value: string): string {
  return DOCUMENT_LABELS[value as DocumentState] ?? 'Estado documental desconocido'
}

export function financialLabel(value: string): string {
  return FINANCIAL_LABELS[value as FinancialState] ?? 'Estado financiero desconocido'
}

// La elegibilidad visual replica las compuertas del backend. La autorización
// real y la transacción siguen siendo responsabilidad exclusiva del servidor.
export function canReview(payment: AdminPayment): boolean {
  return payment.cuentaCorrienteId !== null
    && payment.pedidoId === null
    && payment.estado === 'PENDIENTE'
    && payment.estadoDocumental === 'PENDIENTE'
    && Boolean(payment.comprobanteId)
}

export function canAccredit(payment: AdminPayment): boolean {
  return payment.estado === 'PENDIENTE'
    && payment.estadoDocumental === 'APROBADO'
    && Boolean(payment.comprobanteId)
    && (payment.moneda === 'USD' || payment.moneda === 'ARS')
    && MONEY.test(payment.monto)
    && payment.monto !== '0.00'
}

export function formatPaymentMoney(value: string, currency: PaymentCurrency | null): string {
  if (!MONEY.test(value)) return 'Importe no disponible'
  const [whole = '0', cents = '00'] = value.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${currency ?? 'Importe'} ${grouped},${cents}`
}

export function isUuidV4(value: string): boolean {
  return UUID_V4.test(value)
}

export function createAccreditationKey(): string {
  return crypto.randomUUID()
}

export function mapPaymentError(code: string | undefined, status: number | undefined): string {
  if (code === 'PAGO_PENDIENTE_REVISION') {
    return 'La revisión documental todavía no está aprobada. No se acreditó dinero.'
  }
  if (code === 'PAGO_DOCUMENTALMENTE_RECHAZADO') {
    return 'El pago o su comprobante fue rechazado documentalmente y no puede acreditarse.'
  }
  if (code === 'PAGO_YA_ACREDITADO') return 'El pago ya estaba acreditado. No se generó otro movimiento.'
  if (code === 'PAGO_YA_REVISADO') return 'La revisión documental ya fue resuelta. Consultá el estado actualizado.'
  if (code === 'PAGO_NO_ENCONTRADO') return 'No se encontró el pago indicado. Recargá el listado.'
  if (code === 'COTIZACION_AUSENTE') {
    return 'No existe una cotización FER17-v1 verificada para la fecha de acreditación. No se acreditó dinero.'
  }
  if (code === 'COTIZACION_INVALIDA') {
    return 'La cotización FER17-v1 no es válida o no está verificada. No se acreditó dinero.'
  }
  if (code === 'COTIZACION_FER17_NO_VERIFICADA') {
    return 'No existe una cotización BNA vendedor verificada por FER17-v1 para acreditar el pago en ARS.'
  }
  if (code === 'CUENTA_NO_ACREDITADA') {
    return 'La cuenta corriente no tiene cobertura histórica completa. No se acreditó dinero.'
  }
  if (code === 'CUENTA_RESTRINGIDA') {
    return 'La cuenta tiene un libro restringido o sintético y no admite acreditaciones.'
  }
  if (code === 'COMPROBANTE_NO_ENCONTRADO') return 'No se encontró el comprobante asociado. No se acreditó dinero.'
  if (code === 'TRANSICION_PAGO_INVALIDA') return 'El pago no se encuentra en un estado acreditable.'
  if (code === 'CONFLICTO_CONCURRENCIA') {
    return 'La operación encontró un cambio concurrente. Consultá el estado antes de reintentar.'
  }
  if (code === 'CLAVE_IDEMPOTENCIA_REQUERIDA') return 'Falta la clave de idempotencia. No se envió la acreditación.'
  if (code === 'CLAVE_IDEMPOTENCIA_REUTILIZADA') {
    return 'La clave de idempotencia ya fue usada con otros datos. Consultá el estado del pago.'
  }
  if (status === 401) return 'La sesión expiró. Iniciá sesión nuevamente.'
  if (status === 403) return 'La sesión actual no tiene permisos de administración.'
  if (status === 404) return 'No se encontró el pago indicado.'
  return 'No se pudo completar la operación. No se confirmó ningún cambio.'
}

export async function listAdminPayments(pagina: number, signal: AbortSignal): Promise<AdminPaymentPage> {
  const response = await api.get<{ data: unknown }>('/admin/pagos', {
    params: { pagina },
    signal,
  })
  return decodeAdminPaymentPage(response.data.data)
}

export async function getAdminPayment(paymentId: number, signal: AbortSignal): Promise<AdminPayment> {
  const response = await api.get<{ data: unknown }>(`/admin/pagos/${paymentId}`, { signal })
  return decodeAdminPayment(response.data.data)
}

export async function reviewAdminPayment(
  paymentId: number,
  decision: ReviewDecision,
  motivo: string | undefined,
  signal: AbortSignal,
): Promise<AdminPayment> {
  const response = await api.patch<{ data: unknown }>(
    `/admin/pagos/${paymentId}/revision`,
    { decision, ...(decision === 'RECHAZADO' ? { motivo } : {}) },
    { signal },
  )
  return decodeAdminPayment(response.data.data)
}

export async function accreditAdminPayment(
  paymentId: number,
  evidencia: string,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<AdminPayment> {
  if (!isUuidV4(idempotencyKey)) throw new Error('La clave de idempotencia no es un UUID v4.')
  const response = await api.post<{ data: unknown }>(
    `/admin/pagos/${paymentId}/acreditar`,
    { evidencia },
    { signal, headers: { 'Idempotency-Key': idempotencyKey } },
  )
  return decodeAdminPayment(response.data.data)
}
