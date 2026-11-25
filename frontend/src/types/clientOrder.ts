import type { OrderDocumentState, OrderFinancialState } from './orderStates'

export interface ClientOrderSummary {
  simulado?: true
  pedidoId: number
  numero: string
  fecha: string
  estado: string
  estadoPedido?: string
  estadoDocumental?: OrderDocumentState
  estadoFinanciero?: OrderFinancialState
  montoAcreditadoUSD?: string | null
  modalidadPago: string
  moneda: string | null
  subtotal: string
  descuento: string
  total: string
  totalUSD: string | null
  observaciones?: string | null
  cantidadLineas: number
  cantidadUnidades: number
  cargoId?: string | null
  venceEl?: string | null
}

export interface ClientOrderLine {
  detalleId: number
  productoId: number
  codigo: string
  nombre: string
  cantidad: number
  precioUnitario: string
  descuento: string
  subtotal: string
}

export interface ClientOrderDetail extends ClientOrderSummary {
  items: ClientOrderLine[]
}
