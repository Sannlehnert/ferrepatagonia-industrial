export type CatalogPagination = { page: number; limit: number; offset: number };

// Límites operativos del endpoint, no reglas comerciales.
export function parseCatalogPagination(query: Record<string, unknown>): CatalogPagination | null {
  if (Object.keys(query).some(key => key !== 'page' && key !== 'limit')) return null;
  const parse = (value: unknown, fallback: number, max: number): number | null => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number <= max ? number : null;
  };
  const page = parse(query.page, 1, 1_000_000);
  const limit = parse(query.limit, 20, 100);
  if (page === null || limit === null) return null;
  return { page, limit, offset: (page - 1) * limit };
}
