import { IsInt, Min, Max, ValidateIf } from 'class-validator';
import { Rule, parseInteger } from '../rules';
import type { CatalogPagination } from '../../validators/catalog.validator';

export const catalogError = 'Query inválida. page (1 a 1000000), limit (1 a 100) y categoria (1 a 2147483647) deben ser enteros positivos sin ceros iniciales. busqueda debe ser texto no vacío de hasta 200 caracteres, sin controles. No se admiten parámetros desconocidos ni repetidos.';

export class CatalogQuery {
  @IsInt() @Min(1) @Max(1000000) page!: number;
  @IsInt() @Min(1) @Max(100) limit!: number;
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt() @Min(1) @Max(2147483647) categoria?: number;
  @ValidateIf((_o, v) => v !== undefined)
  @Rule(v => typeof v === 'string' && [...v].length <= 200 && !!v.trim()
    && !/[\u0000-\u001f\u007f]/u.test(v) ? null : catalogError)
  busqueda?: string;
}

export function prepareCatalog(input: Record<string, unknown>) {
  return { ...input,
    page: input.page === undefined ? 1 : parseInteger(input.page, 1000000),
    limit: input.limit === undefined ? 20 : parseInteger(input.limit, 100),
    ...(input.categoria === undefined ? {} : { categoria: parseInteger(input.categoria, 2147483647) }) };
}

export function catalogInput(dto: CatalogQuery): CatalogPagination {
  return { page: dto.page, limit: dto.limit, offset: (dto.page - 1) * dto.limit,
    ...(dto.categoria === undefined ? {} : { categoria: dto.categoria }),
    ...(dto.busqueda === undefined ? {} : { busqueda: dto.busqueda.trim() }) };
}
