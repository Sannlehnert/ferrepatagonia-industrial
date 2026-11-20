export interface AdminDashboardOrdersByStatus {
  CONFIRMADO: number
  EN_PREPARACION: number
  ENVIADO: number
  ENTREGADO: number
  totalOperativos: number
}

export interface AdminDashboardMetrics {
  corte: string
  origenDatos: 'REAL'
  umbralStockBajo: number
  pedidosPorEstado: AdminDashboardOrdersByStatus
  indicadores: {
    pedidosNuevos: number
    pedidosEnCurso: number
    pedidosCuentaCorriente: number
    comprobantesTotales: number
    comprobantesSinRevisar: number
    alertasStockBajo: number
    productosSinStock: number
    empresasFieles: number
  }
}