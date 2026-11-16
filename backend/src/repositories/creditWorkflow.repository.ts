import type { EntityManager } from 'typeorm';
import type { CreditEventListQuery, CreditRequestListQuery, CreditRequestState } from '../dtos/credit/credit-workflow.dto';

export interface CreditRequestRow {
  id_solicitud_credito: number;
  id_cliente: number;
  id_usuario_solicitante: number;
  monto_solicitado: string;
  plazo_solicitado: number;
  moneda: string;
  estado: CreditRequestState;
  observaciones: string | null;
  clave_idempotencia: string;
  fecha_solicitud_iso: string;
  id_usuario_resolucion: number | null;
  fecha_resolucion_iso: string | null;
  limite_autorizado: string | null;
  plazo_autorizado: number | null;
  motivo_resolucion: string | null;
  evidencia_resolucion: string | null;
  id_cuenta_corriente: number | null;
  cliente_nombre?: string | null;
  solicitante_email?: string | null;
}

export interface CreditEventRow {
  id_evento_credito: string;
  id_cliente: number;
  id_solicitud_credito: number | null;
  id_cuenta_corriente: number | null;
  tipo_evento: string;
  id_actor_usuario: number;
  rol_actor: 'ADMIN' | 'CLIENTE';
  clave_idempotencia: string | null;
  estado_anterior: string | null;
  estado_nuevo: string;
  limite_anterior: string | null;
  limite_nuevo: string | null;
  moneda: string;
  motivo: string | null;
  evidencia: string | null;
  revision_cuenta: string | null;
  fecha_evento_iso: string;
  resultado_json: string | null;
}

export interface CreditAccountRow {
  id_cuenta_corriente: number;
  id_cliente: number;
  limite_credito: string;
  habilitada: number;
  cobertura: 'COMPLETA' | 'PARCIAL' | 'NO_ACREDITADA';
  plazo_dias: 30 | 60 | null;
  moneda_limite: string | null;
  evidencia_limite: string | null;
  evidencia_plazo: string | null;
  evidencia_cobertura: string | null;
  cobertura_desde_iso: string | null;
  origen_datos: 'REAL' | 'DEMO';
  revision: string;
  fecha_alta: Date;
  observaciones: string | null;
}

export interface CreditClientRow {
  id_cliente: number;
  tipo_cliente: 'PARTICULAR' | 'EMPRESA';
  nombre_razon_social: string;
  estado_aprobacion_empresa: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | null;
  activo: number;
}

export interface CreditUserRow {
  id_usuario: number;
  id_cliente: number | null;
  rol: 'CLIENTE' | 'ADMIN';
  activo: number;
}

export interface CreateRequestInput {
  clienteId: number;
  solicitanteId: number;
  monto: string;
  plazoDias: number;
  observaciones: string | null;
  claveIdempotencia: string;
  fechaUtc: string;
}

export interface CreateEventInput {
  clienteId: number;
  solicitudId: number | null;
  cuentaId: number | null;
  tipo: string;
  actorId: number;
  rolActor: 'ADMIN' | 'CLIENTE';
  claveIdempotencia: string | null;
  estadoAnterior: string | null;
  estadoNuevo: string;
  limiteAnterior: string | null;
  limiteNuevo: string | null;
  motivo: string | null;
  evidencia: string | null;
  revisionCuenta: string | null;
  fechaUtc: string;
  resultadoJson: string;
}

export interface CreateAccountInput {
  clienteId: number;
  limite: string;
  plazoDias: number;
  evidencia: string;
  coberturaDesdeUtc: string;
  solicitudId: number;
}

export const utcSql = (date: Date): string =>
  date.toISOString().slice(0, 23).replace('T', ' ');

const REQUEST_SELECT = `
  s.id_solicitud_credito, s.id_cliente, s.id_usuario_solicitante,
  s.monto_solicitado, s.plazo_solicitado, s.moneda, s.estado, s.observaciones,
  s.clave_idempotencia,
  DATE_FORMAT(s.fecha_solicitud_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS fecha_solicitud_iso,
  s.id_usuario_resolucion,
  DATE_FORMAT(s.fecha_resolucion_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS fecha_resolucion_iso,
  s.limite_autorizado, s.plazo_autorizado, s.motivo_resolucion,
  s.evidencia_resolucion, s.id_cuenta_corriente,
  c.nombre_razon_social AS cliente_nombre, u.email AS solicitante_email
`;

