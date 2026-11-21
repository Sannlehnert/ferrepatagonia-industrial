import type { EntityManager } from 'typeorm';
import type { PaymentCurrency, PaymentDocumentState, PaymentFinancialState } from '../dtos/payments/payment.dto';

export interface PaymentDestination {
  id: number;
  accountId: number | null;
  orderId: number | null;
}

export interface PaymentRow {
  id: number;
  clienteId: number;
  cliente: string;
  cuentaCorrienteId: number;
  declaranteUsuarioId: number | null;
  revisorUsuarioId: number | null;
  acreditadorUsuarioId: number | null;
  monto: string;
  montoUsd: string | null;
  moneda: PaymentCurrency | null;
  observaciones: string | null;
  estado: PaymentFinancialState | string;
  estadoDocumental: PaymentDocumentState;
  motivoRevision: string | null;
  evidenciaAcreditacion: string | null;
  fecha: string;
  revisadoEn: string | null;
  acreditadoEn: string | null;
  claveIdempotencia: string | null;
  claveAcreditacion: string | null;
  comprobanteId: string | null;
  comprobanteTipoMime: string | null;
  comprobanteBytes: number | null;
  comprobantePedidoId: number | null;
  comprobanteRevisadoEn: string | null;
  movimientoId: number | null;
  movimientoEstado: string | null;
  movimientoMonto: string | null;
}

export interface PaymentDeclarationInput {
  accountId: number;
  clientId: number;
  userId: number;
  receiptId: string;
  amount: string;
  currency: PaymentCurrency;
  hash: string;
  key: string;
  observations: string | null;
}

const PAYMENT_SELECT = `
  SELECT p.id_pago AS id,
         c.id_cliente AS clienteId, c.nombre_razon_social AS cliente,
         p.id_cuenta_corriente AS cuentaCorrienteId,
         p.id_usuario_declarante AS declaranteUsuarioId,
         p.id_admin_revision AS revisorUsuarioId,
         p.id_admin_acreditacion AS acreditadorUsuarioId,
         p.monto, p.monto_usd AS montoUsd, p.moneda, p.observaciones, p.estado,
         p.estado_documental AS estadoDocumental,
         p.motivo_revision AS motivoRevision,
         p.evidencia_acreditacion AS evidenciaAcreditacion,
         DATE_FORMAT(p.fecha, '%Y-%m-%dT%H:%i:%s.%fZ') AS fecha,
         DATE_FORMAT(p.revision_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS revisadoEn,
         DATE_FORMAT(p.fecha_acreditacion_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS acreditadoEn,
         p.clave_idempotencia AS claveIdempotencia,
         p.clave_acreditacion AS claveAcreditacion,
         p.id_comprobante AS comprobanteId,
         r.tipo_mime AS comprobanteTipoMime, r.bytes AS comprobanteBytes,
         r.id_pedido AS comprobantePedidoId,
         DATE_FORMAT(r.revision_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS comprobanteRevisadoEn,
         m.id_movimiento_cuenta AS movimientoId,
         m.estado AS movimientoEstado, m.monto AS movimientoMonto
  FROM PAGO p
  INNER JOIN CUENTA_CORRIENTE cc ON cc.id_cuenta_corriente = p.id_cuenta_corriente
  INNER JOIN CLIENTE c ON c.id_cliente = cc.id_cliente
  LEFT JOIN COMPROBANTE_PAGO r ON r.id_comprobante = p.id_comprobante
  LEFT JOIN MOVIMIENTO_CUENTA_CORRIENTE m ON m.id_pago = p.id_pago
`;

export async function findAccountIdForUser(manager: EntityManager, userId: number): Promise<number | null> {
  // La actividad del cliente se valida después del lock para poder distinguir
  // CLIENTE_INACTIVO (403) de una cuenta inexistente (404).
  const [row] = await manager.query<{ accountId: number }[]>(`
    SELECT cc.id_cuenta_corriente AS accountId
    FROM USUARIO u
    INNER JOIN CLIENTE c ON c.id_cliente = u.id_cliente
    INNER JOIN CUENTA_CORRIENTE cc ON cc.id_cliente = c.id_cliente
    WHERE u.id_usuario = ? AND u.rol = 'CLIENTE'
  `, [userId]);
  return row?.accountId ?? null;
}

