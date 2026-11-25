import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { ReadQuery } from '../config/database.config';
import { env } from '../config/env.config';
import { orderInstant, serializeOrderInstant } from './order-instant';
import {
  bounded,
  decimal,
  format,
  MONEY_MAX,
} from '../services/pricing/money';
import type {
  AccountOrderQuote,
} from '../services/orders/account-order.pricing';
import { AccountOrderError } from '../services/orders/account-order.errors';
import { academicOrderNote, academicOrderReference, isAcademicPrice, verifyAcademicOrder, type AcademicCheckout } from '../services/orders/academic-checkout';
import type {
  ClientOrderDetail,
  ClientOrderLine,
  ClientOrderSummary,
} from '../services/orders/account-order.types';
import { isCatalogReference } from '../services/pricing/catalog-reference';
import { projectOrderStates } from '../services/orders/order-state-projection';

function invalidAmount(): never {
  throw new AccountOrderError(
    'IMPORTE_PEDIDO_INVALIDO',
    422,
    'Los importes del pedido no son consistentes.',
  );
}

function prepare(quote: AccountOrderQuote, simulated: boolean) {
  if (quote.regla !== 'FER17-v1' ||
    quote.moneda !== 'USD' ||
    quote.ivaIncluido !== true ||
    quote.lines.length === 0) {
    invalidAmount();
  }

  const products = new Set<number>();

  const lines = quote.lines.map(line => {
    if (products.has(line.productoId) ||
      !Number.isInteger(line.cantidad) ||
      line.cantidad < 1 ||
      line.cantidad > 2147483647 ||
      !line.precioComprable ||
      !line.evidenciaBaseUSD ||
      (simulated ? !isAcademicPrice(line) : (line.evidenciaBaseUSD.synthetic && !(line.referenciaCatalogo === true && isCatalogReference(
        line.evidenciaBaseUSD.reference.split(' SKU:')[1],
        line.precioBaseUSD,
        line.evidenciaBaseUSD.reference,
        1,
      )))) ||
      line.precioBaseUSD === null ||
      line.precioUnitarioUSD === null ||
      line.subtotalUSD === null) {
      invalidAmount();
    }

    products.add(line.productoId);

    const base = decimal(line.precioBaseUSD, 2, MONEY_MAX);
    const unit = decimal(line.precioUnitarioUSD, 2, MONEY_MAX);
    const net = decimal(line.subtotalUSD, 2, MONEY_MAX);
    const gross = bounded(base * BigInt(line.cantidad));

    if (base === 0n || unit === 0n ||
      net !== unit * BigInt(line.cantidad) ||
      net > gross) {
      invalidAmount();
    }

    return { line, gross, net, discount: gross - net };
  });

  const gross = bounded(lines.reduce((sum, item) => sum + item.gross, 0n));
  const net = bounded(lines.reduce((sum, item) => sum + item.net, 0n));

  if (net === 0n || net !== decimal(quote.totalUSD, 2, MONEY_MAX)) {
    invalidAmount();
  }

  return { lines, gross, net };
}

