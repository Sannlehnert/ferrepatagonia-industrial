import type { EntityManager } from 'typeorm';
import type { AdminPaymentListQuery } from '../dtos/payments/admin-payment.dto';

export interface AdminPaymentRow {
  id_pago: number;
  id_pedido: number | null;
  id_cuenta_corriente: number | null;
  id_cliente: number;
  fecha_iso: string;
  monto: string;
  moneda: 'USD' | 'ARS' | null;
  monto_usd: string | null;
  id_cotizacion: number | null;
  tasa_historica: string | null;
  metodo_pago: string;
  estado: string;
  evidencia_acreditacion: string | null;
  fecha_acreditacion_iso: string | null;
  comprobante: string | null;
  observaciones: string | null;
  clave_idempotencia: string | null;
  clave_idempotencia_acreditacion: string | null;
  clave_idempotencia_cierre: string | null;
  motivo_cierre: string | null;
  id_admin_actor: number | null;
  id_admin_cierre: number | null;
  fecha_cierre_iso: string | null;
  abono_movimiento_id: number | null;
}

export interface PaymentDestinationProbe {
  id_pago: number;
  id_pedido: number | null;
  id_cuenta_corriente: number | null;
}

export interface LockedPaymentAccountRow {
  id_cuenta_corriente: number;
  id_cliente: number;
  cobertura: string;
  origen_datos: 'REAL' | 'DEMO';
  revision: string;
}

export interface LockedPaymentClientRow {
  id_cliente: number;
  tipo_cliente: 'PARTICULAR' | 'EMPRESA';
  activo: number;
}

export interface LockedPaymentOrderRow {
  id_pedido: number;
  id_cliente: number;
  estado: string;
  modalidad_pago: string;
  moneda_total: string | null;
  evidencia_total_usd: string | null;
  total: string;
}

export interface AdminActorRow {
  id_usuario: number;
  rol: string;
  activo: number;
}

export type PaymentIdempotencyOperation = 'CREAR' | 'ACREDITAR' | 'RECHAZAR' | 'ANULAR';

export interface PaymentIdempotencyRow {
  clave_idempotencia: string;
  id_pago: number;
  operacion: PaymentIdempotencyOperation;
  payload_hash: string;
}

