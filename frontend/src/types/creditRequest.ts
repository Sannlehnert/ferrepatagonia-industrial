export type CreditRequestStatus = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA'

export interface CreditRequest {
    id: number
    estado: CreditRequestStatus
    montoSolicitado: string
    plazoDias: 30 | 60
    moneda: 'USD'
    observaciones: string | null
    fechaSolicitud: string
    fechaResolucion: string | null
    limiteAutorizado: string | null
    plazoAutorizado: 30 | 60 | null
}

export interface CreateCreditRequestPayload {
    montoSolicitado: string
    plazoDias: 30 | 60
    observaciones?: string
}

export interface CreditRequestSnapshot {
    requests: CreditRequest[]
    loading: boolean
    pending: boolean
    canRequest: boolean
}