async function persistOrderByModality(
  manager: EntityManager,
  clientId: number,
  quote: AccountOrderQuote,
  modalidadPago: 'CUENTA_CORRIENTE' | 'TRANSFERENCIA',
  academic?: { policy: AcademicCheckout; origin: string },
): Promise<number> {
  if (!manager.queryRunner?.isTransactionActive) {
    throw new Error('Guardar el pedido requiere una transacción activa.');
  }

  if (academic) await verifyAcademicOrder(manager, academic.policy, academic.origin);
  const simulated = academic !== undefined;
  if (simulated !== (quote.simulado === true)) invalidAmount();
  const prepared = prepare(quote, simulated);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ clientId, quote }))
    .digest('hex');

  const order = await manager.query(`
    INSERT INTO PEDIDO (
      id_cliente, estado, modalidad_pago,
      subtotal, descuento, total,
      moneda_total, evidencia_total_usd, observaciones, fecha_utc
    ) VALUES (?, 'CONFIRMADO', ?, ?, ?, ?, 'USD', ?, ?, UTC_TIMESTAMP(3))
  `, [
    clientId,
    modalidadPago,
    format(prepared.gross),
    format(prepared.gross - prepared.net),
    format(prepared.net),
    (simulated ? academicOrderReference : 'FER17-v1:SHA256:') + fingerprint,
    simulated ? academicOrderNote : null,
  ]);

  const orderId = Number(order.insertId);

  for (const item of prepared.lines) {
    const detail = await manager.query(`
      INSERT INTO DETALLE_PEDIDO (
        id_pedido, id_producto, cantidad,
        precio_unitario, descuento, subtotal
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [
      orderId,
      item.line.productoId,
      item.line.cantidad,
      item.line.precioBaseUSD,
      format(item.discount),
      format(item.net),
    ]);

    await manager.query(`
      INSERT INTO DETALLE_PEDIDO_CC_PRECIO (
        id_detalle_pedido, regla, snapshot_json
      ) VALUES (?, 'FER17-v1', ?)
    `, [
      Number(detail.insertId),
      JSON.stringify({
        regla: quote.regla,
        moneda: quote.moneda,
        ivaIncluido: quote.ivaIncluido,
        aplicadoEn: quote.aplicadoEn,
        ...(simulated ? { simulado: true } : {}),
        producto: item.line,
      }),
    ]);
  }

  return orderId;
}

export async function persistAccountOrder(
  manager: EntityManager,
  clientId: number,
  quote: AccountOrderQuote,
  academic?: { policy: AcademicCheckout; origin: string },
): Promise<number> {
  return persistOrderByModality(manager, clientId, quote, 'CUENTA_CORRIENTE', academic);
}

export async function persistTransferOrder(
  manager: EntityManager,
  clientId: number,
  quote: AccountOrderQuote,
  academic?: { policy: AcademicCheckout; origin: string },
): Promise<number> {
  return persistOrderByModality(manager, clientId, quote, 'TRANSFERENCIA', academic);
}

interface OrderSummaryRow {
  evidencia: string | null;
  pedidoId: number;
  fechaUtc: string;
  estado: string;
  modalidadPago: string;
  moneda: string | null;
  subtotal: string;
  descuento: string;
  total: string;
  observaciones: string | null;
  cantidadLineas: number | string;
  cantidadUnidades: number | string;
  cargoId: number | string | null;
  venceEl: string | null;
  cargoEstado: string | null;
  cargoMonto: string | number | null;
  cuentaCobertura: string | null;
  montoImputadoVigente: string | number | null;
  comprobantesTotal: number | string;
  comprobantesAprobados: number | string;
  comprobantesPendientes: number | string;
  comprobantesRechazados: number | string;
  pagosAcreditadosSinUsd: number | string;
  totalAcreditadoUsd: string | number | null;
}

interface OrderLineRow {
  detalleId: number;
  productoId: number;
  codigo: string;
  nombre: string;
  cantidad: number;
  precioUnitario: string;
  descuento: string;
  subtotal: string;
}

function mapOrderSummary(row: OrderSummaryRow): ClientOrderSummary {
  const pedidoId = Number(row.pedidoId);
  const moneda = row.moneda !== null && row.moneda !== undefined ? String(row.moneda) : null;
  const total = String(row.total);
  const projection = projectOrderStates(
    row.estado,
    {
      total: Number(row.comprobantesTotal ?? 0),
      aprobados: Number(row.comprobantesAprobados ?? 0),
      pendientes: Number(row.comprobantesPendientes ?? 0),
      rechazados: Number(row.comprobantesRechazados ?? 0),
    },
    {
      modalidadPago: row.modalidadPago,
      monedaTotal: moneda,
      total,
      pagosAcreditadosSinUsd: Number(row.pagosAcreditadosSinUsd ?? 0),
      totalAcreditadoUsd: row.totalAcreditadoUsd,
      cuentaCobertura: row.cuentaCobertura,
      cargoEstado: row.cargoEstado,
      cargoMonto: row.cargoMonto,
      montoImputadoVigente: row.montoImputadoVigente,
    },
  );

  return {
    pedidoId,
    ...(row.evidencia?.startsWith(academicOrderReference) ? { simulado: true as const } : {}),
    numero: `PED-${String(pedidoId).padStart(6, '0')}`,
    fecha: serializeOrderInstant(row.fechaUtc),
    estado: row.estado,
    estadoPedido: projection.estadoPedido,
    estadoDocumental: projection.estadoDocumental,
    estadoFinanciero: projection.estadoFinanciero,
    montoAcreditadoUSD: projection.montoAcreditadoUSD,
    modalidadPago: row.modalidadPago,
    moneda,
    subtotal: String(row.subtotal),
    descuento: String(row.descuento),
    total,
    totalUSD: moneda === 'USD' ? total : null,
    observaciones: row.observaciones ?? null,
    cantidadLineas: Number(row.cantidadLineas ?? 0),
    cantidadUnidades: Number(row.cantidadUnidades ?? 0),
    cargoId: row.cargoId !== null && row.cargoId !== undefined
      ? String(row.cargoId)
      : null,
    venceEl: row.venceEl ?? null,
  };
}

const CLIENT_ORDER_PROJECTION_SELECT = `
      p.id_pedido AS pedidoId,
      CAST(${orderInstant} AS CHAR) AS fechaUtc,
      p.estado AS estado,
      p.modalidad_pago AS modalidadPago,
      p.moneda_total AS moneda,
      p.subtotal AS subtotal,
      p.descuento AS descuento,
      p.total AS total,
      p.observaciones AS observaciones,
      p.evidencia_total_usd AS evidencia,
      COALESCE(dp_stat.cantidadLineas, 0) AS cantidadLineas,
      COALESCE(dp_stat.cantidadUnidades, 0) AS cantidadUnidades,
      CASE WHEN m.estado = 'ACREDITADO' THEN m.id_movimiento_cuenta ELSE NULL END AS cargoId,
      CASE WHEN m.estado = 'ACREDITADO' THEN DATE_FORMAT(m.vence_el, '%Y-%m-%d') ELSE NULL END AS venceEl,
      m.estado AS cargoEstado,
      m.monto AS cargoMonto,
      COALESCE(cc_mov.cobertura, cc_cli.cobertura) AS cuentaCobertura,
      COALESCE(imp_stat.montoImputadoVigente, 0.00) AS montoImputadoVigente,
      COALESCE(cp_stat.total, 0) AS comprobantesTotal,
      COALESCE(cp_stat.aprobados, 0) AS comprobantesAprobados,
      COALESCE(cp_stat.pendientes, 0) AS comprobantesPendientes,
      COALESCE(cp_stat.rechazados, 0) AS comprobantesRechazados,
      COALESCE(pago_stat.pagosSinUsd, 0) AS pagosAcreditadosSinUsd,
      COALESCE(pago_stat.totalAcreditadoUsd, 0.00) AS totalAcreditadoUsd
    FROM PEDIDO p
    LEFT JOIN (
      SELECT
        id_pedido,
        COUNT(id_detalle_pedido) AS cantidadLineas,
        COALESCE(SUM(cantidad), 0) AS cantidadUnidades
      FROM DETALLE_PEDIDO
      GROUP BY id_pedido
    ) dp_stat
      ON dp_stat.id_pedido = p.id_pedido
    LEFT JOIN MOVIMIENTO_CUENTA_CORRIENTE m
      ON m.id_pedido = p.id_pedido
      AND m.tipo_movimiento = 'CARGO'
    LEFT JOIN CUENTA_CORRIENTE cc_mov
      ON cc_mov.id_cuenta_corriente = m.id_cuenta_corriente
    LEFT JOIN CUENTA_CORRIENTE cc_cli
      ON cc_cli.id_cliente = p.id_cliente
    LEFT JOIN (
      SELECT
        id_cargo,
        COALESCE(SUM(monto_imputado), 0.00) AS montoImputadoVigente
      FROM IMPUTACION_MOVIMIENTO_CUENTA
      WHERE estado = 'VIGENTE'
      GROUP BY id_cargo
    ) imp_stat
      ON imp_stat.id_cargo = m.id_movimiento_cuenta
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
    ) cp_stat
      ON cp_stat.id_pedido = p.id_pedido
    LEFT JOIN (
      SELECT
        id_pedido,
        SUM(CASE WHEN monto_usd IS NULL THEN 1 ELSE 0 END) AS pagosSinUsd,
        COALESCE(SUM(monto_usd), 0.00) AS totalAcreditadoUsd
      FROM PAGO
      WHERE id_pedido IS NOT NULL
        AND estado = 'ACREDITADO'
      GROUP BY id_pedido
    ) pago_stat
      ON pago_stat.id_pedido = p.id_pedido
`;

export async function findClientOrdersByClientId(
  clientId: number,
  query: ReadQuery,
): Promise<ClientOrderSummary[]> {
  const rows = await query<OrderSummaryRow[]>(`
    SELECT
      ${CLIENT_ORDER_PROJECTION_SELECT}
    WHERE p.id_cliente = ?
    ORDER BY fechaUtc DESC, p.id_pedido DESC
  `, [env.legacyOrderOffset, clientId]);

  return rows.map(mapOrderSummary);
}

export async function findClientOrderDetailById(
  clientId: number,
  orderId: number,
  query: ReadQuery,
): Promise<ClientOrderDetail | null> {
  const [headerRow] = await query<OrderSummaryRow[]>(`
    SELECT
      ${CLIENT_ORDER_PROJECTION_SELECT}
    WHERE p.id_pedido = ?
      AND p.id_cliente = ?
  `, [env.legacyOrderOffset, orderId, clientId]);

  if (!headerRow) {
    return null;
  }

  const lineRows = await query<OrderLineRow[]>(`
    SELECT
      dp.id_detalle_pedido AS detalleId,
      dp.id_producto AS productoId,
      pr.codigo AS codigo,
      pr.nombre AS nombre,
      dp.cantidad AS cantidad,
      dp.precio_unitario AS precioUnitario,
      dp.descuento AS descuento,
      dp.subtotal AS subtotal
    FROM DETALLE_PEDIDO dp
    INNER JOIN PRODUCTO pr
      ON pr.id_producto = dp.id_producto
    WHERE dp.id_pedido = ?
    ORDER BY dp.id_detalle_pedido ASC
  `, [orderId]);

  const items: ClientOrderLine[] = lineRows.map(line => ({
    detalleId: Number(line.detalleId),
    productoId: Number(line.productoId),
    codigo: line.codigo,
    nombre: line.nombre,
    cantidad: Number(line.cantidad),
    precioUnitario: String(line.precioUnitario),
    descuento: String(line.descuento),
    subtotal: String(line.subtotal),
  }));

  return {
    ...mapOrderSummary(headerRow),
    items,
  };
}
