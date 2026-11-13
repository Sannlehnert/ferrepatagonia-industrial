import { dataSource, inTransaction } from '../config/database.config';
import { hasDatabaseError } from '../services/cart.errors';
import { ReceiptError, type ReceiptMime } from '../services/receipts/receipt-types';

export type ClientReceiptScope = { orderId: number } | { account: true };
export type ReceiptScope = ClientReceiptScope | { admin: true };
export type Destination = { clientId: number; orderId: number | null; accountId: number | null };
type ReceiptRow = {
  id: string;
  clienteId: number;
  cliente: string;
  pedidoId: number | null;
  cuentaCorrienteId: number | null;
  tipoMime: ReceiptMime;
  bytes: number;
  fecha: string;
  revisadoEn: string | null;
};

const owner = `
  FROM USUARIO u
  INNER JOIN CLIENTE c ON c.id_cliente = u.id_cliente AND c.activo = 1
  WHERE u.id_usuario = ? AND u.activo = 1 AND u.rol = 'CLIENTE'
`;

function destinationQuery(scope: ClientReceiptScope, userId: number, reference: number | null) {
  if ('orderId' in scope) {
    return {
      sql: `
        SELECT c.id_cliente AS clientId, p.id_pedido AS orderId,
               cc.id_cuenta_corriente AS accountId
        FROM USUARIO u
        INNER JOIN CLIENTE c ON c.id_cliente = u.id_cliente AND c.activo = 1
        INNER JOIN PEDIDO p ON p.id_cliente = c.id_cliente
        LEFT JOIN CUENTA_CORRIENTE cc ON cc.id_cliente = c.id_cliente AND c.tipo_cliente = 'EMPRESA'
        WHERE u.id_usuario = ? AND u.activo = 1 AND u.rol = 'CLIENTE' AND p.id_pedido = ?
          AND ((c.tipo_cliente = 'PARTICULAR' AND p.modalidad_pago = 'TRANSFERENCIA')
            OR (cc.id_cuenta_corriente IS NOT NULL AND p.modalidad_pago = 'CUENTA_CORRIENTE'))
      `,
      params: [userId, scope.orderId],
    };
  }
  return {
    sql: `
      SELECT c.id_cliente AS clientId, p.id_pedido AS orderId, cc.id_cuenta_corriente AS accountId
      FROM USUARIO u
      INNER JOIN CLIENTE c ON c.id_cliente = u.id_cliente AND c.activo = 1 AND c.tipo_cliente = 'EMPRESA'
      INNER JOIN CUENTA_CORRIENTE cc ON cc.id_cliente = c.id_cliente
      LEFT JOIN PEDIDO p ON p.id_cliente = c.id_cliente AND p.id_pedido = ? AND p.modalidad_pago = 'CUENTA_CORRIENTE'
      WHERE u.id_usuario = ? AND u.activo = 1 AND u.rol = 'CLIENTE'
        AND (? IS NULL OR p.id_pedido IS NOT NULL)
    `,
    params: [reference, userId, reference],
  };
}

const missingDestination = () => new ReceiptError(
  404, 'OPERACION_NO_ENCONTRADA', 'No se encontró una operación habilitada para comprobantes.',
);

export async function getReceiptDestination(scope: ClientReceiptScope, userId: number, reference: number | null = null) {
  const { sql, params } = destinationQuery(scope, userId, reference);
  const [row] = await dataSource.query<Destination[]>(sql, params);
  if (!row) throw missingDestination();
  return row;
}

const base = `
  SELECT r.id_comprobante AS id, r.id_cliente AS clienteId, c.nombre_razon_social AS cliente,
         r.id_pedido AS pedidoId, r.id_cuenta_corriente AS cuentaCorrienteId,
         r.tipo_mime AS tipoMime, r.bytes AS bytes, CAST(r.fecha_utc AS CHAR) AS fecha,
         CAST(r.revision_utc AS CHAR) AS revisadoEn
  FROM COMPROBANTE_PAGO r
  INNER JOIN CLIENTE c ON c.id_cliente = r.id_cliente
  LEFT JOIN PEDIDO p ON p.id_pedido = r.id_pedido AND p.id_cliente = r.id_cliente
  LEFT JOIN CUENTA_CORRIENTE cc ON cc.id_cuenta_corriente = r.id_cuenta_corriente AND cc.id_cliente = r.id_cliente
  WHERE (r.id_pedido IS NULL OR p.id_pedido IS NOT NULL)
    AND (r.id_cuenta_corriente IS NULL OR cc.id_cuenta_corriente IS NOT NULL)
`;

