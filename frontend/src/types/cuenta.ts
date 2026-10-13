export interface Cliente {
  nombre: string
  email: string
  telefono: string
  direccion: string
}
export type EstadoPedido = 'pendiente' | 'en_camino' | 'entregado' | 'cancelado'

export interface Pedido {
  id: number
  fecha: string // formato 'YYYY-MM-DD'
  estado: EstadoPedido
  total: number
}
export type FiltroEstado = EstadoPedido | ''