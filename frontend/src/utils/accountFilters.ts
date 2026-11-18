export type OrderFilter = 'sin-comprobante' | 'cuenta-corriente'

const ORDER_FILTERS: readonly string[] = ['sin-comprobante', 'cuenta-corriente']

// Valores vacíos, repetidos o desconocidos equivalen al historial general (null).
export function normalizeOrderFilter(value: unknown): OrderFilter | null {
  return typeof value === 'string' && ORDER_FILTERS.includes(value) ? (value as OrderFilter) : null
}