export function utcSql(date: Date): string {
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

const PAYMENT_SELECT = `
  SELECT
    g.id_pago,
    g.id_pedido,
    g.id_cuenta_corriente,
    COALESCE(p.id_cliente, cc.id_cliente) AS id_cliente,
    DATE_FORMAT(g.fecha, '%Y-%m-%dT%H:%i:%s.000Z') AS fecha_iso,
    g.monto,
    g.moneda,
    g.monto_usd,
    g.id_cotizacion,
    g.tasa_historica,
    g.metodo_pago,
    g.estado,
    g.evidencia_acreditacion,
    DATE_FORMAT(g.fecha_acreditacion_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS fecha_acreditacion_iso,
    g.comprobante,
    g.observaciones,
    g.clave_idempotencia,
    g.clave_idempotencia_acreditacion,
    g.clave_idempotencia_cierre,
    g.motivo_cierre,
    g.id_admin_actor,
    g.id_admin_cierre,
    DATE_FORMAT(g.fecha_cierre_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS fecha_cierre_iso,
    m.id_movimiento_cuenta AS abono_movimiento_id
  FROM PAGO g
  LEFT JOIN PEDIDO p ON p.id_pedido = g.id_pedido
  LEFT JOIN CUENTA_CORRIENTE cc ON cc.id_cuenta_corriente = g.id_cuenta_corriente
  LEFT JOIN MOVIMIENTO_CUENTA_CORRIENTE m
    ON m.id_pago = g.id_pago AND m.tipo_movimiento = 'ABONO'
`;

function mapRow(raw: Record<string, unknown>): AdminPaymentRow {
  return {
    id_pago: Number(raw.id_pago),
    id_pedido: raw.id_pedido !== null && raw.id_pedido !== undefined ? Number(raw.id_pedido) : null,
    id_cuenta_corriente:
      raw.id_cuenta_corriente !== null && raw.id_cuenta_corriente !== undefined
        ? Number(raw.id_cuenta_corriente)
        : null,
    id_cliente: Number(raw.id_cliente),
    fecha_iso: String(raw.fecha_iso),
    monto: String(raw.monto),
    moneda: raw.moneda ? (String(raw.moneda) as 'USD' | 'ARS') : null,
    monto_usd: raw.monto_usd !== null && raw.monto_usd !== undefined ? String(raw.monto_usd) : null,
    id_cotizacion:
      raw.id_cotizacion !== null && raw.id_cotizacion !== undefined
        ? Number(raw.id_cotizacion)
        : null,
    tasa_historica:
      raw.tasa_historica !== null && raw.tasa_historica !== undefined
        ? String(raw.tasa_historica)
        : null,
    metodo_pago: String(raw.metodo_pago),
    estado: String(raw.estado),
    evidencia_acreditacion:
      raw.evidencia_acreditacion !== null && raw.evidencia_acreditacion !== undefined
        ? String(raw.evidencia_acreditacion)
        : null,
    fecha_acreditacion_iso:
      raw.fecha_acreditacion_iso !== null && raw.fecha_acreditacion_iso !== undefined
        ? new Date(String(raw.fecha_acreditacion_iso)).toISOString()
        : null,
    comprobante: raw.comprobante !== null && raw.comprobante !== undefined ? String(raw.comprobante) : null,
    observaciones: raw.observaciones !== null && raw.observaciones !== undefined ? String(raw.observaciones) : null,
    clave_idempotencia:
      raw.clave_idempotencia !== null && raw.clave_idempotencia !== undefined
        ? String(raw.clave_idempotencia)
        : null,
    clave_idempotencia_acreditacion:
      raw.clave_idempotencia_acreditacion !== null && raw.clave_idempotencia_acreditacion !== undefined
        ? String(raw.clave_idempotencia_acreditacion)
        : null,
    clave_idempotencia_cierre:
      raw.clave_idempotencia_cierre !== null && raw.clave_idempotencia_cierre !== undefined
        ? String(raw.clave_idempotencia_cierre)
        : null,
    motivo_cierre:
      raw.motivo_cierre !== null && raw.motivo_cierre !== undefined
        ? String(raw.motivo_cierre)
        : null,
    id_admin_actor:
      raw.id_admin_actor !== null && raw.id_admin_actor !== undefined
        ? Number(raw.id_admin_actor)
        : null,
    id_admin_cierre:
      raw.id_admin_cierre !== null && raw.id_admin_cierre !== undefined
        ? Number(raw.id_admin_cierre)
        : null,
    fecha_cierre_iso:
      raw.fecha_cierre_iso !== null && raw.fecha_cierre_iso !== undefined
        ? new Date(String(raw.fecha_cierre_iso)).toISOString()
        : null,
    abono_movimiento_id:
      raw.abono_movimiento_id !== null && raw.abono_movimiento_id !== undefined
        ? Number(raw.abono_movimiento_id)
        : null,
  };
}

export async function probePaymentDestination(
  manager: EntityManager,
  pagoId: number,
): Promise<PaymentDestinationProbe | null> {
  // §10.3 Paso previo sin lock: identifica el agregado raiz antes de tomar bloqueos de escritura.
  const [row] = await manager.query<Array<Record<string, unknown>>>(
    'SELECT id_pago, id_pedido, id_cuenta_corriente FROM PAGO WHERE id_pago = ? LIMIT 1',
    [pagoId],
  );
  if (!row) return null;
  return {
    id_pago: Number(row.id_pago),
    id_pedido: row.id_pedido !== null && row.id_pedido !== undefined ? Number(row.id_pedido) : null,
    id_cuenta_corriente:
      row.id_cuenta_corriente !== null && row.id_cuenta_corriente !== undefined
        ? Number(row.id_cuenta_corriente)
        : null,
  };
}

export async function lockAccountById(
  manager: EntityManager,
  accountId: number,
): Promise<LockedPaymentAccountRow | null> {
  const [row] = await manager.query<Array<Record<string, unknown>>>(
    `SELECT id_cuenta_corriente, id_cliente, cobertura, origen_datos, CAST(revision AS CHAR) AS revision
     FROM CUENTA_CORRIENTE
     WHERE id_cuenta_corriente = ?
     FOR UPDATE`,
    [accountId],
  );
  if (!row) return null;
  return {
    id_cuenta_corriente: Number(row.id_cuenta_corriente),
    id_cliente: Number(row.id_cliente),
    cobertura: String(row.cobertura),
    origen_datos: String(row.origen_datos) as 'REAL' | 'DEMO',
    revision: String(row.revision),
  };
}

export async function lockClientById(
  manager: EntityManager,
  clientId: number,
): Promise<LockedPaymentClientRow | null> {
  const [row] = await manager.query<Array<Record<string, unknown>>>(
    'SELECT id_cliente, tipo_cliente, activo FROM CLIENTE WHERE id_cliente = ? FOR UPDATE',
    [clientId],
  );
  if (!row) return null;
  return {
    id_cliente: Number(row.id_cliente),
    tipo_cliente: String(row.tipo_cliente) as 'PARTICULAR' | 'EMPRESA',
    activo: Number(row.activo),
  };
}

export async function lockOrderById(
  manager: EntityManager,
  orderId: number,
): Promise<LockedPaymentOrderRow | null> {
  const [row] = await manager.query<Array<Record<string, unknown>>>(
    `SELECT id_pedido, id_cliente, estado, modalidad_pago, moneda_total, evidencia_total_usd, total
     FROM PEDIDO
     WHERE id_pedido = ?
     FOR UPDATE`,
    [orderId],
  );
  if (!row) return null;
  return {
    id_pedido: Number(row.id_pedido),
    id_cliente: Number(row.id_cliente),
    estado: String(row.estado),
    modalidad_pago: String(row.modalidad_pago),
    moneda_total: row.moneda_total !== null && row.moneda_total !== undefined ? String(row.moneda_total) : null,
    evidencia_total_usd:
      row.evidencia_total_usd !== null && row.evidencia_total_usd !== undefined
        ? String(row.evidencia_total_usd)
        : null,
    total: String(row.total),
  };
}

export async function readAdminActor(
  manager: EntityManager,
  userId: number,
  lock: boolean,
): Promise<AdminActorRow | null> {
  const [row] = await manager.query<Array<Record<string, unknown>>>(
    `SELECT id_usuario, rol, activo FROM USUARIO WHERE id_usuario = ?${lock ? ' LOCK IN SHARE MODE' : ''}`,
    [userId],
  );
  if (!row) return null;
  return {
    id_usuario: Number(row.id_usuario),
    rol: String(row.rol),
    activo: Number(row.activo),
  };
}

export async function lockPaymentById(
  manager: EntityManager,
  pagoId: number,
  clientId: number,
): Promise<AdminPaymentRow | null> {
  const [row] = await manager.query<Array<Record<string, unknown>>>(
    `SELECT
       id_pago,
       id_pedido,
       id_cuenta_corriente,
       DATE_FORMAT(fecha, '%Y-%m-%dT%H:%i:%s.000Z') AS fecha_iso,
       monto,
       moneda,
       monto_usd,
       id_cotizacion,
       tasa_historica,
       metodo_pago,
       estado,
       evidencia_acreditacion,
       DATE_FORMAT(fecha_acreditacion_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS fecha_acreditacion_iso,
       comprobante,
       observaciones,
       clave_idempotencia,
       clave_idempotencia_acreditacion,
       clave_idempotencia_cierre,
       motivo_cierre,
       id_admin_actor,
       id_admin_cierre,
       DATE_FORMAT(fecha_cierre_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS fecha_cierre_iso
     FROM PAGO
     WHERE id_pago = ?
     FOR UPDATE`,
    [pagoId],
  );
  if (!row) return null;
  return mapRow({ ...row, id_cliente: clientId, abono_movimiento_id: null });
}

export async function findPaymentByAnyKey(
  manager: EntityManager,
  key: string,
): Promise<AdminPaymentRow | null> {
  const [row] = await manager.query<Array<Record<string, unknown>>>(
    `${PAYMENT_SELECT}
     WHERE g.clave_idempotencia = ?
        OR g.clave_idempotencia_acreditacion = ?
        OR g.clave_idempotencia_cierre = ?
     LIMIT 1`,
    [key, key, key],
  );
  return row ? mapRow(row) : null;
}

export async function findPaymentIdempotency(
  manager: EntityManager,
  key: string,
): Promise<PaymentIdempotencyRow | null> {
  const [row] = await manager.query<Array<Record<string, unknown>>>(
    `SELECT clave_idempotencia, id_pago, operacion, payload_hash
     FROM PAGO_IDEMPOTENCIA
     WHERE clave_idempotencia = ?
     LIMIT 1`,
    [key],
  );
  if (!row) return null;
  return {
    clave_idempotencia: String(row.clave_idempotencia),
    id_pago: Number(row.id_pago),
    operacion: String(row.operacion) as PaymentIdempotencyOperation,
    payload_hash: String(row.payload_hash),
  };
}

export async function insertPaymentIdempotency(
  manager: EntityManager,
  values: {
    claveIdempotencia: string;
    pagoId: number;
    operacion: PaymentIdempotencyOperation;
    payloadHash: string;
  },
): Promise<void> {
  await manager.query(
    `INSERT INTO PAGO_IDEMPOTENCIA (
       clave_idempotencia, id_pago, operacion, payload_hash, creado_en_utc
     ) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [
      values.claveIdempotencia,
      values.pagoId,
      values.operacion,
      values.payloadHash,
    ],
  );
}

export async function findPaymentById(
  manager: EntityManager,
  pagoId: number,
): Promise<AdminPaymentRow | null> {
  const [row] = await manager.query<Array<Record<string, unknown>>>(
    `${PAYMENT_SELECT} WHERE g.id_pago = ? LIMIT 1`,
    [pagoId],
  );
  return row ? mapRow(row) : null;
}

export async function listPayments(
  manager: EntityManager,
  query: AdminPaymentListQuery,
): Promise<AdminPaymentRow[]> {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (query.antesDeId !== undefined) {
    conditions.push('g.id_pago < ?');
    params.push(query.antesDeId);
  }
  if (query.estado !== undefined) {
    conditions.push('g.estado = ?');
    params.push(query.estado);
  }
  if (query.pedidoId !== undefined) {
    conditions.push('g.id_pedido = ?');
    params.push(query.pedidoId);
  }
  if (query.cuentaCorrienteId !== undefined) {
    conditions.push('g.id_cuenta_corriente = ?');
    params.push(query.cuentaCorrienteId);
  }
  if (query.clienteId !== undefined) {
    conditions.push('COALESCE(p.id_cliente, cc.id_cliente) = ?');
    params.push(query.clienteId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await manager.query<Array<Record<string, unknown>>>(
    `${PAYMENT_SELECT} ${where} ORDER BY g.id_pago DESC LIMIT ?`,
    [...params, query.limite + 1],
  );
  return rows.map(mapRow);
}

export async function insertPayment(
  manager: EntityManager,
  values: {
    pedidoId: number | null;
    cuentaCorrienteId: number | null;
    monto: string;
    moneda: 'USD' | 'ARS';
    montoUsd: string | null;
    idCotizacion: number | null;
    tasaHistorica: string | null;
    metodoPago: string;
    estado: 'PENDIENTE' | 'ACREDITADO';
    evidenciaAcreditacion: string | null;
    fechaAcreditacionUtc: string | null;
    comprobante: string | null;
    observaciones: string | null;
    claveIdempotencia: string;
    adminId: number;
  },
): Promise<number> {
  const result = await manager.query<{ insertId?: number | string }>(
    `INSERT INTO PAGO (
       id_pedido, id_cuenta_corriente, monto, moneda, monto_usd,
       id_cotizacion, tasa_historica, metodo_pago, estado,
       evidencia_acreditacion, fecha_acreditacion_utc, comprobante, observaciones,
       clave_idempotencia, id_admin_actor
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.pedidoId,
      values.cuentaCorrienteId,
      values.monto,
      values.moneda,
      values.montoUsd,
      values.idCotizacion,
      values.tasaHistorica,
      values.metodoPago,
      values.estado,
      values.evidenciaAcreditacion,
      values.fechaAcreditacionUtc,
      values.comprobante,
      values.observaciones,
      values.claveIdempotencia,
      values.adminId,
    ],
  );
  return Number(result.insertId);
}

export async function markPaymentAccredited(
  manager: EntityManager,
  values: {
    pagoId: number;
    montoUsd: string;
    idCotizacion: number | null;
    tasaHistorica: string | null;
    evidenciaAcreditacion: string;
    fechaAcreditacionUtc: string;
    observaciones: string | null | undefined;
    claveIdempotenciaAcreditacion: string;
    adminId: number;
  },
): Promise<number> {
  const result = await manager.query<{ affectedRows?: number }>(
    `UPDATE PAGO
     SET estado = 'ACREDITADO',
         monto_usd = ?,
         id_cotizacion = ?,
         tasa_historica = ?,
         evidencia_acreditacion = ?,
         fecha_acreditacion_utc = ?,
         observaciones = CASE WHEN ? IS NOT NULL THEN ? ELSE observaciones END,
         clave_idempotencia_acreditacion = ?,
         id_admin_actor = ?
     WHERE id_pago = ?
       AND estado = 'PENDIENTE'`,
    [
      values.montoUsd,
      values.idCotizacion,
      values.tasaHistorica,
      values.evidenciaAcreditacion,
      values.fechaAcreditacionUtc,
      values.observaciones ?? null,
      values.observaciones ?? null,
      values.claveIdempotenciaAcreditacion,
      values.adminId,
      values.pagoId,
    ],
  );
  return Number(result?.affectedRows ?? 0);
}

export async function markPaymentClosed(
  manager: EntityManager,
  values: {
    pagoId: number;
    fromState: 'PENDIENTE' | 'ACREDITADO';
    toState: 'RECHAZADO' | 'ANULADO';
    motivo: string;
    claveIdempotenciaCierre: string;
    adminId: number;
    fechaCierreUtc: string;
  },
): Promise<number> {
  const result = await manager.query<{ affectedRows?: number }>(
    `UPDATE PAGO
     SET estado = ?,
         motivo_cierre = ?,
         id_admin_cierre = ?,
         fecha_cierre_utc = ?,
         clave_idempotencia_cierre = ?
     WHERE id_pago = ?
       AND estado = ?`,
    [
      values.toState,
      values.motivo,
      values.adminId,
      values.fechaCierreUtc,
      values.claveIdempotenciaCierre,
      values.pagoId,
      values.fromState,
    ],
  );
  return Number(result?.affectedRows ?? 0);
}

export async function findLinkedAccountAbonoForUpdate(
  manager: EntityManager,
  accountId: number,
  pagoId: number,
): Promise<{ id_movimiento_cuenta: number; estado: string } | null> {
  // Mantiene orden ascendente de id_movimiento_cuenta dentro del bloqueo de CUENTA_CORRIENTE (§10.3).
  const [row] = await manager.query<Array<{ id_movimiento_cuenta: number; estado: string }>>(
    `SELECT id_movimiento_cuenta, estado
     FROM MOVIMIENTO_CUENTA_CORRIENTE
     WHERE id_cuenta_corriente = ?
       AND id_pago = ?
       AND tipo_movimiento = 'ABONO'
     ORDER BY id_movimiento_cuenta ASC
     FOR UPDATE`,
    [accountId, pagoId],
  );
  if (!row) return null;
  return {
    id_movimiento_cuenta: Number(row.id_movimiento_cuenta),
    estado: String(row.estado),
  };
}

export async function readCurrentAccountRevision(
  manager: EntityManager,
  accountId: number,
): Promise<string | null> {
  const [row] = await manager.query<Array<{ revision: string }>>(
    'SELECT CAST(revision AS CHAR) AS revision FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?',
    [accountId],
  );
  return row ? String(row.revision) : null;
}