const EVENT_SELECT = `
  e.id_evento_credito, e.id_cliente, e.id_solicitud_credito, e.id_cuenta_corriente,
  e.tipo_evento, e.id_actor_usuario, e.rol_actor, e.clave_idempotencia,
  e.estado_anterior, e.estado_nuevo, e.limite_anterior, e.limite_nuevo, e.moneda,
  e.motivo, e.evidencia, e.revision_cuenta,
  DATE_FORMAT(e.fecha_evento_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS fecha_evento_iso,
  e.resultado_json
`;

const ACCOUNT_SELECT = `
  c.id_cuenta_corriente, c.id_cliente, c.limite_credito, c.habilitada, c.cobertura,
  c.plazo_dias, c.moneda_limite, c.evidencia_limite, c.evidencia_plazo,
  c.evidencia_cobertura,
  DATE_FORMAT(c.cobertura_desde_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS cobertura_desde_iso,
  c.origen_datos, CAST(c.revision AS CHAR) AS revision, c.fecha_alta, c.observaciones
`;

export async function findClientIdForUser(
  manager: EntityManager,
  userId: number,
): Promise<number | null> {
  const [row] = await manager.query<{ id_cliente: number | null }[]>(
    "SELECT id_cliente FROM USUARIO WHERE id_usuario = ? AND rol = 'CLIENTE' AND activo = 1",
    [userId],
  );
  return row?.id_cliente ?? null;
}

export async function findUserById(
  manager: EntityManager,
  userId: number,
): Promise<CreditUserRow | null> {
  const [row] = await manager.query<CreditUserRow[]>(
    'SELECT id_usuario, id_cliente, rol, activo FROM USUARIO WHERE id_usuario = ?',
    [userId],
  );
  return row ?? null;
}

export async function findUserForUpdate(
  manager: EntityManager,
  userId: number,
): Promise<CreditUserRow | null> {
  const [row] = await manager.query<CreditUserRow[]>(
    'SELECT id_usuario, id_cliente, rol, activo FROM USUARIO WHERE id_usuario = ? FOR UPDATE',
    [userId],
  );
  return row ?? null;
}

export async function findClientForUpdate(
  manager: EntityManager,
  clientId: number,
): Promise<CreditClientRow | null> {
  const [row] = await manager.query<CreditClientRow[]>(
    `SELECT id_cliente, tipo_cliente, nombre_razon_social,
      estado_aprobacion_empresa, activo
     FROM CLIENTE WHERE id_cliente = ? FOR UPDATE`,
    [clientId],
  );
  return row ?? null;
}

export async function findClientById(
  manager: EntityManager,
  clientId: number,
): Promise<CreditClientRow | null> {
  const [row] = await manager.query<CreditClientRow[]>(
    `SELECT id_cliente, tipo_cliente, nombre_razon_social,
      estado_aprobacion_empresa, activo
     FROM CLIENTE WHERE id_cliente = ?`,
    [clientId],
  );
  return row ?? null;
}

export async function findAccountForUpdate(
  manager: EntityManager,
  clientId: number,
): Promise<CreditAccountRow | null> {
  const [row] = await manager.query<CreditAccountRow[]>(
    `SELECT ${ACCOUNT_SELECT} FROM CUENTA_CORRIENTE c
     WHERE c.id_cliente = ? FOR UPDATE`,
    [clientId],
  );
  return row ?? null;
}

export async function findAccountByClient(
  manager: EntityManager,
  clientId: number,
): Promise<CreditAccountRow | null> {
  const [row] = await manager.query<CreditAccountRow[]>(
    `SELECT ${ACCOUNT_SELECT} FROM CUENTA_CORRIENTE c WHERE c.id_cliente = ?`,
    [clientId],
  );
  return row ?? null;
}

