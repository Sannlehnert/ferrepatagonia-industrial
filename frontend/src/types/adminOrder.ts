export type AdminOrderOperationalStatus =
  | 'CONFIRMADO'
  | 'EN_PREPARACION'
  | 'ENVIADO'
  | 'ENTREGADO'

export type AdminOrderFilterStatus =
  | AdminOrderOperationalStatus
  | 'DEMO_REGISTRADO'

export interface AdminOrderClientSummary {
  idCliente: number
  tipoCliente: 'PARTICULAR' | 'EMPRESA'
  nombreRazonSocial: string
  documento: string | null
  cuit: string | null
  email: string | null
  estadoAprobacionEmpresa: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | null
  esFiel: boolean
  activo: boolean
}

export interface AdminOrderClientDetail extends AdminOrderClientSummary {
  telefono: string | null
  direccion: string | null
}

export interface AdminOrderListItem {
  idPedido: number
  fecha: string
  estado: string
  estadosPermitidos: AdminOrderOperationalStatus[]
  modalidadPago: string
  moneda: string | null
  subtotal: string
  descuento: string
  total: string
  evidenciaTotalUSD: string | null
  observaciones: string | null
  cantidadItems: number
  totalUnidades: number
  cargoCuentaCorrienteId: number | null
  origen: 'REAL' | 'DEMO'
  cliente: AdminOrderClientSummary
}

export interface AdminOrderLineItem {
  idDetallePedido: number
  idProducto: number
  codigoProducto: string
  nombreProducto: string
  cantidad: number
  precioUnitario: string
  descuento: string
  subtotal: string
  reglaPrecio: string | null
}

export interface AdminOrderDetail {
  idPedido: number
  fecha: string
  estado: AdminOrderOperationalStatus
  modalidadPago: string
  moneda: string | null
  subtotal: string
  descuento: string
  total: string
  observaciones: string | null
  cargoCuentaCorrienteId: number | null
  estadosPermitidos: AdminOrderOperationalStatus[]
  cliente: {
    idCliente: number
    nombreRazonSocial: string
    tipoCliente: 'CONSUMIDOR_FINAL' | 'EMPRESA'
    estadoAprobacionEmpresa?: string | null
    cuit?: string | null
    documento?: string | null
    email?: string | null
    telefono?: string | null
    direccion?: string | null
  }
  items: Array<{
    idDetallePedido: number
    codigoProducto: string
    nombreProducto: string
    cantidad: number
    precioUnitario: string
    descuento: string
    subtotal: string
    reglaPrecio?: string | null
  }>
}

export interface AdminOrderPagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface AdminOrderListResponse {
  items: AdminOrderListItem[]
  pagination: AdminOrderPagination
}

export interface AdminOrderQueryFilters {
  page?: number
  limit?: number
  estado?: AdminOrderFilterStatus
  modalidadPago?: string
  clienteId?: number
  fecha?: string // YYYY-MM-DD
  q?: string
}