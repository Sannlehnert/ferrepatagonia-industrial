export interface AccountOrderEligibility {
  elegible: boolean
  moneda: 'USD'
  totalUSD: string | null
  creditoDisponibleUSD: string | null
  codigo: string | null
  mensaje: string | null
  cotizacion: string | null
}

export interface ConfirmedAccountOrder {
  pedidoId: number
  estado: 'CONFIRMADO'
  modalidadPago: 'CUENTA_CORRIENTE'
  moneda: 'USD'
  totalUSD: string
  cargoId: string
  venceEl: string
}

export interface PendingAccountOrder {
  estado: 'PENDIENTE'
  code: 'CONFIRMACION_PENDIENTE'
  message: string
}

export type AccountOrderAttempt =
  | { estado: 'CONFIRMADO'; result: ConfirmedAccountOrder }
  | { estado: 'PENDIENTE'; result: PendingAccountOrder }

export interface AccountOrderTransport {
  getEligibility(signal: AbortSignal): Promise<AccountOrderEligibility>
  confirm(key: string, quoteToken: string, signal: AbortSignal): Promise<AccountOrderAttempt>
  recover(key: string, signal: AbortSignal): Promise<AccountOrderAttempt>
}

export interface PendingAccountOrderStorage {
  get(userId: number): string | null
  set(userId: number, key: string, quoteToken: string): void
  remove(userId: number): void
}
