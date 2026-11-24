import type { EntityManager } from 'typeorm';
import { inTransaction } from '../../config/database.config';
import type { AdminCreditCompanyQuery } from '../../dtos/credit/admin-credit-companies.dto';
import type { AuthContext } from '../../types/auth';
import {
    findAdminCreditCompanyById,
    findAdminCreditCompanyPage,
    type AdminCreditCompanyRow,
} from '../../repositories/adminCreditCompany.repository';
import { findUserById } from '../../repositories/creditWorkflow.repository';
import {
    CreditWorkflowError,
    noAutenticado,
    sinPermiso,
} from './credit-workflow.errors';

async function readAdmin(manager: EntityManager, auth: AuthContext) {
    if (auth.rol !== 'ADMIN') throw sinPermiso();
    const user = await findUserById(manager, auth.id);
    if (!user || user.activo !== 1) throw noAutenticado();
    if (user.rol !== 'ADMIN' || user.id_cliente !== null) throw sinPermiso();
}

function presentCompany(row: AdminCreditCompanyRow) {
    const account = row.id_cuenta_corriente === null ? null : {
        cuentaId: Number(row.id_cuenta_corriente),
        estado: row.habilitada === 1 ? 'HABILITADA' as const : 'INHABILITADA' as const,
        limite: row.moneda_limite === 'USD' ? row.limite_credito : null,
        moneda: 'USD' as const,
        plazoDias: row.plazo_dias === 30 || row.plazo_dias === 60 ? row.plazo_dias : null,
        cobertura: row.cobertura ?? 'NO_ACREDITADA' as const,
        origen: row.origen_datos ?? 'REAL' as const,
    };

    const request = row.id_solicitud_credito === null ? null : {
        id: Number(row.id_solicitud_credito),
        estado: row.estado_solicitud!,
        montoSolicitado: row.monto_solicitado!,
        plazoDias: row.plazo_solicitado!,
        fechaSolicitud: row.fecha_solicitud_iso,
        fechaResolucion: row.fecha_resolucion_iso,
        limiteAutorizado: row.limite_autorizado,
        plazoAutorizado: row.plazo_autorizado,
    };

    return {
        clienteId: Number(row.id_cliente),
        nombreRazonSocial: row.nombre_razon_social,
        cuit: row.cuit,
        email: row.email,
        estadoAprobacionEmpresa: row.estado_aprobacion_empresa,
        activo: row.activo === 1,
        cuentaCorriente: account,
        solicitudCredito: request,
    };
}

async function readPage(manager: EntityManager, query: AdminCreditCompanyQuery) {
    const includeTestOrigin = process.env.NODE_ENV === 'test';
    let result = await findAdminCreditCompanyPage(manager, query, includeTestOrigin);
    const totalPages = result.total === 0 ? 0 : Math.ceil(result.total / query.limit);
    let page = query.page;
    if (result.rows.length === 0 && result.total > 0 && page > 1) {
        page = Math.max(1, totalPages);
        result = await findAdminCreditCompanyPage(manager, { ...query, page }, includeTestOrigin);
    }
    return {
        empresas: result.rows.map(presentCompany),
        paginacion: {
            page,
            limit: query.limit,
            total: result.total,
            totalPages,
        },
    };
}

export async function listAdminCreditCompanies(auth: AuthContext, query: AdminCreditCompanyQuery) {
    return inTransaction(async manager => {
        await readAdmin(manager, auth);
        return readPage(manager, query);
    }, { isolation: 'REPEATABLE READ' });
}

export async function getAdminCreditCompany(auth: AuthContext, clientId: number) {
    return inTransaction(async manager => {
        await readAdmin(manager, auth);
        const row = await findAdminCreditCompanyById(
            manager,
            clientId,
            process.env.NODE_ENV === 'test',
        );
        if (!row) throw new CreditWorkflowError('CLIENTE_NO_ENCONTRADO', 404, 'El cliente no existe.');
        return { empresa: presentCompany(row) };
    }, { isolation: 'REPEATABLE READ' });
}