export async function lockAccount(manager: EntityManager, accountId: number) {
  const [row] = await manager.query(`
    SELECT *, DATE_FORMAT(cobertura_desde_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS cobertura_desde_iso
    FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente = ? FOR UPDATE
  `, [accountId]);
  return row ?? null;
}

export async function lockClient(manager: EntityManager, clientId: number) {
  const [row] = await manager.query('SELECT * FROM CLIENTE WHERE id_cliente = ? FOR UPDATE', [clientId]);
  return row ?? null;
}

export async function lockUser(manager: EntityManager, userId: number) {
  const [row] = await manager.query(
    'SELECT id_usuario, id_cliente, rol, activo FROM USUARIO WHERE id_usuario = ? FOR UPDATE',
    [userId],
  );
  return row ?? null;
}

export async function lockReceiptForDeclaration(
  manager: EntityManager, receiptId: string, clientId: number, accountId: number,
) {
  const [row] = await manager.query(`
    SELECT r.id_comprobante, r.id_cliente, r.id_cuenta_corriente, r.id_pedido,
           r.tipo_mime, r.bytes, r.sha256,
           p.id_pedido AS pedido_id, p.id_cliente AS pedido_cliente, p.modalidad_pago
    FROM COMPROBANTE_PAGO r
    LEFT JOIN PEDIDO p ON p.id_pedido = r.id_pedido AND p.id_cliente = r.id_cliente
    WHERE r.id_comprobante = ? AND r.id_cliente = ? AND r.id_cuenta_corriente = ?
    FOR UPDATE
  `, [receiptId, clientId, accountId]);
  if (!row) return null;
  if (row.id_pedido !== null && (row.pedido_id === null || row.modalidad_pago !== 'CUENTA_CORRIENTE')) {
    return null;
  }
  return row;
}

export async function findPaymentByDeclarationKey(
  manager: EntityManager, accountId: number, key: string, lock = false,
) {
  const [row] = await manager.query(`
    SELECT id_pago, huella_declaracion, id_comprobante, estado
    FROM PAGO WHERE id_cuenta_corriente = ? AND clave_idempotencia = ?
    ${lock ? 'FOR UPDATE' : ''}
  `, [accountId, key]);
  return row ?? null;
}

export async function findPaymentByReceipt(manager: EntityManager, receiptId: string) {
  const [row] = await manager.query(`
    SELECT id_pago, huella_declaracion, id_cuenta_corriente, monto, moneda, estado
    FROM PAGO WHERE id_comprobante = ? FOR UPDATE
  `, [receiptId]);
  return row ?? null;
}

export async function findPaymentByAnyKey(
  manager: EntityManager, key: string, excludePaymentId: number,
) {
  const [row] = await manager.query(`
    SELECT id_pago, clave_idempotencia, clave_acreditacion,
           clave_idempotencia_acreditacion, clave_idempotencia_cierre
    FROM PAGO
    WHERE id_pago <> ?
      AND (
        clave_idempotencia = ?
        OR clave_acreditacion = ?
        OR clave_idempotencia_acreditacion = ?
        OR clave_idempotencia_cierre = ?
      )
    LIMIT 1
  `, [excludePaymentId, key, key, key, key]);
  return row ?? null;
}

export async function findPaymentByAccreditationKey(
  manager: EntityManager, accountId: number, key: string,
) {
  const [row] = await manager.query(`
    SELECT id_pago, huella_acreditacion
    FROM PAGO WHERE id_cuenta_corriente = ? AND clave_acreditacion = ? FOR UPDATE
  `, [accountId, key]);
  return row ?? null;
}

export async function insertDeclaration(manager: EntityManager, input: PaymentDeclarationInput): Promise<number> {
  const result = await manager.query(`
    INSERT INTO PAGO (
      id_cuenta_corriente, fecha, monto, metodo_pago, estado, comprobante, observaciones,
      moneda, id_usuario_declarante, clave_idempotencia, huella_declaracion,
      id_comprobante, estado_documental
    ) VALUES (
      ?, UTC_TIMESTAMP(), ?, 'TRANSFERENCIA', 'PENDIENTE', ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE'
    )
  `, [
    input.accountId, input.amount, input.receiptId, input.observations,
    input.currency, input.userId, input.key, input.hash, input.receiptId,
  ]);
  return Number(result.insertId);
}

