import type { LocationQuery, LocationQueryRaw } from 'vue-router'

export const MAX_PAGINA_CATALOGO = 1_000_000

function parsearPagina(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value

  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return 1

  const page = Number(raw)
  if (!Number.isSafeInteger(page) || page < 1) return 1

  return Math.min(page, MAX_PAGINA_CATALOGO)
}

export function normalizarQueryPagina(query: LocationQuery): {
  pagina: number
  query: LocationQueryRaw
  esCanonica: boolean
} {
  const pagina = parsearPagina(query.page)
  const paginaCanonica = pagina > 1 ? String(pagina) : undefined
  const esCanonica =
    paginaCanonica === undefined
      ? query.page === undefined
      : typeof query.page === 'string' && query.page === paginaCanonica
  const queryCanonica: LocationQueryRaw = { ...query }

  if (paginaCanonica === undefined) {
    delete queryCanonica.page
  } else {
    queryCanonica.page = paginaCanonica
  }

  return { pagina, query: queryCanonica, esCanonica }
}
