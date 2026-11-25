import type { EntityManager } from 'typeorm';
import { dataSource, inTransaction } from '../config/database.config';
import { hasDatabaseError } from '../services/cart.errors';
import {
  ReceiptError,
  receiptNotFound,
  type ReceiptMime,
  type ReceiptReviewInput,
  type ReceiptReviewState,
} from '../services/receipts/receipt-types';

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
  estadoRevision: ReceiptReviewState;
  revisadoEn: string | null;
  motivoRechazo: string | null;
};

type LockedReceiptRow = {
  id_comprobante: string;
  id_cliente: number;
  id_pedido: number | null;
  id_cuenta_corriente: number | null;
  estado_revision: ReceiptReviewState;
  id_admin_revision: number | null;
  revision_utc: string | null;
  motivo_rechazo: string | null;
  clave_idempotencia_revision: string | null;
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
               CASE WHEN p.modalidad_pago = 'CUENTA_CORRIENTE' THEN cc.id_cuenta_corriente ELSE NULL END AS accountId
        FROM USUARIO u
        INNER JOIN CLIENTE c ON c.id_cliente = u.id_cliente AND c.activo = 1
        INNER JOIN PEDIDO p ON p.id_cliente = c.id_cliente
        LEFT JOIN CUENTA_CORRIENTE cc ON cc.id_cliente = c.id_cliente AND c.tipo_cliente = 'EMPRESA'
        WHERE u.id_usuario = ? AND u.activo = 1 AND u.rol = 'CLIENTE' AND p.id_pedido = ?
          AND ((
            p.modalidad_pago = 'TRANSFERENCIA'
            AND (
              c.tipo_cliente = 'PARTICULAR'
              OR (c.tipo_cliente = 'EMPRESA' AND c.estado_aprobacion_empresa = 'APROBADA')
            )
          ) OR (
            cc.id_cuenta_corriente IS NOT NULL AND p.modalidad_pago = 'CUENTA_CORRIENTE'
          ))
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
         r.estado_revision AS estadoRevision,
         CAST(r.revision_utc AS CHAR) AS revisadoEn,
         r.motivo_rechazo AS motivoRechazo
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

export interface ReceiptDto {
  id: string;
  clienteId?: number;
  cliente?: string;
  pedidoId: number | null;
  cuentaCorrienteId: number | null;
  tipoMime: ReceiptMime;
  bytes: number;
  fecha: string;
  estadoRevision: ReceiptReviewState;
  revisadoEn: string | null;
  motivoRechazo: string | null;
}

function dto(row: ReceiptRow, isAdmin: boolean): ReceiptDto {
  return {
    id: row.id,
    ...(isAdmin ? { clienteId: Number(row.clienteId), cliente: row.cliente } : {}),
    pedidoId: row.pedidoId !== null && row.pedidoId !== undefined ? Number(row.pedidoId) : null,
    cuentaCorrienteId: row.cuentaCorrienteId !== null && row.cuentaCorrienteId !== undefined
      ? Number(row.cuentaCorrienteId)
      : null,
    tipoMime: row.tipoMime,
    bytes: Number(row.bytes),
    fecha: new Date(row.fecha.replace(' ', 'T') + 'Z').toISOString(),
    estadoRevision: row.estadoRevision,
    revisadoEn: row.revisadoEn ? new Date(row.revisadoEn.replace(' ', 'T') + 'Z').toISOString() : null,
    motivoRechazo: row.motivoRechazo ?? null,
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

export async function findReceipt(
  scope: ReceiptScope,
  userId: number,
  id: string,
  manager?: EntityManager,
): Promise<ReceiptDto | null> {
  const executor = manager ?? dataSource;
  const { sql, params } = scopePredicate(scope, userId);
  const [row] = await executor.query<ReceiptRow[]>(`
    ${base} ${sql} AND r.id_comprobante = ?
  `, [...params, id]);
  return row ? dto(row, 'admin' in scope) : null;
}

export interface InsertReceiptResult {
  id: string;
  created: boolean;
  clientId: number;
}

export async function insertReceipt(
  scope: ClientReceiptScope, userId: number, reference: number | null,
  file: { id: string; mime: ReceiptMime; bytes: number; hash: Buffer },
): Promise<InsertReceiptResult> {
  const { sql, params } = destinationQuery(scope, userId, reference);
  try {
    const clientId = await inTransaction(async manager => {
      // TOCTOU-02: revalidar USUARIO.activo, USUARIO.rol y CLIENTE.activo dentro de la transacción.
      const [actor] = await manager.query<Array<{ id_cliente: number | null; rol: string; activo: number | boolean }>>(
        'SELECT id_cliente, rol, activo FROM USUARIO WHERE id_usuario = ? LOCK IN SHARE MODE',
        [userId],
      );
      if (!actor || Number(actor.activo) !== 1) {
        throw new ReceiptError(401, 'NO_AUTENTICADO', 'No autenticado.');
      }
      if (actor.rol !== 'CLIENTE' || !actor.id_cliente) {
        throw new ReceiptError(403, 'SIN_PERMISO', 'El rol autenticado no tiene permiso.');
      }
      const [clientRow] = await manager.query<Array<{ activo: number | boolean }>>(
        'SELECT activo FROM CLIENTE WHERE id_cliente = ? LOCK IN SHARE MODE',
        [actor.id_cliente],
      );
      if (!clientRow || Number(clientRow.activo) !== 1) {
        throw new ReceiptError(403, 'CLIENTE_INACTIVO', 'La cuenta de cliente no está activa.');
      }

      const result = await manager.query(`
        INSERT INTO COMPROBANTE_PAGO (
          id_comprobante, id_cliente, id_usuario_carga, id_pedido, id_cuenta_corriente,
          tipo_mime, bytes, sha256, fecha_utc, estado_revision
        )
        SELECT ?, dest.clientId, ?, dest.orderId, dest.accountId, ?, ?, ?, UTC_TIMESTAMP(3), 'PENDIENTE'
        FROM (${sql}) dest
      `, [file.id, userId, file.mime, file.bytes, file.hash, ...params]);
      if (result.affectedRows !== 1) throw missingDestination();
      return Number(actor.id_cliente);
    }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });

    return { id: file.id, created: true, clientId };
  } catch (error) {
    if (!hasDatabaseError(error, 'ER_DUP_ENTRY', 1062)) throw error;
    const [duplicate] = await dataSource.query<Array<{ id: string; clientId: number }>>(`
      SELECT r.id_comprobante AS id, r.id_cliente AS clientId
      FROM COMPROBANTE_PAGO r
      INNER JOIN (${sql}) dest
        ON dest.clientId = r.id_cliente AND dest.orderId <=> r.id_pedido
        AND dest.accountId <=> r.id_cuenta_corriente
      WHERE r.sha256 = ?
    `, [...params, file.hash]);
    if (!duplicate) throw error;
    return { id: duplicate.id, created: false, clientId: Number(duplicate.clientId) };
  }
}

export interface ReviewReceiptResult {
  receipt: ReceiptDto;
  clientId: number;
  replay: boolean;
}

export async function reviewReceipt(
  userId: number,
  id: string,
  input: ReceiptReviewInput,
  idempotencyKey: string,
): Promise<ReviewReceiptResult> {
  return inTransaction(async manager => {
    // §10.5: COMPROBANTE_PAGO FOR UPDATE -> USUARIO (revalidacion ADMIN activo=1 y rol='ADMIN') -> UPDATE COMPROBANTE_PAGO.
    // INV-01: jamas adquiere locks ni escribe en PAGO, CUENTA_CORRIENTE, MOVIMIENTO_CUENTA_CORRIENTE, IMPUTACION ni PEDIDO.
    const [locked] = await manager.query<LockedReceiptRow[]>(`
      SELECT id_comprobante, id_cliente, id_pedido, id_cuenta_corriente,
             estado_revision, id_admin_revision, CAST(revision_utc AS CHAR) AS revision_utc,
             motivo_rechazo, clave_idempotencia_revision
      FROM COMPROBANTE_PAGO
      WHERE id_comprobante = ?
      FOR UPDATE
    `, [id]);

    const [admin] = await manager.query<Array<{ activo: number | boolean; rol: string }>>(
      'SELECT activo, rol FROM USUARIO WHERE id_usuario = ? LOCK IN SHARE MODE',
      [userId],
    );
    if (!admin || Number(admin.activo) !== 1) {
      throw new ReceiptError(401, 'NO_AUTENTICADO', 'No autenticado.');
    }
    if (admin.rol !== 'ADMIN') {
      throw new ReceiptError(403, 'SIN_PERMISO', 'El rol autenticado no tiene permiso.');
    }

    if (!locked) {
      throw receiptNotFound();
    }

    const [keyCollision] = await manager.query<Array<{ id_comprobante: string }>>(`
      SELECT id_comprobante
      FROM COMPROBANTE_PAGO
      WHERE id_admin_revision = ? AND clave_idempotencia_revision = ?
      LIMIT 1
    `, [userId, idempotencyKey]);

    if (keyCollision && keyCollision.id_comprobante !== id) {
      throw new ReceiptError(
        409,
        'CLAVE_IDEMPOTENCIA_REUTILIZADA',
        'La clave de idempotencia ya fue utilizada para otra revisión de comprobante.',
      );
    }

    if (locked.estado_revision !== 'PENDIENTE') {
      if (
        Number(locked.id_admin_revision) === userId &&
        locked.clave_idempotencia_revision === idempotencyKey
      ) {
        const samePayload =
          locked.estado_revision === input.estado &&
          (locked.motivo_rechazo ?? null) === input.motivo;
        if (!samePayload) {
          throw new ReceiptError(
            409,
            'CLAVE_IDEMPOTENCIA_REUTILIZADA',
            'La clave de idempotencia ya fue utilizada con otros datos de revisión.',
          );
        }
        const existing = await findReceipt({ admin: true }, userId, id, manager);
        if (!existing) throw receiptNotFound();
        return { receipt: existing, clientId: Number(locked.id_cliente), replay: true };
      }

      throw new ReceiptError(
        409,
        'COMPROBANTE_YA_RESUELTO',
        'El comprobante ya fue resuelto de forma definitiva y no admite nuevos cambios.',
      );
    }

    try {
      const result = await manager.query<{ affectedRows?: number }>(`
        UPDATE COMPROBANTE_PAGO
        SET estado_revision = ?,
            id_admin_revision = ?,
            revision_utc = UTC_TIMESTAMP(3),
            motivo_rechazo = ?,
            clave_idempotencia_revision = ?
        WHERE id_comprobante = ?
          AND estado_revision = 'PENDIENTE'
      `, [input.estado, userId, input.motivo, idempotencyKey, id]);

      if (Number(result?.affectedRows ?? 0) !== 1) {
        throw new ReceiptError(
          409,
          'COMPROBANTE_YA_RESUELTO',
          'El comprobante ya fue resuelto por otra operación concurrente.',
        );
      }
    } catch (error) {
      if (hasDatabaseError(error, 'ER_DUP_ENTRY', 1062)) {
        throw new ReceiptError(
          409,
          'CLAVE_IDEMPOTENCIA_REUTILIZADA',
          'La clave de idempotencia ya fue utilizada para otra revisión de comprobante.',
        );
      }
      throw error;
    }

    const updated = await findReceipt({ admin: true }, userId, id, manager);
    if (!updated) throw receiptNotFound();

    return {
      receipt: updated,
      clientId: Number(locked.id_cliente),
      replay: false,
    };
  }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
}
