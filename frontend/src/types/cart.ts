import type { PriceLine } from './pricing'

type CartPrice = Pick<PriceLine, 'estadoPrecio' | 'precioComprable' | 'precioUnitarioUSD' |
  'subtotalUSD' | 'descuentoAplicado' | 'origenDescuento'> & { datosSinteticos: boolean }

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
  precio: CartPrice | null
  error_precio: string | null
}

export interface CartSnapshot {
  id_carrito: number
  items: CartItem[]
  total_items: number
  tiene_incompatibles: boolean
  moneda: 'USD'
  regla: 'FER17-v1'
  ivaIncluido: true
  totalUSD: string | null
  estado_total: 'DEFINIDO' | 'ITEMS_INCOMPATIBLES' | 'IMPORTE_FUERA_DE_RANGO'
}

// POST y PATCH reciben la cantidad final de la línea.
export type CartMutation =
  | { type: 'add' | 'update'; productoId: number; cantidad: number }
  | { type: 'remove'; productoId: number }

export interface CartTransport {
  get(signal: AbortSignal): Promise<CartSnapshot>
  mutate(command: CartMutation, signal: AbortSignal): Promise<void>
}
