import type { EntityManager } from 'typeorm';
import type {
    AdminCreditCompanyQuery,
    CreditCompanyApproval,
} from '../dtos/credit/admin-credit-companies.dto';
import type { CreditRequestState } from '../dtos/credit/credit-workflow.dto';
import { noSyntheticLedgerSql } from './cuentaCorriente.repository';

export interface AdminCreditCompanyRow {
    id_cliente: number;
    nombre_razon_social: string;
    email: string;
    cuit: string | null;
    doc_cliente: string | null;
    estado_aprobacion_empresa: CreditCompanyApproval | null;
    activo: number;
    id_cuenta_corriente: number | null;
    limite_credito: string | null;
    habilitada: number | null;
    cobertura: 'COMPLETA' | 'PARCIAL' | 'NO_ACREDITADA' | null;
    plazo_dias: number | null;
    moneda_limite: string | null;
    origen_datos: 'REAL' | 'DEMO' | null;
    id_solicitud_credito: number | null;
    estado_solicitud: CreditRequestState | null;
    monto_solicitado: string | null;
    plazo_solicitado: number | null;
    fecha_solicitud_iso: string | null;
    fecha_resolucion_iso: string | null;
    limite_autorizado: string | null;
    plazo_autorizado: number | null;
}

export interface AdminCreditCompanyPage {
    rows: AdminCreditCompanyRow[];
    total: number;
}

const SELECT = `
    c.id_cliente,
    c.nombre_razon_social,
    u.email,
    c.cuit,
    c.doc_cliente,
    c.estado_aprobacion_empresa,
    c.activo,
    cc.id_cuenta_corriente,
    cc.limite_credito,
    cc.habilitada,
    cc.cobertura,
    cc.plazo_dias,
    cc.moneda_limite,
    cc.origen_datos,
    s.id_solicitud_credito,
    s.estado AS estado_solicitud,
    s.monto_solicitado,
    s.plazo_solicitado,
    DATE_FORMAT(s.fecha_solicitud_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS fecha_solicitud_iso,
    DATE_FORMAT(s.fecha_resolucion_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS fecha_resolucion_iso,
    s.limite_autorizado,
    s.plazo_autorizado
`;

const FROM = `
    FROM CLIENTE c
    INNER JOIN (
        SELECT id_cliente, MIN(id_usuario) AS id_usuario_principal
        FROM USUARIO
        WHERE rol = 'CLIENTE'
        GROUP BY id_cliente
    ) up ON up.id_cliente = c.id_cliente
    INNER JOIN USUARIO u ON u.id_usuario = up.id_usuario_principal
    LEFT JOIN CUENTA_CORRIENTE cc ON cc.id_cliente = c.id_cliente
        AND (? = 1 OR (cc.origen_datos = 'REAL' AND ${noSyntheticLedgerSql('cc')}))
    LEFT JOIN SOLICITUD_CREDITO s ON s.id_solicitud_credito = (
        SELECT MAX(s2.id_solicitud_credito)
        FROM SOLICITUD_CREDITO s2
        WHERE s2.id_cliente = c.id_cliente
    )
`;

const escapeLike = (value: string): string => value.replace(/[!%_]/g, '!$&');

function where(query: AdminCreditCompanyQuery, includeTestOrigin: boolean) {
    const conditions: string[] = ["c.tipo_cliente = 'EMPRESA'"];
    const values: unknown[] = [includeTestOrigin ? 1 : 0];

    if (query.busqueda !== undefined) {
        const explicitId = /^#\d+$/.test(query.busqueda)
            && Number(query.busqueda.slice(1)) <= 2147483647
            ? Number(query.busqueda.slice(1))
            : null;
        if (explicitId !== null) {
            conditions.push('c.id_cliente = ?');
            values.push(explicitId);
        } else {
            const pattern = `%${escapeLike(query.busqueda)}%`;
            const candidate = query.busqueda.replace(/^#/, '');
            const searchId = /^\d+$/.test(candidate) && Number(candidate) <= 2147483647
                ? Number(candidate)
                : null;
            const idClause = searchId === null ? '' : ' OR c.id_cliente = ?';
            conditions.push(`(
                LOWER(c.nombre_razon_social) LIKE LOWER(?) ESCAPE '!'
                OR LOWER(u.email) LIKE LOWER(?) ESCAPE '!'
                OR LOWER(c.cuit) LIKE LOWER(?) ESCAPE '!'
                OR LOWER(c.doc_cliente) LIKE LOWER(?) ESCAPE '!'
                ${idClause}
            )`);
            values.push(pattern, pattern, pattern, pattern);
            if (searchId !== null) values.push(searchId);
        }
    }

    if (query.estadoEmpresa !== undefined) {
        conditions.push('c.estado_aprobacion_empresa = ?');
        values.push(query.estadoEmpresa);
    }

    if (query.estadoSolicitud !== undefined) {
        if (query.estadoSolicitud === 'SIN_SOLICITUD') {
            conditions.push('s.id_solicitud_credito IS NULL');
        } else {
            conditions.push('s.estado = ?');
            values.push(query.estadoSolicitud);
        }
    }

    if (query.cuenta !== undefined) {
        if (query.cuenta === 'SIN_CUENTA') {
            conditions.push('cc.id_cuenta_corriente IS NULL');
        } else {
            conditions.push('cc.id_cuenta_corriente IS NOT NULL AND cc.habilitada = ?');
            values.push(query.cuenta === 'HABILITADA' ? 1 : 0);
        }
    }

    return { conditions, values };
}

export async function findAdminCreditCompanyPage(
    manager: EntityManager,
    query: AdminCreditCompanyQuery,
    includeTestOrigin: boolean,
): Promise<AdminCreditCompanyPage> {
    const { conditions, values } = where(query, includeTestOrigin);
    const clause = `WHERE ${conditions.join(' AND ')}`;
    const [count] = await manager.query<{ total: number | string }[]>(
        `SELECT COUNT(*) AS total ${FROM} ${clause}`,
        [...values],
    );
    const total = Number(count?.total ?? 0);
    const offset = (query.page - 1) * query.limit;
    const rows = total === 0 ? [] : await manager.query<AdminCreditCompanyRow[]>(
        `SELECT ${SELECT} ${FROM} ${clause}
         ORDER BY u.fecha_creacion DESC, c.id_cliente DESC
         LIMIT ? OFFSET ?`,
        [...values, query.limit, offset],
    );
    return { rows, total };
}

export async function findAdminCreditCompanyById(
    manager: EntityManager,
    clientId: number,
    includeTestOrigin: boolean,
): Promise<AdminCreditCompanyRow | null> {
    const [row] = await manager.query<AdminCreditCompanyRow[]>(
        `SELECT ${SELECT} ${FROM}
         WHERE c.tipo_cliente = 'EMPRESA' AND c.id_cliente = ?`,
        [includeTestOrigin ? 1 : 0, clientId],
    );
    return row ?? null;
}
