export type PaymentCurrency = 'USD' | 'ARS'
export type PaymentDocumentState = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO'
export type PaymentFinancialState = 'PENDIENTE' | 'ACREDITADO' | 'RECHAZADO' | 'ANULADO'

export interface ClientPayment {
    id: number
    cuentaCorrienteId: number
    comprobanteId: string | null
    comprobanteTipoMime: string | null
    comprobanteBytes: number | null
    comprobanteRevisadoEn: string | null
    pedidoId: number | null
    monto: string
    montoUsd: string | null
    moneda: PaymentCurrency | null
    observaciones: string | null
    estado: PaymentFinancialState | string
    estadoDocumental: PaymentDocumentState
    motivoRevision: string | null
    evidenciaAcreditacion: string | null
    fecha: string
    revisadoEn: string | null
    acreditadoEn: string | null
    movimientoId: number | null
    movimientoEstado: string | null
    movimientoMonto: string | null
}

export interface ClientPaymentPage {
    items: ClientPayment[]
    paginaSiguiente: number | null
}

export interface DeclarePaymentPayload {
    monto: string
    moneda: PaymentCurrency
    comprobanteId: string
    observaciones?: string
}

export interface DeclarePaymentResult {
    payment: ClientPayment
    replay: boolean
}
