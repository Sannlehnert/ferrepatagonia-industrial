import type { Coverage } from './adminAccount'

export type CreditCompanyApproval = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA'
export type CreditCompanyRequestState = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA'
export type CreditCompanyAccountState = 'HABILITADA' | 'INHABILITADA'
export type CreditCompanyAccountFilter = CreditCompanyAccountState | 'SIN_CUENTA'
export type CreditCompanyRequestFilter = CreditCompanyRequestState | 'SIN_SOLICITUD'

export interface AdminCreditCompanyAccount {
  cuentaId: number
  estado: CreditCompanyAccountState
  limite: string | null
  moneda: 'USD'
  plazoDias: 30 | 60 | null
  cobertura: Coverage
  origen: 'REAL' | 'DEMO'
}

export interface AdminCreditCompanyRequest {
  id: number
  estado: CreditCompanyRequestState
  montoSolicitado: string
  plazoDias: 30 | 60
  fechaSolicitud: string | null
  fechaResolucion: string | null
  limiteAutorizado: string | null
  plazoAutorizado: 30 | 60 | null
}

export interface AdminCreditCompany {
  clienteId: number
  nombreRazonSocial: string
  cuit: string | null
  email: string
  estadoAprobacionEmpresa: CreditCompanyApproval | null
  activo: boolean
  cuentaCorriente: AdminCreditCompanyAccount | null
  solicitudCredito: AdminCreditCompanyRequest | null
}

export interface AdminCreditCompanyPagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface AdminCreditCompanyPage {
  empresas: AdminCreditCompany[]
  paginacion: AdminCreditCompanyPagination
}

export interface AdminCreditCompanyFilters {
  page?: number
  limit?: number
  busqueda?: string
  estadoEmpresa?: CreditCompanyApproval
  estadoSolicitud?: CreditCompanyRequestFilter
  cuenta?: CreditCompanyAccountFilter
}

export type CreditEventType =
  | 'SOLICITUD_CREADA'
  | 'SOLICITUD_APROBADA'
  | 'SOLICITUD_RECHAZADA'
  | 'CUENTA_HABILITADA'
  | 'CUENTA_DESHABILITADA'
  | 'LIMITE_MODIFICADO'

export interface AdminCreditEvent {
  id: string
  clienteId: number
  solicitudId: number | null
  cuentaId: number | null
  tipo: CreditEventType
  actorUsuarioId: number
  rolActor: 'ADMIN' | 'CLIENTE'
  estadoAnterior: string | null
  estadoNuevo: string
  limiteAnterior: string | null
  limiteNuevo: string | null
  moneda: 'USD'
  motivo: string | null
  evidencia: string | null
  revisionCuenta: string | null
  fechaEvento: string
}

export interface AdminCreditEventPage {
  items: AdminCreditEvent[]
  siguienteAntesDeId: number | null
}
