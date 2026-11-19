import type { EntityManager } from 'typeorm';
import {
  LOW_STOCK_THRESHOLD,
  type AdminDashboardOrdersByStatus,
} from '../dtos/dashboard/admin-dashboard.dto';
import { academicOrderReference } from '../services/orders/academic-checkout';

export interface RawDashboardAggregates {
  pedidosPorEstado: AdminDashboardOrdersByStatus;
  pedidosCuentaCorriente: number;
  comprobantesTotales: number;
  comprobantesSinRevisar: number;
  alertasStockBajo: number;
  productosSinStock: number;
  empresasFieles: number;
}

const REAL_ORDER_SQL_FILTER = `
  p.estado NOT LIKE 'DEMO_%'
  AND p.modalidad_pago NOT LIKE 'DEMO_%'
  AND (p.evidencia_total_usd IS NULL OR p.evidencia_total_usd NOT LIKE ?)
  AND (c.email IS NULL OR c.email NOT LIKE '%@demo.local')
  AND (cc.id_cuenta_corriente IS NULL OR cc.origen_datos = 'REAL')
`;

export async function queryAdminDashboardAggregates(
  manager: EntityManager,
  lowStockThreshold = LOW_STOCK_THRESHOLD,
): Promise<RawDashboardAggregates> {
  const academicPrefix = `${academicOrderReference}%`;

  const orderRows = await manager.query<
    Array<{
      confirmados: number | string;
      en_preparacion: number | string;
      enviados: number | string;
      entregados: number | string;
      cuenta_corriente: number | string;
    }>
  >(
    `
      SELECT
        COALESCE(SUM(CASE WHEN p.estado = 'CONFIRMADO' THEN 1 ELSE 0 END), 0) AS confirmados,
        COALESCE(SUM(CASE WHEN p.estado = 'EN_PREPARACION' THEN 1 ELSE 0 END), 0) AS en_preparacion,
        COALESCE(SUM(CASE WHEN p.estado = 'ENVIADO' THEN 1 ELSE 0 END), 0) AS enviados,
        COALESCE(SUM(CASE WHEN p.estado = 'ENTREGADO' THEN 1 ELSE 0 END), 0) AS entregados,
        COALESCE(SUM(CASE WHEN p.modalidad_pago = 'CUENTA_CORRIENTE' THEN 1 ELSE 0 END), 0) AS cuenta_corriente
      FROM PEDIDO p
      INNER JOIN CLIENTE c ON c.id_cliente = p.id_cliente
      LEFT JOIN CUENTA_CORRIENTE cc ON cc.id_cliente = p.id_cliente
      WHERE ${REAL_ORDER_SQL_FILTER}
    `,
    [academicPrefix],
  );

  const receiptRows = await manager.query<
    Array<{
      totales: number | string;
      sin_revisar: number | string;
    }>
  >(
    `
      SELECT
        COUNT(*) AS totales,
        COALESCE(SUM(CASE WHEN cp.id_admin_revision IS NULL THEN 1 ELSE 0 END), 0) AS sin_revisar
      FROM COMPROBANTE_PAGO cp
      INNER JOIN CLIENTE c_cp ON c_cp.id_cliente = cp.id_cliente
      LEFT JOIN CUENTA_CORRIENTE cc_cp ON cc_cp.id_cliente = cp.id_cliente
      LEFT JOIN CUENTA_CORRIENTE cc_direct ON cc_direct.id_cuenta_corriente = cp.id_cuenta_corriente
      LEFT JOIN PEDIDO p ON p.id_pedido = cp.id_pedido
      LEFT JOIN CLIENTE c ON c.id_cliente = p.id_cliente
      LEFT JOIN CUENTA_CORRIENTE cc ON cc.id_cliente = p.id_cliente
      WHERE (c_cp.email IS NULL OR c_cp.email NOT LIKE '%@demo.local')
        AND (cc_cp.id_cuenta_corriente IS NULL OR cc_cp.origen_datos = 'REAL')
        AND (cp.id_cuenta_corriente IS NULL OR cc_direct.origen_datos = 'REAL')
        AND (
          (cp.id_pedido IS NOT NULL AND ${REAL_ORDER_SQL_FILTER})
          OR (cp.id_pedido IS NULL AND cp.id_cuenta_corriente IS NOT NULL AND cc_direct.origen_datos = 'REAL')
        )
    `,
    [academicPrefix],
  );

  const productRows = await manager.query<
    Array<{
      stock_bajo: number | string;
      sin_stock: number | string;
    }>
  >(
    `
      SELECT
        COALESCE(SUM(CASE WHEN pr.stock <= ? THEN 1 ELSE 0 END), 0) AS stock_bajo,
        COALESCE(SUM(CASE WHEN pr.stock = 0 THEN 1 ELSE 0 END), 0) AS sin_stock
      FROM PRODUCTO pr
      WHERE pr.activo = 1
        AND pr.codigo NOT LIKE 'DEMO-%'
        AND pr.codigo NOT LIKE 'FP-DEMO-%'
    `,
    [lowStockThreshold],
  );

  const clientRows = await manager.query<Array<{ empresas_fieles: number | string }>>(
    `
      SELECT COUNT(*) AS empresas_fieles
      FROM CLIENTE c
      LEFT JOIN CUENTA_CORRIENTE cc ON cc.id_cliente = c.id_cliente
      WHERE c.tipo_cliente = 'EMPRESA'
        AND c.activo = 1
        AND c.estado_aprobacion_empresa = 'APROBADA'
        AND c.es_fiel = 1
        AND (c.email IS NULL OR c.email NOT LIKE '%@demo.local')
        AND (cc.id_cuenta_corriente IS NULL OR cc.origen_datos = 'REAL')
    `,
  );

  const ord = orderRows[0] ?? {
    confirmados: 0,
    en_preparacion: 0,
    enviados: 0,
    entregados: 0,
    cuenta_corriente: 0,
  };

  const confirmados = Number(ord.confirmados ?? 0);
  const enPreparacion = Number(ord.en_preparacion ?? 0);
  const enviados = Number(ord.enviados ?? 0);
  const entregados = Number(ord.entregados ?? 0);

  return {
    pedidosPorEstado: {
      CONFIRMADO: confirmados,
      EN_PREPARACION: enPreparacion,
      ENVIADO: enviados,
      ENTREGADO: entregados,
      totalOperativos: confirmados + enPreparacion + enviados + entregados,
    },
    pedidosCuentaCorriente: Number(ord.cuenta_corriente ?? 0),
    comprobantesTotales: Number(receiptRows[0]?.totales ?? 0),
    comprobantesSinRevisar: Number(receiptRows[0]?.sin_revisar ?? 0),
    alertasStockBajo: Number(productRows[0]?.stock_bajo ?? 0),
    productosSinStock: Number(productRows[0]?.sin_stock ?? 0),
    empresasFieles: Number(clientRows[0]?.empresas_fieles ?? 0),
  };
}