export interface TransferOrderEligibility {
  simulado?: true
  elegible: boolean
  modalidadPago: 'TRANSFERENCIA'
  moneda: 'USD'
  totalUSD: string | null
  codigo: string | null
  mensaje: string | null
  cotizacion: string | null
}

export interface ConfirmedTransferOrder {
  simulado?: true
  pedidoId: number
  estado: 'CONFIRMADO'
  modalidadPago: 'TRANSFERENCIA'
  moneda: 'USD'
  totalUSD: string
}

export interface PendingTransferOrder {
  estado: 'PENDIENTE'
  code: 'CONFIRMACION_PENDIENTE'
  message: string
}

export type TransferOrderAttempt =
  | { estado: 'CONFIRMADO'; result: ConfirmedTransferOrder }
  | { estado: 'PENDIENTE'; result: PendingTransferOrder }

export interface TransferOrderTransport {
  getEligibility(signal: AbortSignal): Promise<TransferOrderEligibility>
  confirm(key: string, quoteToken: string, signal: AbortSignal): Promise<TransferOrderAttempt>
  recover(key: string, signal: AbortSignal): Promise<TransferOrderAttempt>
}

export interface PendingTransferOrderStorage {
  get(userId: number): string | null
  set(userId: number, key: string, quoteToken: string): void
  remove(userId: number): void
}
