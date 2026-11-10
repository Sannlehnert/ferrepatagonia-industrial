export interface ClientOrderSummary {
  pedidoId: number
  numero: string
  fecha: string
  estado: string
  modalidadPago: string
  moneda: string | null
  subtotal: string
  descuento: string
  total: string
  totalUSD: string | null
  cantidadLineas: number
  cantidadUnidades: number
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