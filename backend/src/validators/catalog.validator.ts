export type CatalogPagination = { page: number; limit: number; offset: number; categoria?: number; busqueda?: string };

// Límites operativos del endpoint, no reglas comerciales.
export function parseCatalogPagination(query: Record<string, unknown>): CatalogPagination | null {
  if (Object.keys(query).some(key => !['page', 'limit', 'categoria', 'busqueda'].includes(key))) return null;
  let busqueda: string | undefined;
  if (query.busqueda !== undefined) {
    // #194 incorporará la combinación; no ignorar silenciosamente ningún filtro.
    if (query.categoria !== undefined || typeof query.busqueda !== 'string') return null;
    if ([...query.busqueda].length > 200 || /[\u0000-\u001f\u007f]/u.test(query.busqueda)) return null;
    busqueda = query.busqueda.trim();
    if (!busqueda) return null;
  }
  const parse = (value: unknown, fallback: number, max: number): number | null => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number <= max ? number : null;
  };
  const page = parse(query.page, 1, 1_000_000);
  const limit = parse(query.limit, 20, 100);
  if (page === null || limit === null) return null;
  // CATEGORIA.id_categoria es INT con signo en MariaDB.
  const categoria = parse(query.categoria, 1, 2_147_483_647);
  if (categoria === null) return null;
  return { page, limit, offset: (page - 1) * limit,
    ...(query.categoria === undefined ? {} : { categoria }),
    ...(busqueda === undefined ? {} : { busqueda }) };
}