export async function findRequestClientId(
  manager: EntityManager,
  requestId: number,
): Promise<number | null> {
  const [row] = await manager.query<{ id_cliente: number }[]>(
    'SELECT id_cliente FROM SOLICITUD_CREDITO WHERE id_solicitud_credito = ?',
    [requestId],
  );
  return row?.id_cliente ?? null;
}

export async function findRequestForUpdate(
  manager: EntityManager,
  requestId: number,
): Promise<CreditRequestRow | null> {
  const [row] = await manager.query<CreditRequestRow[]>(
    `SELECT ${REQUEST_SELECT}
     FROM SOLICITUD_CREDITO s
     INNER JOIN CLIENTE c ON c.id_cliente = s.id_cliente
     INNER JOIN USUARIO u ON u.id_usuario = s.id_usuario_solicitante
     WHERE s.id_solicitud_credito = ? FOR UPDATE`,
    [requestId],
  );
  return row ?? null;
}

export async function findRequestById(
  manager: EntityManager,
  requestId: number,
): Promise<CreditRequestRow | null> {
  const [row] = await manager.query<CreditRequestRow[]>(
    `SELECT ${REQUEST_SELECT}
     FROM SOLICITUD_CREDITO s
     INNER JOIN CLIENTE c ON c.id_cliente = s.id_cliente
     INNER JOIN USUARIO u ON u.id_usuario = s.id_usuario_solicitante
     WHERE s.id_solicitud_credito = ?`,
    [requestId],
  );
  return row ?? null;
}

export async function hasActiveClientUser(
  manager: EntityManager,
  clientId: number,
): Promise<boolean> {
  const [row] = await manager.query<{ id_usuario: number }[]>(
    `SELECT id_usuario FROM USUARIO
     WHERE id_cliente = ? AND rol = 'CLIENTE' AND activo = 1
     LIMIT 1 LOCK IN SHARE MODE`,
    [clientId],
  );
  return Boolean(row);
}

export async function findRequestForClient(
  manager: EntityManager,
  requestId: number,
  clientId: number,
): Promise<CreditRequestRow | null> {
  const [row] = await manager.query<CreditRequestRow[]>(
    `SELECT ${REQUEST_SELECT}
     FROM SOLICITUD_CREDITO s
     INNER JOIN CLIENTE c ON c.id_cliente = s.id_cliente
     INNER JOIN USUARIO u ON u.id_usuario = s.id_usuario_solicitante
     WHERE s.id_solicitud_credito = ? AND s.id_cliente = ?`,
    [requestId, clientId],
  );
  return row ?? null;
}