export async function findPaymentDestination(manager: EntityManager, paymentId: number): Promise<PaymentDestination | null> {
  const [row] = await manager.query(`
    SELECT id_pago AS id, id_cuenta_corriente AS accountId, id_pedido AS orderId
    FROM PAGO WHERE id_pago = ?
  `, [paymentId]);
  return row ?? null;
}

export async function lockPayment(manager: EntityManager, paymentId: number) {
  const [row] = await manager.query(`
    SELECT p.*, DATE_FORMAT(p.fecha, '%Y-%m-%dT%H:%i:%s.%fZ') AS fecha_iso,
           DATE_FORMAT(p.revision_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS revision_iso,
           DATE_FORMAT(p.fecha_acreditacion_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS acreditacion_iso
    FROM PAGO p WHERE p.id_pago = ? FOR UPDATE
  `, [paymentId]);
  return row ?? null;
}

export async function lockPaymentReceipt(manager: EntityManager, paymentId: number) {
  const [row] = await manager.query(`
    SELECT r.id_comprobante, r.id_cliente, r.id_cuenta_corriente, r.id_pedido,
           r.tipo_mime, r.bytes, r.sha256,
           p.id_pedido AS pedido_id, p.id_cliente AS pedido_cliente,
           p.modalidad_pago
    FROM PAGO g
    LEFT JOIN COMPROBANTE_PAGO r ON r.id_comprobante = g.id_comprobante
    LEFT JOIN PEDIDO p ON p.id_pedido = r.id_pedido
    WHERE g.id_pago = ?
    FOR UPDATE
  `, [paymentId]);
  return row ?? null;
}

export async function updatePaymentReview(
  manager: EntityManager,
  input: {
    paymentId: number; financialState: string; documentState: PaymentDocumentState;
    adminId: number; reason: string | null;
  },
) {
  const rejected = input.financialState === 'RECHAZADO';
  const result = await manager.query(`
    UPDATE PAGO SET estado = ?, estado_documental = ?, id_admin_revision = ?,
      revision_utc = UTC_TIMESTAMP(3), motivo_revision = ?,
      motivo_cierre = ?, id_admin_cierre = ?,
      fecha_cierre_utc = CASE WHEN ? THEN UTC_TIMESTAMP(3) ELSE NULL END
    WHERE id_pago = ?
  `, [
    input.financialState, input.documentState, input.adminId,
    rejected ? input.reason : null,
    rejected ? input.reason : null,
    rejected ? input.adminId : null,
    rejected ? 1 : 0,
    input.paymentId,
  ]);
  if (result.affectedRows !== 1) throw new Error('PAGO_REVISION_NO_ACTUALIZADA');
}

export async function updatePaymentAccreditation(
  manager: EntityManager,
  input: {
    paymentId: number; adminId: number; key: string; hash: string; evidence: string;
    montoUsd: string; idCotizacion: number | null; tasaHistorica: string | null;
    accreditedAt: string;
  },
) {
  // Un solo UPDATE deja satisfechos los triggers de #158 antes de que el pago
  // cambie de estado: conversión, cotización, evidencia, actor e idempotencia
  // se persisten atómicamente.
  const result = await manager.query(`
    UPDATE PAGO SET estado = 'ACREDITADO', fecha_acreditacion_utc = ?,
      evidencia_acreditacion = ?, id_admin_acreditacion = ?, id_admin_actor = ?,
      clave_acreditacion = ?, huella_acreditacion = ?,
      clave_idempotencia_acreditacion = ?,
      monto_usd = ?, id_cotizacion = ?, tasa_historica = ?
    WHERE id_pago = ? AND estado = 'PENDIENTE'
  `, [
    input.accreditedAt, input.evidence, input.adminId, input.adminId,
    input.key, input.hash, input.key,
    input.montoUsd, input.idCotizacion, input.tasaHistorica,
    input.paymentId,
  ]);
  if (result.affectedRows !== 1) throw new Error('PAGO_ACREDITACION_NO_ACTUALIZADA');
}

