import type { EntityManager } from 'typeorm';
import { dataSource } from '../config/database.config';
import { env } from '../config/env.config';
import { academicOrderReference } from '../services/orders/academic-checkout';
import { commercialDayUtcRange, orderInstant, serializeOrderInstant } from './order-instant';
import {
    getAllowedNextStates,
    type AdminOrderListFilters,
    type AdminOrderOperationalStatus,
} from '../dtos/orders/admin-order.dto';
import {
    projectOrderStates,
    type OrderDocumentState,
    type OrderFinancialState,
} from '../services/orders/order-state-projection';

export interface AdminOrderClientSummary {
    idCliente: number;
    tipoCliente: 'PARTICULAR' | 'EMPRESA';
    nombreRazonSocial: string;
    documento: string | null;
    cuit: string | null;
    email: string | null;
    estadoAprobacionEmpresa: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | null;
    esFiel: boolean;
    activo: boolean;
}

export interface AdminOrderClientDetail extends AdminOrderClientSummary {
    telefono: string | null;
    direccion: string | null;
}

export interface AdminOrderListItem {
    idPedido: number;
    fecha: string;
    estado: string;
    estadoPedido: string;
    estadoDocumental: OrderDocumentState;
    estadoFinanciero: OrderFinancialState;
    montoAcreditadoUSD: string | null;
    estadosPermitidos: readonly AdminOrderOperationalStatus[];
    modalidadPago: string;
    moneda: string | null;
    subtotal: string;
    descuento: string;
    total: string;
    evidenciaTotalUSD: string | null;
    observaciones: string | null;
    cantidadItems: number;
    totalUnidades: number;
    cargoCuentaCorrienteId: number | null;
    origen: 'REAL' | 'DEMO';
    comprobantes: { total: number; pendientesRevision: number };
    cliente: AdminOrderClientSummary;
}

export interface AdminOrderLineItem {
    idDetallePedido: number;
    idProducto: number;
    codigoProducto: string;
    nombreProducto: string;
    cantidad: number;
    precioUnitario: string;
    descuento: string;
    subtotal: string;
    reglaPrecio: string | null;
}

export interface AdminOrderDetail extends Omit<AdminOrderListItem, 'cliente'> {
    cliente: AdminOrderClientDetail;
    items: AdminOrderLineItem[];
}