function scopePredicate(scope: ReceiptScope, userId: number) {
  if ('admin' in scope) return { sql: '', params: [] };
  const destination = 'orderId' in scope
    ? { sql: 'AND r.id_pedido = ?', params: [scope.orderId] }
    : { sql: 'AND r.id_cuenta_corriente IS NOT NULL', params: [] };
  return {
    sql: `AND r.id_cliente IN (SELECT c.id_cliente ${owner}) ${destination.sql}`,
    params: [userId, ...destination.params],
  };
}

function dto(row: ReceiptRow, isAdmin: boolean) {
  return {
    id: row.id,
    ...(isAdmin ? { clienteId: row.clienteId, cliente: row.cliente } : {}),
    pedidoId: row.pedidoId,
    cuentaCorrienteId: row.cuentaCorrienteId,
    tipoMime: row.tipoMime,
    bytes: row.bytes,
    fecha: new Date(row.fecha.replace(' ', 'T') + 'Z').toISOString(),
    estadoRevision: row.revisadoEn ? 'REVISADO' : 'PENDIENTE',
    revisadoEn: row.revisadoEn ? new Date(row.revisadoEn.replace(' ', 'T') + 'Z').toISOString() : null,
  };
}

export async function listReceipts(scope: ReceiptScope, userId: number, page: number) {
  const { sql, params } = scopePredicate(scope, userId);
  const pageSize = 50;
  const rows = await dataSource.query<ReceiptRow[]>(`
    ${base} ${sql}
    ORDER BY r.fecha_utc DESC, r.id_comprobante DESC LIMIT ? OFFSET ?
  `, [...params, pageSize + 1, (page - 1) * pageSize]);
  return {
    items: rows.slice(0, pageSize).map(row => dto(row, 'admin' in scope)),
    paginaSiguiente: rows.length > pageSize ? page + 1 : null,
  };
}

export async function findReceipt(scope: ReceiptScope, userId: number, id: string) {
  const { sql, params } = scopePredicate(scope, userId);
  const [row] = await dataSource.query<ReceiptRow[]>(`
    ${base} ${sql} AND r.id_comprobante = ?
  `, [...params, id]);
  return row ? dto(row, 'admin' in scope) : null;
}

export async function insertReceipt(
  scope: ClientReceiptScope, userId: number, reference: number | null,
  file: { id: string; mime: ReceiptMime; bytes: number; hash: Buffer },
): Promise<string> {
  const { sql, params } = destinationQuery(scope, userId, reference);
  try {
    await inTransaction(async manager => {
      const result = await manager.query(`
        INSERT INTO COMPROBANTE_PAGO (
          id_comprobante, id_cliente, id_usuario_carga, id_pedido, id_cuenta_corriente,
          tipo_mime, bytes, sha256, fecha_utc
        )
        SELECT ?, dest.clientId, ?, dest.orderId, dest.accountId, ?, ?, ?, UTC_TIMESTAMP(3)
        FROM (${sql}) dest
      `, [file.id, userId, file.mime, file.bytes, file.hash, ...params]);
      if (result.affectedRows !== 1) throw missingDestination();
    });
    return file.id;
  } catch (error) {
    if (!hasDatabaseError(error, 'ER_DUP_ENTRY', 1062)) throw error;
    const [duplicate] = await dataSource.query<{ id: string }[]>(`
      SELECT r.id_comprobante AS id
      FROM COMPROBANTE_PAGO r
      INNER JOIN (${sql}) dest
        ON dest.clientId = r.id_cliente AND dest.orderId <=> r.id_pedido
        AND dest.accountId <=> r.id_cuenta_corriente
      WHERE r.sha256 = ?
    `, [...params, file.hash]);
    if (!duplicate) throw error;
    return duplicate.id;
  }
}

export async function reviewReceipt(userId: number, id: string) {
  await dataSource.query(`
    UPDATE COMPROBANTE_PAGO r
    INNER JOIN USUARIO u ON u.id_usuario = ? AND u.rol = 'ADMIN' AND u.activo = 1
    SET r.id_admin_revision = u.id_usuario, r.revision_utc = UTC_TIMESTAMP(3)
    WHERE r.id_comprobante = ? AND r.revision_utc IS NULL
  `, [userId, id]);
  return findReceipt({ admin: true }, userId, id);
}
