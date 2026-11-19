import type { LocationQueryRaw } from 'vue-router'

export const CATALOG_ORDER_OPTIONS = [
  { value: 'predeterminado', label: 'Predeterminado' },
  { value: 'nombre_asc', label: 'Nombre: A a Z' },
  { value: 'nombre_desc', label: 'Nombre: Z a A' },
  { value: 'precio_asc', label: 'Precio: menor a mayor' },
  { value: 'precio_desc', label: 'Precio: mayor a menor' },
] as const

export type CatalogOrder = (typeof CATALOG_ORDER_OPTIONS)[number]['value']

const DEFAULT_ORDER: CatalogOrder = 'predeterminado'

function parseOrder(value: unknown): CatalogOrder {
  return CATALOG_ORDER_OPTIONS.some(option => option.value === value)
    ? value as CatalogOrder
    : DEFAULT_ORDER
}

// El orden predeterminado no se escribe en la URL; cualquier valor inválido se descarta.
export function normalizarQueryOrden(query: LocationQueryRaw): {
  orden: CatalogOrder
  query: LocationQueryRaw
  esCanonica: boolean
} {
  const orden = parseOrder(query.orden)
  const queryCanonica: LocationQueryRaw = { ...query }

  if (orden === DEFAULT_ORDER) delete queryCanonica.orden
  else queryCanonica.orden = orden

  return { orden, query: queryCanonica, esCanonica: query.orden === queryCanonica.orden }
}