export interface AdminOrderListResult {
    items: AdminOrderListItem[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

interface RawOrderRow {
    id_pedido: number | string;
    fecha_utc: string;
    estado: string;
    modalidad_pago: string;
    moneda_total: string | null;
    evidencia_total_usd: string | null;
    subtotal: string | number;
    descuento: string | number;
    total: string | number;
    observaciones: string | null;
    cantidad_items: number | string;
    total_unidades: number | string;
    id_cargo: number | string | null;
    cargo_estado: string | null;
    cargo_monto: string | number | null;
    cuenta_cobertura: string | null;
    monto_imputado_vigente: string | number | null;
    comprobantes_total: number | string;
    comprobantes_aprobados: number | string;
    comprobantes_pendientes: number | string;
    comprobantes_rechazados: number | string;
    pagos_sin_usd: number | string;
    total_acreditado_usd: string | number | null;
    id_cliente: number | string;
    tipo_cliente: 'PARTICULAR' | 'EMPRESA';
    nombre_razon_social: string;
    doc_cliente: string | null;
    cuit: string | null;
    email: string | null;
    telefono?: string | null;
    direccion?: string | null;
    estado_aprobacion_empresa: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | null;
    es_fiel: number | boolean;
    cliente_activo: number | boolean;
    comprobantes_total: number | string;
    comprobantes_pendientes: number | string;
}

// Mismo alcance documental que el listado de comprobantes ADMIN. Consultas
// por pedido indexado: no descargar ni recorrer todos los comprobantes en la UI.
const receiptOwnerPredicate = `r.id_pedido = p.id_pedido AND r.id_cliente = p.id_cliente
  AND (r.id_cuenta_corriente IS NULL OR EXISTS (
    SELECT 1 FROM CUENTA_CORRIENTE rc
    WHERE rc.id_cuenta_corriente = r.id_cuenta_corriente AND rc.id_cliente = r.id_cliente
  ))`;
const receiptSummaryColumns = `
  (SELECT COUNT(*) FROM COMPROBANTE_PAGO r WHERE ${receiptOwnerPredicate}) AS comprobantes_total,
  (SELECT COUNT(*) FROM COMPROBANTE_PAGO r WHERE ${receiptOwnerPredicate} AND r.revision_utc IS NULL) AS comprobantes_pendientes,
`;

interface RawOrderLineRow {
    id_detalle_pedido: number | string;
    id_producto: number | string;
    codigo_producto: string;
    nombre_producto: string;
    cantidad: number | string;
    precio_unitario: string | number;
    descuento: string | number;
    subtotal: string | number;
    regla_precio: string | null;
}

function toMoneyString(value: string | number): string {
    if (typeof value === 'string' && /^-?\d+\.\d{2}$/.test(value)) {
        return value;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num.toFixed(2) : '0.00';
}

function resolveOrigin(estado: string, modalidadPago: string, evidencia: string | null): 'REAL' | 'DEMO' {
    return estado.startsWith('DEMO_') || modalidadPago.startsWith('DEMO_') || evidencia?.startsWith(academicOrderReference)
        ? 'DEMO'
        : 'REAL';
}

function mapOrderListItem(row: RawOrderRow): AdminOrderListItem {
    const estado = String(row.estado);
    const modalidadPago = String(row.modalidad_pago);
    const origen = resolveOrigin(estado, modalidadPago, row.evidencia_total_usd);
    const moneda = row.moneda_total ? String(row.moneda_total) : null;
    const total = toMoneyString(row.total);
    const projection = projectOrderStates(
        estado,
        {
            total: Number(row.comprobantes_total ?? 0),
            aprobados: Number(row.comprobantes_aprobados ?? 0),
            pendientes: Number(row.comprobantes_pendientes ?? 0),
            rechazados: Number(row.comprobantes_rechazados ?? 0),
        },
        {
            modalidadPago,
            monedaTotal: moneda,
            total,
            pagosAcreditadosSinUsd: Number(row.pagos_sin_usd ?? 0),
            totalAcreditadoUsd: row.total_acreditado_usd,
            cuentaCobertura: row.cuenta_cobertura,
            cargoEstado: row.cargo_estado,
            cargoMonto: row.cargo_monto,
            montoImputadoVigente: row.monto_imputado_vigente,
        },
    );

    return {
        idPedido: Number(row.id_pedido),
        fecha: serializeOrderInstant(row.fecha_utc),
        estado,
        estadoPedido: projection.estadoPedido,
        estadoDocumental: projection.estadoDocumental,
        estadoFinanciero: projection.estadoFinanciero,
        montoAcreditadoUSD: projection.montoAcreditadoUSD,
        estadosPermitidos: origen === 'DEMO' ? [] : getAllowedNextStates(estado, modalidadPago),
        modalidadPago,
        moneda,
        subtotal: toMoneyString(row.subtotal),
        descuento: toMoneyString(row.descuento),
        total,
        evidenciaTotalUSD: row.evidencia_total_usd ? String(row.evidencia_total_usd) : null,
        observaciones: row.observaciones ?? null,
        cantidadItems: Number(row.cantidad_items ?? 0),
        totalUnidades: Number(row.total_unidades ?? 0),
        cargoCuentaCorrienteId: row.id_cargo !== null && row.id_cargo !== undefined
            ? Number(row.id_cargo)
            : null,
        origen,
        comprobantes: {
            total: Number(row.comprobantes_total ?? 0),
            pendientesRevision: Number(row.comprobantes_pendientes ?? 0),
        },
        cliente: {
            idCliente: Number(row.id_cliente),
            tipoCliente: row.tipo_cliente,
            nombreRazonSocial: String(row.nombre_razon_social),
            documento: row.doc_cliente ?? null,
            cuit: row.cuit ?? null,
            email: row.email ?? null,
            estadoAprobacionEmpresa: row.estado_aprobacion_empresa ?? null,
            esFiel: Boolean(Number(row.es_fiel)),
            activo: Boolean(Number(row.cliente_activo)),
        },
    };
}

const ADMIN_ORDER_PROJECTION_COLUMNS = `
                mcc.estado AS cargo_estado,
                mcc.monto AS cargo_monto,
                COALESCE(cc_mov.cobertura, cc_cli.cobertura) AS cuenta_cobertura,
                COALESCE(imp_stat.monto_imputado_vigente, 0.00) AS monto_imputado_vigente,
                COALESCE(cp_stat.total, 0) AS comprobantes_total,
                COALESCE(cp_stat.aprobados, 0) AS comprobantes_aprobados,
                COALESCE(cp_stat.pendientes, 0) AS comprobantes_pendientes,
                COALESCE(cp_stat.rechazados, 0) AS comprobantes_rechazados,
                COALESCE(pago_stat.pagos_sin_usd, 0) AS pagos_sin_usd,
                COALESCE(pago_stat.total_acreditado_usd, 0.00) AS total_acreditado_usd,
`;

const ADMIN_ORDER_PROJECTION_JOINS = `
            LEFT JOIN CUENTA_CORRIENTE cc_mov ON cc_mov.id_cuenta_corriente = mcc.id_cuenta_corriente
            LEFT JOIN CUENTA_CORRIENTE cc_cli ON cc_cli.id_cliente = p.id_cliente
            LEFT JOIN (
                SELECT
                    id_cargo,
                    COALESCE(SUM(monto_imputado), 0.00) AS monto_imputado_vigente
                FROM IMPUTACION_MOVIMIENTO_CUENTA
                WHERE estado = 'VIGENTE'
                GROUP BY id_cargo
            ) imp_stat ON imp_stat.id_cargo = mcc.id_movimiento_cuenta
            LEFT JOIN (
                SELECT
                    id_pedido,
                    COUNT(*) AS total,
                    SUM(CASE WHEN estado_revision = 'APROBADO' THEN 1 ELSE 0 END) AS aprobados,
                    SUM(CASE WHEN estado_revision = 'PENDIENTE' THEN 1 ELSE 0 END) AS pendientes,
                    SUM(CASE WHEN estado_revision = 'RECHAZADO' THEN 1 ELSE 0 END) AS rechazados
                FROM COMPROBANTE_PAGO
                WHERE id_pedido IS NOT NULL
                GROUP BY id_pedido
            ) cp_stat ON cp_stat.id_pedido = p.id_pedido
            LEFT JOIN (
                SELECT
                    id_pedido,
                    SUM(CASE WHEN monto_usd IS NULL THEN 1 ELSE 0 END) AS pagos_sin_usd,
                    COALESCE(SUM(monto_usd), 0.00) AS total_acreditado_usd
                FROM PAGO
                WHERE id_pedido IS NOT NULL
                  AND estado = 'ACREDITADO'
                GROUP BY id_pedido
            ) pago_stat ON pago_stat.id_pedido = p.id_pedido
`;

export async function findAdminOrders(
    filters: AdminOrderListFilters,
): Promise<AdminOrderListResult> {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filters.estado !== undefined) {
        conditions.push('p.estado = ?');
        params.push(filters.estado);
    }

    if (filters.modalidadPago !== undefined) {
        conditions.push('p.modalidad_pago = ?');
        params.push(filters.modalidadPago);
    }

    if (filters.clienteId !== undefined) {
        conditions.push('p.id_cliente = ?');
        params.push(filters.clienteId);
    }

    if (filters.fecha !== undefined) {
        const { from, until } = commercialDayUtcRange(filters.fecha);
        conditions.push(`${orderInstant} >= ?`);
        params.push(env.legacyOrderOffset, from);
        if (until !== null) {
            conditions.push(`${orderInstant} < ?`);
            params.push(env.legacyOrderOffset, until);
        }
    }

    if (filters.q !== undefined) {
        const escaped = `%${filters.q.replace(/[!%_]/g, '!$&')}%`;
        if (/^[1-9]\d{0,9}$/.test(filters.q) && Number(filters.q) <= 2147483647) {
            conditions.push(
                "(p.id_pedido = ? OR c.nombre_razon_social LIKE ? ESCAPE '!' OR COALESCE(c.email, '') LIKE ? ESCAPE '!' OR COALESCE(c.cuit, '') LIKE ? ESCAPE '!' OR COALESCE(c.doc_cliente, '') LIKE ? ESCAPE '!')",
            );
            params.push(Number(filters.q), escaped, escaped, escaped, escaped);
        } else {
            conditions.push(
                "(c.nombre_razon_social LIKE ? ESCAPE '!' OR COALESCE(c.email, '') LIKE ? ESCAPE '!' OR COALESCE(c.cuit, '') LIKE ? ESCAPE '!' OR COALESCE(c.doc_cliente, '') LIKE ? ESCAPE '!')",
            );
            params.push(escaped, escaped, escaped, escaped);
        }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (filters.page - 1) * filters.limit;

    const countRows = await dataSource.query<Array<{ total: number | string }>>(
        `
            SELECT COUNT(*) AS total
            FROM PEDIDO p
            INNER JOIN CLIENTE c ON c.id_cliente = p.id_cliente
            ${whereClause}
        `,
        params,
    );

    const total = Number(countRows[0]?.total ?? 0);
    const totalPages = total === 0 ? 1 : Math.ceil(total / filters.limit);

    if (total === 0) {
        return {
            items: [],
            pagination: {
                page: filters.page,
                limit: filters.limit,
                total: 0,
                totalPages: 1,
            },
        };
    }

    const rows = await dataSource.query<RawOrderRow[]>(
        `
            SELECT
                p.id_pedido,
                CAST(${orderInstant} AS CHAR) AS fecha_utc,
                p.estado,
                p.modalidad_pago,
                p.moneda_total,
                p.evidencia_total_usd,
                p.subtotal,
                p.descuento,
                p.total,
                p.observaciones,
                ${receiptSummaryColumns}
                COALESCE(agg.cantidad_items, 0) AS cantidad_items,
                COALESCE(agg.total_unidades, 0) AS total_unidades,
                COALESCE(cpcc.id_cargo, mcc.id_movimiento_cuenta) AS id_cargo,
                ${ADMIN_ORDER_PROJECTION_COLUMNS}
                c.id_cliente,
                c.tipo_cliente,
                c.nombre_razon_social,
                c.doc_cliente,
                c.cuit,
                c.email,
                c.estado_aprobacion_empresa,
                c.es_fiel,
                c.activo AS cliente_activo
            FROM PEDIDO p
            INNER JOIN CLIENTE c ON c.id_cliente = p.id_cliente
            LEFT JOIN (
                SELECT
                    id_pedido,
                    COUNT(*) AS cantidad_items,
                    COALESCE(SUM(cantidad), 0) AS total_unidades
                FROM DETALLE_PEDIDO
                GROUP BY id_pedido
            ) agg ON agg.id_pedido = p.id_pedido
            LEFT JOIN CONFIRMACION_PEDIDO_CC cpcc ON cpcc.id_pedido = p.id_pedido
            LEFT JOIN MOVIMIENTO_CUENTA_CORRIENTE mcc ON mcc.id_pedido = p.id_pedido AND mcc.tipo_movimiento = 'CARGO'
            ${ADMIN_ORDER_PROJECTION_JOINS}
            ${whereClause}
            ORDER BY fecha_utc DESC, p.id_pedido DESC
            LIMIT ? OFFSET ?
        `,
        [env.legacyOrderOffset, ...params, filters.limit, offset],
    );

    return {
        items: rows.map(mapOrderListItem),
        pagination: {
            page: filters.page,
            limit: filters.limit,
            total,
            totalPages,
        },
    };
}

export async function findAdminOrderById(
    orderId: number,
    manager?: EntityManager,
): Promise<AdminOrderDetail | null> {
    const executor = manager ?? dataSource;

    const headerRows = await executor.query<RawOrderRow[]>(
        `
            SELECT
                p.id_pedido,
                CAST(${orderInstant} AS CHAR) AS fecha_utc,
                p.estado,
                p.modalidad_pago,
                p.moneda_total,
                p.evidencia_total_usd,
                p.subtotal,
                p.descuento,
                p.total,
                p.observaciones,
                ${receiptSummaryColumns}
                0 AS cantidad_items,
                0 AS total_unidades,
                COALESCE(cpcc.id_cargo, mcc.id_movimiento_cuenta) AS id_cargo,
                ${ADMIN_ORDER_PROJECTION_COLUMNS}
                c.id_cliente,
                c.tipo_cliente,
                c.nombre_razon_social,
                c.doc_cliente,
                c.cuit,
                c.email,
                c.telefono,
                c.direccion,
                c.estado_aprobacion_empresa,
                c.es_fiel,
                c.activo AS cliente_activo
            FROM PEDIDO p
            INNER JOIN CLIENTE c ON c.id_cliente = p.id_cliente
            LEFT JOIN CONFIRMACION_PEDIDO_CC cpcc ON cpcc.id_pedido = p.id_pedido
            LEFT JOIN MOVIMIENTO_CUENTA_CORRIENTE mcc ON mcc.id_pedido = p.id_pedido AND mcc.tipo_movimiento = 'CARGO'
            ${ADMIN_ORDER_PROJECTION_JOINS}
            WHERE p.id_pedido = ?
            LIMIT 1
        `,
        [env.legacyOrderOffset, orderId],
    );

    const row = headerRows[0];
    if (!row) {
        return null;
    }

    const lineRows = await executor.query<RawOrderLineRow[]>(
        `
            SELECT
                dp.id_detalle_pedido,
                dp.id_producto,
                pr.codigo AS codigo_producto,
                pr.nombre AS nombre_producto,
                dp.cantidad,
                dp.precio_unitario,
                dp.descuento,
                dp.subtotal,
                dpcp.regla AS regla_precio
            FROM DETALLE_PEDIDO dp
            INNER JOIN PRODUCTO pr ON pr.id_producto = dp.id_producto
            LEFT JOIN DETALLE_PEDIDO_CC_PRECIO dpcp
                ON dpcp.id_detalle_pedido = dp.id_detalle_pedido
            WHERE dp.id_pedido = ?
            ORDER BY dp.id_detalle_pedido ASC
        `,
        [orderId],
    );

    const items: AdminOrderLineItem[] = lineRows.map(line => ({
        idDetallePedido: Number(line.id_detalle_pedido),
        idProducto: Number(line.id_producto),
        codigoProducto: String(line.codigo_producto),
        nombreProducto: String(line.nombre_producto),
        cantidad: Number(line.cantidad),
        precioUnitario: toMoneyString(line.precio_unitario),
        descuento: toMoneyString(line.descuento),
        subtotal: toMoneyString(line.subtotal),
        reglaPrecio: line.regla_precio ? String(line.regla_precio) : null,
    }));

    const base = mapOrderListItem({
        ...row,
        cantidad_items: items.length,
        total_unidades: items.reduce((acc, item) => acc + item.cantidad, 0),
    });

    return {
        ...base,
        cliente: {
            ...base.cliente,
            telefono: row.telefono ?? null,
            direccion: row.direccion ?? null,
        },
        items,
    };
}

export interface LockedOrderStateRow {
    idPedido: number;
    idCliente: number;
    estado: string;
    modalidadPago: string;
    origen: 'REAL' | 'DEMO';
}

export async function lockAdminOrderForStateChange(
    manager: EntityManager,
    orderId: number,
): Promise<LockedOrderStateRow | null> {
    const rows = await manager.query<
        Array<{
            id_pedido: number | string;
            id_cliente: number | string;
            estado: string;
            modalidad_pago: string;
            evidencia_total_usd: string | null;
        }>
    >(
        `
            SELECT id_pedido, id_cliente, estado, modalidad_pago, evidencia_total_usd
            FROM PEDIDO
            WHERE id_pedido = ?
            FOR UPDATE
        `,
        [orderId],
    );

    const row = rows[0];
    if (!row) {
        return null;
    }

    return {
        idPedido: Number(row.id_pedido),
        idCliente: Number(row.id_cliente),
        estado: String(row.estado),
        modalidadPago: String(row.modalidad_pago),
        origen: resolveOrigin(row.estado, row.modalidad_pago, row.evidencia_total_usd),
    };
}

export async function verifyActiveAdminInTransaction(
    manager: EntityManager,
    userId: number,
): Promise<{ activo: boolean; rol: string } | null> {
    const [row] = await manager.query<Array<{ activo: number | boolean; rol: string }>>(
        `
            SELECT activo, rol
            FROM USUARIO
            WHERE id_usuario = ?
            LOCK IN SHARE MODE
        `,
        [userId],
    );
    if (!row) return null;
    return { activo: Number(row.activo) === 1, rol: String(row.rol) };
}

export async function updateAdminOrderStateInTransaction(
    manager: EntityManager,
    orderId: number,
    expectedCurrentState: string,
    nextState: AdminOrderOperationalStatus,
): Promise<boolean> {
    const result = await manager.query<{ affectedRows?: number }>(
        `
            UPDATE PEDIDO
            SET estado = ?
            WHERE id_pedido = ? AND estado = ?
        `,
        [nextState, orderId, expectedCurrentState],
    );

    return Number(result?.affectedRows ?? 0) === 1;
}
