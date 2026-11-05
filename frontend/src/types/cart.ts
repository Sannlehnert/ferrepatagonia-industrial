export interface CartItem {
  id_item_carrito: number
  id_producto: number
  codigo: string
  nombre: string
  imagen: string | null
  cantidad: number
  stock: number
  disponible: boolean
  motivo_no_disponible?: 'INACTIVO' | 'SIN_STOCK'
}

export interface CartSnapshot {
  id_carrito: number
  items: CartItem[]
  total_items: number
  tiene_incompatibles: boolean
}

// Comandos internos. El contrato HTTP de escritura depende de #246.
export type CartMutation =
  | { type: 'add' | 'update'; productoId: number; cantidad: number }
  | { type: 'remove'; productoId: number }

export interface CartTransport {
  get(signal: AbortSignal): Promise<CartSnapshot>
  mutate?(command: CartMutation, signal: AbortSignal): Promise<void>
}