export async function findPendingRequestForClient(
  manager: EntityManager,
  clientId: number,
  lock = false,
): Promise<CreditRequestRow | null> {
  const [row] = await manager.query<CreditRequestRow[]>(
    `SELECT ${REQUEST_SELECT}
     FROM SOLICITUD_CREDITO s
     INNER JOIN CLIENTE c ON c.id_cliente = s.id_cliente
     INNER JOIN USUARIO u ON u.id_usuario = s.id_usuario_solicitante
     WHERE s.id_cliente = ? AND s.estado = 'PENDIENTE'
     ORDER BY s.id_solicitud_credito DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [clientId],
  );
  return row ?? null;
}

export async function findRequestByClientKey(
  manager: EntityManager,
  userId: number,
  key: string,
): Promise<CreditRequestRow | null> {
  const [row] = await manager.query<CreditRequestRow[]>(
    `SELECT ${REQUEST_SELECT}
     FROM SOLICITUD_CREDITO s
     INNER JOIN CLIENTE c ON c.id_cliente = s.id_cliente
     INNER JOIN USUARIO u ON u.id_usuario = s.id_usuario_solicitante
     WHERE s.id_usuario_solicitante = ? AND s.clave_idempotencia = ?`,
    [userId, key],
  );
  return row ?? null;
}

export async function insertRequest(
  manager: EntityManager,
  input: CreateRequestInput,
): Promise<number> {
  const result = await manager.query(
    `INSERT INTO SOLICITUD_CREDITO
      (id_cliente, id_usuario_solicitante, monto_solicitado, plazo_solicitado,
       moneda, estado, observaciones, clave_idempotencia, fecha_solicitud_utc)
     VALUES (?, ?, ?, ?, 'USD', 'PENDIENTE', ?, ?, ?)`,
    [
      input.clienteId, input.solicitanteId, input.monto, input.plazoDias,
      input.observaciones, input.claveIdempotencia, input.fechaUtc,
    ],
  );
  return Number((result as { insertId: number | string }).insertId);
}

export async function approveRequest(
  manager: EntityManager,
  input: {
    requestId: number;
    actorId: number;
    cuentaId: number;
    limite: string;
    plazoDias: number;
    motivo: string;
    evidencia: string;
    fechaUtc: string;
  },
): Promise<number> {
  const result = await manager.query(
    `UPDATE SOLICITUD_CREDITO
     SET estado = 'APROBADA', id_usuario_resolucion = ?, fecha_resolucion_utc = ?,
         limite_autorizado = ?, plazo_autorizado = ?, motivo_resolucion = ?,
         evidencia_resolucion = ?, id_cuenta_corriente = ?
     WHERE id_solicitud_credito = ? AND estado = 'PENDIENTE'`,
    [
      input.actorId, input.fechaUtc, input.limite, input.plazoDias, input.motivo,
      input.evidencia, input.cuentaId, input.requestId,
    ],
  );
  return Number((result as { affectedRows: number }).affectedRows ?? 0);
}

export async function rejectRequest(
  manager: EntityManager,
  input: {
    requestId: number;
    actorId: number;
    motivo: string;
    evidencia: string | null;
    fechaUtc: string;
  },
): Promise<number> {
  const result = await manager.query(
    `UPDATE SOLICITUD_CREDITO
     SET estado = 'RECHAZADA', id_usuario_resolucion = ?, fecha_resolucion_utc = ?,
         motivo_resolucion = ?, evidencia_resolucion = ?,
         limite_autorizado = NULL, plazo_autorizado = NULL, id_cuenta_corriente = NULL
     WHERE id_solicitud_credito = ? AND estado = 'PENDIENTE'`,
    [input.actorId, input.fechaUtc, input.motivo, input.evidencia, input.requestId],
  );
  return Number((result as { affectedRows: number }).affectedRows ?? 0);
}

export async function createAccount(
  manager: EntityManager,
  input: CreateAccountInput,
): Promise<number> {
  const evidence = input.evidencia;
  const result = await manager.query(
    `INSERT INTO CUENTA_CORRIENTE
      (id_cliente, limite_credito, habilitada, cobertura, plazo_dias, moneda_limite,
       evidencia_limite, evidencia_plazo, evidencia_cobertura, cobertura_desde_utc,
       origen_datos, observaciones)
     VALUES (?, ?, 0, 'COMPLETA', ?, 'USD', ?, ?, ?, ?, 'REAL', ?)`,
    [
      input.clienteId, input.limite, input.plazoDias, evidence, evidence, evidence,
      input.coberturaDesdeUtc, `Alta por solicitud de crédito #${input.solicitudId}; sin deuda previa acreditada.`,
    ],
  );
  return Number((result as { insertId: number | string }).insertId);
}

export async function applyApprovedTerms(
  manager: EntityManager,
  accountId: number,
  input: { limite: string; plazoDias: number; evidencia: string },
): Promise<void> {
  await manager.query(
    `UPDATE CUENTA_CORRIENTE
     SET limite_credito = ?, moneda_limite = 'USD', evidencia_limite = ?,
         plazo_dias = ?, evidencia_plazo = ?
     WHERE id_cuenta_corriente = ?`,
    [input.limite, input.evidencia, input.plazoDias, input.evidencia, accountId],
  );
}

export async function updateAccountLimit(
  manager: EntityManager,
  accountId: number,
  input: { limite: string; evidencia: string },
): Promise<void> {
  await manager.query(
    `UPDATE CUENTA_CORRIENTE
     SET limite_credito = ?, moneda_limite = 'USD', evidencia_limite = ?
     WHERE id_cuenta_corriente = ?`,
    [input.limite, input.evidencia, accountId],
  );
}

