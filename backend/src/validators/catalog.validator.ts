export type CatalogPagination = { page: number; limit: number; offset: number; categoria?: number; busqueda?: string };
import { catalogPolicy } from '../dtos/policies';
import { validateDtoSync } from '../dtos/validation';
import { catalogInput } from '../dtos/catalog/catalog-query.dto';

export function parseCatalogPagination(query: Record<string, unknown>): CatalogPagination | null {
  const result = validateDtoSync(catalogPolicy, query);
  return result.valid ? catalogInput(result.data) : null;
}
