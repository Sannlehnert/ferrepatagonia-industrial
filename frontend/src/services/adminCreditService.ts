import api from './api'

export type CreditRequestStatus = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA'
export type CreditTerm = 30 | 60

export interface AdminCreditRequest {
  id: number
  clienteId: number
  clienteNombre: string | null
  estado: CreditRequestStatus
  montoSolicitado: string
  plazoDias: CreditTerm
  moneda: 'USD'
  observaciones: string | null
  fechaSolicitud: string
  fechaResolucion: string | null
  limiteAutorizado: string | null
  plazoAutorizado: CreditTerm | null
  motivoResolucion: string | null
  evidenciaResolucion: string | null
  cuentaCorrienteId: number | null
}

interface CreditRequestFilters {
  estado?: CreditRequestStatus
  clienteId?: number
  limite?: number
  antesDeId?: number
}

interface CreditRequestPage {
  items: AdminCreditRequest[]
  siguienteAntesDeId: number | null
}

interface ApiResponse<T> {
  data: T
}

interface CreditDecision {
  motivo: string
  evidencia?: string | null
}

interface CreditApproval {
  limiteAutorizado: string
  plazoDias: CreditTerm
  evidencia: string
  motivo: string
}

interface CreditEnablement {
  evidencia: string
  motivo?: string | null
}

interface CreditLimitChange {
  limite: string
  evidencia: string
  motivo: string
}

const requestsPath = '/admin/solicitudes-credito'
const accountPath = (clienteId: number) => `/admin/clientes/${clienteId}/cuenta-corriente`
const writeConfig = (idempotencyKey: string) => ({
  headers: { 'Idempotency-Key': idempotencyKey },
})

export async function listAdminCreditRequests(
  params: CreditRequestFilters = {},
  signal?: AbortSignal,
) {
  const response = await api.get<ApiResponse<CreditRequestPage>>(requestsPath, { params, signal })
  return response.data.data
}

export async function getAdminCreditRequest(id: number, signal?: AbortSignal) {
  const response = await api.get<ApiResponse<{ solicitud: AdminCreditRequest }>>(
    `${requestsPath}/${id}`,
    { signal },
  )
  return response.data.data.solicitud
}

export async function approveAdminCreditRequest(
  id: number,
  body: CreditApproval,
  idempotencyKey: string,
) {
  await api.post(`${requestsPath}/${id}/aprobar`, body, writeConfig(idempotencyKey))
}

export async function rejectAdminCreditRequest(
  id: number,
  body: CreditDecision,
  idempotencyKey: string,
) {
  await api.post(`${requestsPath}/${id}/rechazar`, body, writeConfig(idempotencyKey))
}

export async function enableAdminCreditAccount(
  clienteId: number,
  body: CreditEnablement,
  idempotencyKey: string,
) {
  await api.post(`${accountPath(clienteId)}/habilitar`, body, writeConfig(idempotencyKey))
}

export async function disableAdminCreditAccount(
  clienteId: number,
  body: CreditDecision,
  idempotencyKey: string,
) {
  await api.post(`${accountPath(clienteId)}/deshabilitar`, body, writeConfig(idempotencyKey))
}

export async function changeAdminCreditLimit(
  clienteId: number,
  body: CreditLimitChange,
  idempotencyKey: string,
) {
  await api.put(`${accountPath(clienteId)}/limite`, body, writeConfig(idempotencyKey))
}