function paymentView(row: PaymentRow, admin: boolean) {
  return {
    id: row.id,
    ...(admin ? {
      clienteId: row.clienteId,
      cliente: row.cliente,
      declaranteUsuarioId: row.declaranteUsuarioId,
      revisadoPorUsuarioId: row.revisorUsuarioId,
      acreditadoPorUsuarioId: row.acreditadorUsuarioId,
      claveIdempotencia: row.claveIdempotencia,
      claveAcreditacion: row.claveAcreditacion,
    } : {}),
    cuentaCorrienteId: row.cuentaCorrienteId,
    comprobanteId: row.comprobanteId,
    comprobanteTipoMime: row.comprobanteTipoMime,
    comprobanteBytes: row.comprobanteBytes,
    comprobanteRevisadoEn: row.comprobanteRevisadoEn,
    pedidoId: row.comprobantePedidoId,
    monto: row.monto,
    montoUsd: row.montoUsd,
    moneda: row.moneda,
    observaciones: row.observaciones,
    estado: row.estado,
    estadoDocumental: row.estadoDocumental,
    motivoRevision: row.motivoRevision,
    evidenciaAcreditacion: row.evidenciaAcreditacion,
    fecha: isoDate(row.fecha),
    revisadoEn: isoDate(row.revisadoEn),
    acreditadoEn: isoDate(row.acreditadoEn),
    movimientoId: row.movimientoId,
    movimientoEstado: row.movimientoEstado,
    movimientoMonto: row.movimientoMonto,
  };
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  return value.includes('T') ? value : value.replace(' ', 'T').replace(/Z?$/, 'Z');
}

export async function findPayment(
  manager: EntityManager, paymentId: number, clientId: number | null,
): Promise<PaymentRow | null> {
  const [row] = await manager.query<PaymentRow[]>(`
    ${PAYMENT_SELECT}
    WHERE p.id_pedido IS NULL AND p.id_cuenta_corriente IS NOT NULL
      AND p.estado <> 'DEMO_REGISTRADO'
      AND cc.origen_datos <> 'DEMO'
      AND NOT EXISTS (
        SELECT 1 FROM MOVIMIENTO_CUENTA_CORRIENTE m
        WHERE m.id_cuenta_corriente = cc.id_cuenta_corriente
          AND UPPER(TRIM(m.origen)) = 'DEMO'
      )
      ${clientId === null ? '' : 'AND c.id_cliente = ?'}
      AND p.id_pago = ?
  `, clientId === null ? [paymentId] : [clientId, paymentId]);
  return row ?? null;
}

export async function listPayments(
  manager: EntityManager, clientId: number | null, page: number,
) {
  const pageSize = 50;
  const rows = await manager.query<PaymentRow[]>(`
    ${PAYMENT_SELECT}
    WHERE p.id_pedido IS NULL AND p.id_cuenta_corriente IS NOT NULL
      AND p.estado <> 'DEMO_REGISTRADO'
      AND cc.origen_datos <> 'DEMO'
      AND NOT EXISTS (
        SELECT 1 FROM MOVIMIENTO_CUENTA_CORRIENTE m
        WHERE m.id_cuenta_corriente = cc.id_cuenta_corriente
          AND UPPER(TRIM(m.origen)) = 'DEMO'
      )
      ${clientId === null ? '' : 'AND c.id_cliente = ?'}
    ORDER BY p.fecha DESC, p.id_pago DESC
    LIMIT ? OFFSET ?
  `, clientId === null
    ? [pageSize + 1, (page - 1) * pageSize]
    : [clientId, pageSize + 1, (page - 1) * pageSize]);
  return {
    items: rows.slice(0, pageSize).map(row => paymentView(row, clientId === null)),
    paginaSiguiente: rows.length > pageSize ? page + 1 : null,
  };
}

export async function paymentDto(
  manager: EntityManager, paymentId: number, clientId: number | null,
) {
  const row = await findPayment(manager, paymentId, clientId);
  return row ? paymentView(row, clientId === null) : null;
}