export async function setAccountEnabled(
  manager: EntityManager,
  accountId: number,
  enabled: boolean,
): Promise<void> {
  await manager.query(
    'UPDATE CUENTA_CORRIENTE SET habilitada = ? WHERE id_cuenta_corriente = ?',
    [enabled ? 1 : 0, accountId],
  );
}

export async function readAccountRevision(
  manager: EntityManager,
  accountId: number,
): Promise<string> {
  const [row] = await manager.query<{ revision: string }[]>(
    'SELECT CAST(revision AS CHAR) AS revision FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?',
    [accountId],
  );
  return row?.revision ?? '0';
}

export async function insertEvent(
  manager: EntityManager,
  input: CreateEventInput,
): Promise<string> {
  const result = await manager.query(
    `INSERT INTO EVENTO_CREDITO
      (id_cliente, id_solicitud_credito, id_cuenta_corriente, tipo_evento,
       id_actor_usuario, rol_actor, clave_idempotencia, estado_anterior,
       estado_nuevo, limite_anterior, limite_nuevo, moneda, motivo, evidencia,
       revision_cuenta, fecha_evento_utc, resultado_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?)`,
    [
      input.clienteId, input.solicitudId, input.cuentaId, input.tipo,
      input.actorId, input.rolActor, input.claveIdempotencia, input.estadoAnterior,
      input.estadoNuevo, input.limiteAnterior, input.limiteNuevo, input.motivo,
      input.evidencia, input.revisionCuenta, input.fechaUtc, input.resultadoJson,
    ],
  );
  return String((result as { insertId: number | string }).insertId);
}

export async function findEventByKey(
  manager: EntityManager,
  actorId: number,
  key: string,
  lock = false,
): Promise<CreditEventRow | null> {
  const [row] = await manager.query<CreditEventRow[]>(
    `SELECT ${EVENT_SELECT} FROM EVENTO_CREDITO e
     WHERE e.id_actor_usuario = ? AND e.clave_idempotencia = ?${lock ? ' FOR UPDATE' : ''}`,
    [actorId, key],
  );
  return row ?? null;
}

export async function listRequests(
  manager: EntityManager,
  query: CreditRequestListQuery,
  clientId?: number,
): Promise<CreditRequestRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (clientId !== undefined) {
    conditions.push('s.id_cliente = ?');
    values.push(clientId);
  }
  if (query.clienteId !== undefined) {
    conditions.push('s.id_cliente = ?');
    values.push(query.clienteId);
  }
  if (query.estado !== undefined) {
    conditions.push('s.estado = ?');
    values.push(query.estado);
  }
  if (query.antesDeId !== undefined) {
    conditions.push('s.id_solicitud_credito < ?');
    values.push(query.antesDeId);
  }
  values.push(query.limite);
  const rows = await manager.query<CreditRequestRow[]>(
    `SELECT ${REQUEST_SELECT}
     FROM SOLICITUD_CREDITO s
     INNER JOIN CLIENTE c ON c.id_cliente = s.id_cliente
     INNER JOIN USUARIO u ON u.id_usuario = s.id_usuario_solicitante
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY s.id_solicitud_credito DESC
     LIMIT ?`,
    values,
  );
  return rows;
}

export async function listEvents(
  manager: EntityManager,
  query: CreditEventListQuery,
): Promise<CreditEventRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (query.clienteId !== undefined) {
    conditions.push('e.id_cliente = ?');
    values.push(query.clienteId);
  }
  if (query.solicitudId !== undefined) {
    conditions.push('e.id_solicitud_credito = ?');
    values.push(query.solicitudId);
  }
  if (query.tipo !== undefined) {
    conditions.push('e.tipo_evento = ?');
    values.push(query.tipo);
  }
  if (query.antesDeId !== undefined) {
    conditions.push('e.id_evento_credito < ?');
    values.push(query.antesDeId);
  }
  values.push(query.limite);
  return manager.query<CreditEventRow[]>(
    `SELECT ${EVENT_SELECT} FROM EVENTO_CREDITO e
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY e.id_evento_credito DESC
     LIMIT ?`,
    values,
  );
}

