import { IsInt, Max, Min, ValidateIf } from 'class-validator';
import { parseInteger, Rule } from '../rules';
import type { DtoPolicy } from '../validation';
import type { EstadoAprobacionEmpresa } from './company-approval.dto';

export type TipoCliente = 'PARTICULAR' | 'EMPRESA';

const TIPOS = new Set<TipoCliente>(['PARTICULAR', 'EMPRESA']);
const ESTADOS = new Set<EstadoAprobacionEmpresa>(['PENDIENTE', 'APROBADA', 'RECHAZADA']);

const error = 'Query inválida. page debe estar entre 1 y 1000000, limit entre 1 y 100, busqueda debe ser texto no vacío de hasta 200 caracteres sin controles, tipo debe ser PARTICULAR o EMPRESA y estadoEmpresa PENDIENTE, APROBADA o RECHAZADA. No se admiten parámetros desconocidos ni repetidos.';

const optionalString = (value: unknown) => value === undefined || typeof value === 'string';

export class AdminClientQuery {
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

    @ValidateIf((_dto, value) => value !== undefined)
    @Rule(value => optionalString(value) && (value === undefined || TIPOS.has(value as TipoCliente)) ? null : error)
    tipo?: TipoCliente;

    @ValidateIf((_dto, value) => value !== undefined)
    @Rule(value => optionalString(value) && (value === undefined || ESTADOS.has(value as EstadoAprobacionEmpresa)) ? null : error)
    estadoEmpresa?: EstadoAprobacionEmpresa;
}

export const adminClientQueryPolicy: DtoPolicy<AdminClientQuery> = {
    type: AdminClientQuery,
    fields: ['page', 'limit', 'busqueda', 'tipo', 'estadoEmpresa'],
    objectError: error,
    unknownError: error,
    error,
    prepare: input => ({
        ...input,
        ...(input.page === undefined ? {} : { page: parseInteger(input.page, 1000000) }),
        ...(input.limit === undefined ? {} : { limit: parseInteger(input.limit, 100) }),
        ...(typeof input.busqueda === 'string' ? { busqueda: input.busqueda.trim() } : {}),
        ...(typeof input.tipo === 'string' ? { tipo: input.tipo.trim().toUpperCase() } : {}),
        ...(typeof input.estadoEmpresa === 'string'
            ? { estadoEmpresa: input.estadoEmpresa.trim().toUpperCase() }
            : {}),
    }),
    check: input => {
        const tipo = typeof input.tipo === 'string' ? input.tipo.trim().toUpperCase() : input.tipo;
        const estado = typeof input.estadoEmpresa === 'string'
            ? input.estadoEmpresa.trim().toUpperCase()
            : input.estadoEmpresa;
        if (tipo === 'PARTICULAR' && estado !== undefined) {
            return 'El estado de empresa no aplica a clientes particulares.';
        }
        return null;
    },
};
