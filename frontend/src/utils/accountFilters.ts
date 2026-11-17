export type OrderFilter = 'sin-comprobante' | 'cuenta-corriente'

const ORDER_FILTERS: readonly string[] = ['sin-comprobante', 'cuenta-corriente']

// Valores vacíos, repetidos o desconocidos equivalen al historial general (null).
export function normalizeOrderFilter(value: unknown): OrderFilter | null {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' && ORDER_FILTERS.includes(raw) ? (raw as OrderFilter) : null
}
