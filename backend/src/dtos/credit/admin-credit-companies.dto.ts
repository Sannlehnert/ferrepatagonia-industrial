import { invalidCreditRequest } from '../../services/credit/credit-workflow.errors';
import type { CreditRequestState } from './credit-workflow.dto';

export type CreditCompanyApproval = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';
export type CreditCompanyRequestFilter = CreditRequestState | 'SIN_SOLICITUD';
export type CreditCompanyAccountFilter = 'HABILITADA' | 'INHABILITADA' | 'SIN_CUENTA';

export interface AdminCreditCompanyQuery {
    page: number;
    limit: number;
    busqueda?: string;
    estadoEmpresa?: CreditCompanyApproval;
    estadoSolicitud?: CreditCompanyRequestFilter;
    cuenta?: CreditCompanyAccountFilter;
}

const APPROVALS = new Set<CreditCompanyApproval>(['PENDIENTE', 'APROBADA', 'RECHAZADA']);
const REQUESTS = new Set<CreditCompanyRequestFilter>([
    'PENDIENTE', 'APROBADA', 'RECHAZADA', 'SIN_SOLICITUD',
]);
const ACCOUNTS = new Set<CreditCompanyAccountFilter>([
    'HABILITADA', 'INHABILITADA', 'SIN_CUENTA',
]);

const INVALID_QUERY = 'La consulta de empresas contiene parámetros inválidos.';
const ALLOWED = ['page', 'limit', 'busqueda', 'estadoEmpresa', 'estadoSolicitud', 'cuenta'];

function paramsOf(url: string): URLSearchParams {
    const separator = url.indexOf('?');
    return new URLSearchParams(separator < 0 ? '' : url.slice(separator + 1));
}

function integer(value: string, min: number, max: number): number {
    if (!/^(?:0|[1-9]\d*)$/.test(value)) throw invalidCreditRequest(INVALID_QUERY);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
        throw invalidCreditRequest(INVALID_QUERY);
    }
    return parsed;
}

function enumValue<T extends string>(value: string, allowed: ReadonlySet<T>): T {
    const normalized = value.trim().toUpperCase() as T;
    if (!allowed.has(normalized)) throw invalidCreditRequest(INVALID_QUERY);
    return normalized;
}

export function parseAdminCreditCompanyQuery(url: string): AdminCreditCompanyQuery {
    const params = paramsOf(url);
    for (const key of params.keys()) {
        if (!ALLOWED.includes(key) || params.getAll(key).length !== 1) {
            throw invalidCreditRequest(INVALID_QUERY);
        }
    }

    const query: AdminCreditCompanyQuery = { page: 1, limit: 20 };

    if (params.has('page')) query.page = integer(params.get('page')!, 1, 1_000_000);
    if (params.has('limit')) query.limit = integer(params.get('limit')!, 1, 100);

    if (params.has('busqueda')) {
        const value = params.get('busqueda')!.trim();
        if (!value || [...value].length > 200 || /[\u0000-\u001f\u007f]/u.test(value)) {
            throw invalidCreditRequest(INVALID_QUERY);
        }
        query.busqueda = value;
    }

    if (params.has('estadoEmpresa')) {
        query.estadoEmpresa = enumValue(params.get('estadoEmpresa')!, APPROVALS);
    }
    if (params.has('estadoSolicitud')) {
        query.estadoSolicitud = enumValue(params.get('estadoSolicitud')!, REQUESTS);
    }
    if (params.has('cuenta')) {
        query.cuenta = enumValue(params.get('cuenta')!, ACCOUNTS);
    }

    return query;
}
