import { IsInt, Max, Min, ValidateIf } from 'class-validator';
import { parseInteger, Rule } from '../rules';
import type { DtoPolicy } from '../validation';

const error = 'Query inválida. page debe estar entre 1 y 1000000, limit entre 1 y 100 y busqueda debe ser texto no vacío de hasta 200 caracteres sin controles. No se admiten parámetros desconocidos ni repetidos.';

export class AdminProductQuery {
    @ValidateIf((_dto, value) => value !== undefined)
    @IsInt() @Min(1) @Max(1000000)
    page?: number;

    @ValidateIf((_dto, value) => value !== undefined)
    @IsInt() @Min(1) @Max(100)
    limit?: number;

    @ValidateIf((_dto, value) => value !== undefined)
    @Rule(value => typeof value === 'string' && !!value.trim() && [...value].length <= 200
        && !/[\u0000-\u001f\u007f]/u.test(value) ? null : error)
    busqueda?: string;
}

export const adminProductQueryPolicy: DtoPolicy<AdminProductQuery> = {
    type: AdminProductQuery,
    fields: ['page', 'limit', 'busqueda'],
    objectError: error,
    unknownError: error,
    error,
    prepare: input => ({
        ...input,
        ...(input.page === undefined ? {} : { page: parseInteger(input.page, 1000000) }),
        ...(input.limit === undefined ? {} : { limit: parseInteger(input.limit, 100) }),
    }),
};
