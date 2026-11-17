import type { EntityManager } from 'typeorm';
import { inTransaction } from '../../config/database.config';
import type {
  ApproveCreditRequest,
  ChangeCreditLimit,
  CreateCreditRequest,
  CreditEventListQuery,
  CreditRequestListQuery,
  DisableCreditAccount,
  EnableCreditAccount,
  RejectCreditRequest,
} from '../../dtos/credit/credit-workflow.dto';
import {
  formatCreditAmount,
  parseCreditAmount,
} from '../../dtos/credit/credit-workflow.dto';
import type { AuthContext } from '../../types/auth';
import {
  applyApprovedTerms,
  approveRequest,
  createAccount,
  findAccountByClient,
  findAccountForUpdate,
  findClientById,
  findClientForUpdate,
  findClientIdForUser,
  findEventByKey,
  findPendingRequestForClient,
  findRequestByClientKey,
  findRequestById,
  findRequestClientId,
  hasActiveClientUser,
  findRequestForClient,
  findUserById,
  findUserForUpdate,
  insertEvent,
  insertRequest,
  listEvents,
  listRequests,
  readAccountRevision,
  rejectRequest,
  setAccountEnabled,
  updateAccountLimit,
  utcSql,
  type CreditAccountRow,
  type CreditClientRow,
  type CreditEventRow,
  type CreditRequestRow,
} from '../../repositories/creditWorkflow.repository';
import { calcularEstadoCuenta } from '../../repositories/cuentaCorriente.repository';
import {
  claveIdempotenciaReutilizada,
  clienteInactivo,
  conflictoConcurrencia,
  cuentaNoAcreditada,
  cuentaNoEncontrada,
  cuentaYaDeshabilitada,
  cuentaYaHabilitada,
  empresaNoAprobada,
  estadoFinancieroNoDeterminable,
  limitePorDebajoDeDeuda,
  noAutenticado,
  sinPermiso,
  solicitudNoEncontrada,
  solicitudNoPendiente,
  solicitudPendienteDuplicada,
  soloEmpresas,
  CreditWorkflowError,
} from './credit-workflow.errors';

export interface CreditWorkflowResult<T = Record<string, unknown>> {
  data: T;
  eventoId: string;
  replay: boolean;
}

function parseDbAmount(value: string | null, allowZero = true): bigint | null {
  return parseCreditAmount(value, allowZero);
}

function clientView(row: CreditRequestRow) {
  return {
    id: row.id_solicitud_credito,
    estado: row.estado,
    montoSolicitado: row.monto_solicitado,
    plazoDias: row.plazo_solicitado,
    moneda: 'USD' as const,
    observaciones: row.observaciones,
    fechaSolicitud: row.fecha_solicitud_iso,
    fechaResolucion: row.fecha_resolucion_iso,
    limiteAutorizado: row.limite_autorizado,
    plazoAutorizado: row.plazo_autorizado,
  };
}

function adminRequestView(row: CreditRequestRow) {
  return {
    id: row.id_solicitud_credito,
    clienteId: row.id_cliente,
    clienteNombre: row.cliente_nombre ?? null,
    solicitanteUsuarioId: row.id_usuario_solicitante,
    solicitanteEmail: row.solicitante_email ?? null,
    estado: row.estado,
    montoSolicitado: row.monto_solicitado,
    plazoDias: row.plazo_solicitado,
    moneda: 'USD' as const,
    observaciones: row.observaciones,
    fechaSolicitud: row.fecha_solicitud_iso,
    resueltaPorUsuarioId: row.id_usuario_resolucion,
    fechaResolucion: row.fecha_resolucion_iso,
    limiteAutorizado: row.limite_autorizado,
    plazoAutorizado: row.plazo_autorizado,
    motivoResolucion: row.motivo_resolucion,
    evidenciaResolucion: row.evidencia_resolucion,
    cuentaCorrienteId: row.id_cuenta_corriente,
  };
}

function accountView(row: CreditAccountRow) {
  return {
    clienteId: row.id_cliente,
    cuentaId: row.id_cuenta_corriente,
    habilitada: row.habilitada === 1,
    limiteCredito: row.limite_credito,
    moneda: row.moneda_limite,
    plazoDias: row.plazo_dias,
    cobertura: row.cobertura,
    origen: row.origen_datos,
    revision: row.revision,
  };
}

function eventView(row: CreditEventRow) {
  return {
    id: row.id_evento_credito,
    clienteId: row.id_cliente,
    solicitudId: row.id_solicitud_credito,
    cuentaId: row.id_cuenta_corriente,
    tipo: row.tipo_evento,
    actorUsuarioId: row.id_actor_usuario,
    rolActor: row.rol_actor,
    estadoAnterior: row.estado_anterior,
    estadoNuevo: row.estado_nuevo,
    limiteAnterior: row.limite_anterior,
    limiteNuevo: row.limite_nuevo,
    moneda: row.moneda,
    motivo: row.motivo,
    evidencia: row.evidencia,
    revisionCuenta: row.revision_cuenta,
    fechaEvento: row.fecha_evento_iso,
  };
}

function accountStateName(row: CreditAccountRow): 'HABILITADA' | 'INHABILITADA' {
  return row.habilitada === 1 ? 'HABILITADA' : 'INHABILITADA';
}

async function lockAdmin(manager: EntityManager, auth: AuthContext) {
  if (auth.rol !== 'ADMIN') throw sinPermiso();
  const user = await findUserForUpdate(manager, auth.id);
  if (!user || user.activo !== 1) throw noAutenticado();
  if (user.rol !== 'ADMIN' || user.id_cliente !== null) throw sinPermiso();
  return user;
}

async function readAdmin(manager: EntityManager, auth: AuthContext) {
  if (auth.rol !== 'ADMIN') throw sinPermiso();
  const user = await findUserById(manager, auth.id);
  if (!user || user.activo !== 1) throw noAutenticado();
  if (user.rol !== 'ADMIN' || user.id_cliente !== null) throw sinPermiso();
  return user;
}

function assertApprovedCompany(client: CreditClientRow): void {
  if (client.tipo_cliente !== 'EMPRESA') throw soloEmpresas();
  if (client.estado_aprobacion_empresa !== 'APROBADA') throw empresaNoAprobada(403);
}

async function lockClientContext(manager: EntityManager, auth: AuthContext): Promise<CreditClientRow> {
  if (auth.rol !== 'CLIENTE') throw sinPermiso();
  const clientId = await findClientIdForUser(manager, auth.id);
  if (clientId === null) {
    const user = await findUserForUpdate(manager, auth.id);
    if (!user || user.activo !== 1) throw noAutenticado();
    throw sinPermiso();
  }

  // Mismo orden que carrito y checkout. El primer SELECT solo localiza
  // la empresa; la identidad se revalida con ambas filas bloqueadas.
  const client = await findClientForUpdate(manager, clientId);
  if (!client || client.activo !== 1) throw clienteInactivo();
  const user = await findUserForUpdate(manager, auth.id);
  if (!user || user.activo !== 1) throw noAutenticado();
  if (user.rol !== 'CLIENTE' || user.id_cliente !== client.id_cliente) throw sinPermiso();
  assertApprovedCompany(client);
  return client;
}

async function resolveClientForRead(manager: EntityManager, auth: AuthContext) {
  if (auth.rol !== 'CLIENTE') throw sinPermiso();
  const clientId = await findClientIdForUser(manager, auth.id);
  if (clientId === null) {
    const user = await findUserById(manager, auth.id);
    if (!user || user.activo !== 1) throw noAutenticado();
    throw sinPermiso();
  }
  const client = await findClientById(manager, clientId);
  if (!client || client.activo !== 1) throw clienteInactivo();
  assertApprovedCompany(client);
  return clientId;
}

function replay<T>(
  event: CreditEventRow,
  expectedType: string,
  target: { requestId?: number; accountId?: number; limit?: string; motivo?: string | null; evidencia?: string | null },
): CreditWorkflowResult<T> {
  const matches = event.tipo_evento === expectedType
    && (target.requestId === undefined || event.id_solicitud_credito === target.requestId)
    && (target.accountId === undefined || event.id_cuenta_corriente === target.accountId)
    && (target.limit === undefined || event.limite_nuevo === target.limit)
    && (target.motivo === undefined || event.motivo === target.motivo)
    && (target.evidencia === undefined || event.evidencia === target.evidencia);
  if (!matches) throw claveIdempotenciaReutilizada();
  if (!event.resultado_json) throw conflictoConcurrencia();
  try {
    return {
      data: JSON.parse(event.resultado_json) as T,
      eventoId: event.id_evento_credito,
      replay: true,
    };
  } catch {
    throw conflictoConcurrencia();
  }
}

async function replayClientCreation(
  manager: EntityManager,
  clientId: number,
  userId: number,
  key: string,
  monto: string,
  plazoDias: number,
  observaciones: string | null,
): Promise<CreditWorkflowResult | null> {
  const request = await findRequestByClientKey(manager, userId, key);
  const event = await findEventByKey(manager, userId, key);
  if (!request && !event) return null;
  if (!request || request.id_cliente !== clientId || request.monto_solicitado !== monto
    || request.plazo_solicitado !== plazoDias || request.observaciones !== observaciones) {
    throw claveIdempotenciaReutilizada();
  }
  if (!event || event.id_cliente !== clientId) throw conflictoConcurrencia();
  return replay(event, 'SOLICITUD_CREADA', { requestId: request.id_solicitud_credito });
}

function missingAccreditation(account: CreditAccountRow): string[] {
  const missing: string[] = [];
  if (account.moneda_limite !== 'USD') missing.push('moneda_limite');
  if (!account.evidencia_limite?.trim()) missing.push('evidencia_limite');
  if (parseDbAmount(account.limite_credito, true) === null) missing.push('limite_credito');
  if (account.plazo_dias !== 30 && account.plazo_dias !== 60) missing.push('plazo_dias');
  if (!account.evidencia_plazo?.trim()) missing.push('evidencia_plazo');
  if (account.cobertura !== 'COMPLETA') missing.push('cobertura');
  if (!account.evidencia_cobertura?.trim()) missing.push('evidencia_cobertura');
  const since = account.cobertura_desde_iso ? Date.parse(account.cobertura_desde_iso) : Number.NaN;
  if (!Number.isFinite(since) || since > Date.now()) missing.push('cobertura_desde_utc');
  return missing;
}

function isDemoAccount(account: CreditAccountRow): boolean {
  return account.origen_datos === 'DEMO' && process.env.NODE_ENV !== 'test';
}

export async function createCreditRequest(
  auth: AuthContext,
  input: CreateCreditRequest,
  key: string,
): Promise<CreditWorkflowResult> {
  const cents = parseCreditAmount(input.montoSolicitado, false);
  if (cents === null) throw new CreditWorkflowError('MONTO_INVALIDO', 400, 'El monto solicitado es inválido.');
  const monto = formatCreditAmount(cents);
  const observaciones = input.observaciones ?? null;

  try {
    return await inTransaction(async (manager) => {
      const client = await lockClientContext(manager, auth);
      const previous = await replayClientCreation(
        manager, client.id_cliente, auth.id, key, monto, input.plazoDias, observaciones,
      );
      if (previous) return previous;

      const pending = await findPendingRequestForClient(manager, client.id_cliente);
      if (pending) throw solicitudPendienteDuplicada(pending.id_solicitud_credito);

      const now = new Date();
      const fechaUtc = utcSql(now);
      const requestId = await insertRequest(manager, {
        clienteId: client.id_cliente,
        solicitanteId: auth.id,
        monto,
        plazoDias: input.plazoDias,
        observaciones,
        claveIdempotencia: key,
        fechaUtc,
      });
      const row = await findRequestById(manager, requestId);
      if (!row) throw conflictoConcurrencia();
      const data = { solicitud: clientView(row) };
      const eventoId = await insertEvent(manager, {
        clienteId: client.id_cliente,
        solicitudId: requestId,
        cuentaId: null,
        tipo: 'SOLICITUD_CREADA',
        actorId: auth.id,
        rolActor: 'CLIENTE',
        claveIdempotencia: key,
        estadoAnterior: null,
        estadoNuevo: 'PENDIENTE',
        limiteAnterior: null,
        limiteNuevo: null,
        motivo: null,
        evidencia: null,
        revisionCuenta: null,
        fechaUtc,
        resultadoJson: JSON.stringify(data),
      });
      return { data, eventoId, replay: false };
    }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
  } catch (error) {
    if (isDuplicateEntry(error)) {
      return recoverClientRequest(auth, key, monto, input.plazoDias, observaciones);
    }
    throw error;
  }
}

function isDuplicateEntry(error: unknown): boolean {
  const candidate = (error && typeof error === 'object'
    ? error : {}) as { code?: string; driverError?: { code?: string } };
  return candidate.code === 'ER_DUP_ENTRY' || candidate.driverError?.code === 'ER_DUP_ENTRY';
}

async function recoverClientRequest(
  auth: AuthContext,
  key: string,
  monto: string,
  plazoDias: number,
  observaciones: string | null,
): Promise<CreditWorkflowResult> {
  return inTransaction(async (manager) => {
    const client = await lockClientContext(manager, auth);
    const previous = await replayClientCreation(
      manager, client.id_cliente, auth.id, key, monto, plazoDias, observaciones,
    );
    if (previous) return previous;
    const pending = await findPendingRequestForClient(manager, client.id_cliente);
    if (pending) throw solicitudPendienteDuplicada(pending.id_solicitud_credito);
    throw conflictoConcurrencia();
  }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
}

export async function listClientCreditRequests(
  auth: AuthContext,
  query: CreditRequestListQuery,
): Promise<{ items: ReturnType<typeof clientView>[]; siguienteAntesDeId: number | null }> {
  return inTransaction(async (manager) => {
    const clientId = await resolveClientForRead(manager, auth);
    const rows = await listRequests(manager, query, clientId);
    return {
      items: rows.map(clientView),
      siguienteAntesDeId: rows.length === query.limite
        ? rows[rows.length - 1].id_solicitud_credito : null,
    };
  }, { isolation: 'REPEATABLE READ' });
}

export async function getClientCreditRequest(
  auth: AuthContext,
  requestId: number,
): Promise<{ solicitud: ReturnType<typeof clientView> }> {
  return inTransaction(async (manager) => {
    const clientId = await resolveClientForRead(manager, auth);
    const row = await findRequestForClient(manager, requestId, clientId);
    if (!row) throw solicitudNoEncontrada();
    return { solicitud: clientView(row) };
  }, { isolation: 'REPEATABLE READ' });
}

export async function listAdminCreditRequests(
  auth: AuthContext,
  query: CreditRequestListQuery,
): Promise<{ items: ReturnType<typeof adminRequestView>[]; siguienteAntesDeId: number | null }> {
  return inTransaction(async (manager) => {
    await readAdmin(manager, auth);
    const rows = await listRequests(manager, query);
    return {
      items: rows.map(adminRequestView),
      siguienteAntesDeId: rows.length === query.limite
        ? rows[rows.length - 1].id_solicitud_credito : null,
    };
  }, { isolation: 'REPEATABLE READ' });
}

export async function getAdminCreditRequest(
  auth: AuthContext,
  requestId: number,
): Promise<{ solicitud: ReturnType<typeof adminRequestView> }> {
  return inTransaction(async (manager) => {
    await readAdmin(manager, auth);
    const row = await findRequestById(manager, requestId);
    if (!row) throw solicitudNoEncontrada();
    return { solicitud: adminRequestView(row) };
  }, { isolation: 'READ COMMITTED' });
}

export async function approveCreditRequest(
  auth: AuthContext,
  requestId: number,
  input: ApproveCreditRequest,
  key: string,
): Promise<CreditWorkflowResult> {
  const limitCents = parseCreditAmount(input.limiteAutorizado, false);
  if (limitCents === null) throw new CreditWorkflowError('LIMITE_INVALIDO', 400, 'El límite autorizado es inválido.');
  const limit = formatCreditAmount(limitCents);

  return inTransaction(async (manager) => {
    const clientId = await findRequestClientId(manager, requestId);
    if (clientId === null) throw solicitudNoEncontrada();

    // Cuenta primero, cuando existe, para compartir el orden de locks de FER-20.
    let account = await findAccountForUpdate(manager, clientId);
    const client = await findClientForUpdate(manager, clientId);
    if (!client) throw solicitudNoEncontrada();
    await lockAdmin(manager, auth);
    // CLIENTE serializa las escrituras de sus solicitudes. Leer bajo READ
    // COMMITTED evita bloquear al solicitante histórico a través del JOIN.
    const request = await findRequestById(manager, requestId);
    if (!request || request.id_cliente !== clientId) throw solicitudNoEncontrada();

    const replayEvent = await findEventByKey(manager, auth.id, key, true);
    if (replayEvent) {
      if (request.plazo_autorizado !== input.plazoDias) throw claveIdempotenciaReutilizada();
      return replay(replayEvent, 'SOLICITUD_APROBADA', {
        requestId, limit, motivo: input.motivo, evidencia: input.evidencia,
      });
    }

    if (request.estado !== 'PENDIENTE') throw solicitudNoPendiente();
    if (client.activo !== 1 || client.tipo_cliente !== 'EMPRESA'
      || client.estado_aprobacion_empresa !== 'APROBADA') {
      throw empresaNoAprobada();
    }
    if (!await hasActiveClientUser(manager, clientId)) throw clienteInactivo();
    if (account && isDemoAccount(account)) {
      throw new CreditWorkflowError('CUENTA_DEMO', 409, 'La cuenta DEMO no admite operaciones reales.');
    }

    const now = new Date();
    const fechaUtc = utcSql(now);
    const previousLimit = account?.limite_credito ?? null;

    if (account) {
      const state = await calcularEstadoCuenta(account.id_cuenta_corriente, manager, { lock: true });
      if (!state || state.deuda_vigente === null || state.utilizado === null) {
        throw estadoFinancieroNoDeterminable();
      }
      const used = parseDbAmount(state.utilizado, true);
      if (used === null) throw estadoFinancieroNoDeterminable();
      if (limitCents < used) throw limitePorDebajoDeDeuda();
      await applyApprovedTerms(manager, account.id_cuenta_corriente, {
        limite: limit,
        plazoDias: input.plazoDias,
        evidencia: input.evidencia,
      });
    } else {
      // Si la cuenta apareció antes de tomar CLIENTE, no invertir el orden
      // intentando bloquear una cuenta que checkout ya puede tener tomada.
      if (await findAccountByClient(manager, clientId)) throw conflictoConcurrencia();
      // MOVIMIENTO.fecha_efectiva tiene precisión de segundos. La cobertura de
      // alta se ancla al segundo para que el primer cargo no quede "antes".
      const coberturaDesdeUtc = now.toISOString().slice(0, 19).replace('T', ' ');
      const accountId = await createAccount(manager, {
        clienteId: clientId,
        limite: limit,
        plazoDias: input.plazoDias,
        evidencia: input.evidencia,
        coberturaDesdeUtc,
        solicitudId: requestId,
      });
      account = await findAccountForUpdate(manager, clientId);
      if (!account || account.id_cuenta_corriente !== accountId) throw conflictoConcurrencia();
    }

    const affected = await approveRequest(manager, {
      requestId,
      actorId: auth.id,
      cuentaId: account.id_cuenta_corriente,
      limite: limit,
      plazoDias: input.plazoDias,
      motivo: input.motivo,
      evidencia: input.evidencia,
      fechaUtc,
    });
    if (affected !== 1) throw solicitudNoPendiente();

    const updated = await findRequestById(manager, requestId);
    const accountAfter = await findAccountForUpdate(manager, clientId);
    if (!updated || !accountAfter) throw conflictoConcurrencia();
    const revision = await readAccountRevision(manager, accountAfter.id_cuenta_corriente);
    const data = {
      solicitud: adminRequestView(updated),
      cuenta: accountView(accountAfter),
    };
    const eventoId = await insertEvent(manager, {
      clienteId: clientId,
      solicitudId: requestId,
      cuentaId: accountAfter.id_cuenta_corriente,
      tipo: 'SOLICITUD_APROBADA',
      actorId: auth.id,
      rolActor: 'ADMIN',
      claveIdempotencia: key,
      estadoAnterior: 'PENDIENTE',
      estadoNuevo: 'APROBADA',
      limiteAnterior: previousLimit,
      limiteNuevo: limit,
      motivo: input.motivo,
      evidencia: input.evidencia,
      revisionCuenta: revision,
      fechaUtc,
      resultadoJson: JSON.stringify(data),
    });
    // La cuenta conserva su habilitación previa: aprobar no habilita por sí solo.
    return { data, eventoId, replay: false };
  }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
}

export async function rejectCreditRequest(
  auth: AuthContext,
  requestId: number,
  input: RejectCreditRequest,
  key: string,
): Promise<CreditWorkflowResult> {
  return inTransaction(async (manager) => {
    const clientId = await findRequestClientId(manager, requestId);
    if (clientId === null) throw solicitudNoEncontrada();
    const client = await findClientForUpdate(manager, clientId);
    if (!client) throw solicitudNoEncontrada();
    await lockAdmin(manager, auth);
    const request = await findRequestById(manager, requestId);
    if (!request || request.id_cliente !== clientId) throw solicitudNoEncontrada();

    const replayEvent = await findEventByKey(manager, auth.id, key, true);
    if (replayEvent) return replay(replayEvent, 'SOLICITUD_RECHAZADA', {
      requestId, motivo: input.motivo, evidencia: input.evidencia ?? null,
    });

    if (request.estado !== 'PENDIENTE') throw solicitudNoPendiente();

    const now = new Date();
    const fechaUtc = utcSql(now);
    const affected = await rejectRequest(manager, {
      requestId,
      actorId: auth.id,
      motivo: input.motivo,
      evidencia: input.evidencia ?? null,
      fechaUtc,
    });
    if (affected !== 1) throw solicitudNoPendiente();

    const updated = await findRequestById(manager, requestId);
    if (!updated) throw conflictoConcurrencia();
    const data = { solicitud: adminRequestView(updated) };
    const eventoId = await insertEvent(manager, {
      clienteId: clientId,
      solicitudId: requestId,
      cuentaId: null,
      tipo: 'SOLICITUD_RECHAZADA',
      actorId: auth.id,
      rolActor: 'ADMIN',
      claveIdempotencia: key,
      estadoAnterior: 'PENDIENTE',
      estadoNuevo: 'RECHAZADA',
      limiteAnterior: null,
      limiteNuevo: null,
      motivo: input.motivo,
      evidencia: input.evidencia ?? null,
      revisionCuenta: null,
      fechaUtc,
      resultadoJson: JSON.stringify(data),
    });
    return { data, eventoId, replay: false };
  }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
}

export async function enableCreditAccount(
  auth: AuthContext,
  clientId: number,
  input: EnableCreditAccount,
  key: string,
): Promise<CreditWorkflowResult> {
  return inTransaction(async (manager) => {
    const account = await findAccountForUpdate(manager, clientId);
    if (!account) throw cuentaNoEncontrada();
    const client = await findClientForUpdate(manager, clientId);
    if (!client) throw cuentaNoEncontrada();
    await lockAdmin(manager, auth);

    const replayEvent = await findEventByKey(manager, auth.id, key, true);
    if (replayEvent) {
      return replay(replayEvent, 'CUENTA_HABILITADA', {
        accountId: account.id_cuenta_corriente, evidencia: input.evidencia, motivo: input.motivo ?? null,
      });
    }

    if (isDemoAccount(account)) {
      throw new CreditWorkflowError('CUENTA_DEMO', 409, 'La cuenta DEMO no admite operaciones reales.');
    }
    if (client.activo !== 1 || client.tipo_cliente !== 'EMPRESA'
      || client.estado_aprobacion_empresa !== 'APROBADA') {
      throw empresaNoAprobada();
    }
    if (!await hasActiveClientUser(manager, clientId)) throw clienteInactivo();
    const missing = missingAccreditation(account);
    if (missing.length > 0) throw cuentaNoAcreditada(missing);
    const financial = await calcularEstadoCuenta(account.id_cuenta_corriente, manager, { lock: true });
    if (!financial || financial.deuda_vigente === null) {
      throw cuentaNoAcreditada(['estado_financiero']);
    }
    if (account.habilitada === 1) throw cuentaYaHabilitada();

    const now = new Date();
    const fechaUtc = utcSql(now);
    await setAccountEnabled(manager, account.id_cuenta_corriente, true);
    const updated = await findAccountForUpdate(manager, clientId);
    if (!updated) throw conflictoConcurrencia();
    const revision = await readAccountRevision(manager, updated.id_cuenta_corriente);
    const data = { cuenta: accountView(updated) };
    const eventoId = await insertEvent(manager, {
      clienteId: clientId,
      solicitudId: null,
      cuentaId: updated.id_cuenta_corriente,
      tipo: 'CUENTA_HABILITADA',
      actorId: auth.id,
      rolActor: 'ADMIN',
      claveIdempotencia: key,
      estadoAnterior: 'INHABILITADA',
      estadoNuevo: 'HABILITADA',
      limiteAnterior: updated.limite_credito,
      limiteNuevo: updated.limite_credito,
      motivo: input.motivo ?? null,
      evidencia: input.evidencia,
      revisionCuenta: revision,
      fechaUtc,
      resultadoJson: JSON.stringify(data),
    });
    return { data, eventoId, replay: false };
  }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
}

export async function disableCreditAccount(
  auth: AuthContext,
  clientId: number,
  input: DisableCreditAccount,
  key: string,
): Promise<CreditWorkflowResult> {
  return inTransaction(async (manager) => {
    const account = await findAccountForUpdate(manager, clientId);
    if (!account) throw cuentaNoEncontrada();
    const client = await findClientForUpdate(manager, clientId);
    if (!client) throw cuentaNoEncontrada();
    await lockAdmin(manager, auth);

    const replayEvent = await findEventByKey(manager, auth.id, key, true);
    if (replayEvent) {
      return replay(replayEvent, 'CUENTA_DESHABILITADA', {
        accountId: account.id_cuenta_corriente, motivo: input.motivo, evidencia: input.evidencia ?? null,
      });
    }

    if (isDemoAccount(account)) {
      throw new CreditWorkflowError('CUENTA_DEMO', 409, 'La cuenta DEMO no admite operaciones reales.');
    }
    if (account.habilitada === 0) throw cuentaYaDeshabilitada();

    const now = new Date();
    const fechaUtc = utcSql(now);
    await setAccountEnabled(manager, account.id_cuenta_corriente, false);
    const updated = await findAccountForUpdate(manager, clientId);
    if (!updated) throw conflictoConcurrencia();
    const revision = await readAccountRevision(manager, updated.id_cuenta_corriente);
    const data = { cuenta: accountView(updated) };
    const eventoId = await insertEvent(manager, {
      clienteId: clientId,
      solicitudId: null,
      cuentaId: updated.id_cuenta_corriente,
      tipo: 'CUENTA_DESHABILITADA',
      actorId: auth.id,
      rolActor: 'ADMIN',
      claveIdempotencia: key,
      estadoAnterior: 'HABILITADA',
      estadoNuevo: 'INHABILITADA',
      limiteAnterior: updated.limite_credito,
      limiteNuevo: updated.limite_credito,
      motivo: input.motivo,
      evidencia: input.evidencia ?? null,
      revisionCuenta: revision,
      fechaUtc,
      resultadoJson: JSON.stringify(data),
    });
    return { data, eventoId, replay: false };
  }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
}

export async function changeCreditLimit(
  auth: AuthContext,
  clientId: number,
  input: ChangeCreditLimit,
  key: string,
): Promise<CreditWorkflowResult> {
  const limitCents = parseCreditAmount(input.limite, true);
  if (limitCents === null) throw new CreditWorkflowError('LIMITE_INVALIDO', 400, 'El límite es inválido.');
  const limit = formatCreditAmount(limitCents);

  return inTransaction(async (manager) => {
    const account = await findAccountForUpdate(manager, clientId);
    if (!account) throw cuentaNoEncontrada();
    const client = await findClientForUpdate(manager, clientId);
    if (!client) throw cuentaNoEncontrada();
    await lockAdmin(manager, auth);

    const replayEvent = await findEventByKey(manager, auth.id, key, true);
    if (replayEvent) {
      return replay(replayEvent, 'LIMITE_MODIFICADO', {
        accountId: account.id_cuenta_corriente,
        limit,
        motivo: input.motivo,
        evidencia: input.evidencia,
      });
    }

    if (isDemoAccount(account)) {
      throw new CreditWorkflowError('CUENTA_DEMO', 409, 'La cuenta DEMO no admite operaciones reales.');
    }
    if (client.activo !== 1 || client.tipo_cliente !== 'EMPRESA'
      || client.estado_aprobacion_empresa !== 'APROBADA') {
      throw empresaNoAprobada();
    }

    const state = await calcularEstadoCuenta(account.id_cuenta_corriente, manager, { lock: true });
    if (!state || state.deuda_vigente === null || state.utilizado === null) {
      throw estadoFinancieroNoDeterminable();
    }
    const used = parseDbAmount(state.utilizado, true);
    if (used === null) throw estadoFinancieroNoDeterminable();
    if (limitCents < used) throw limitePorDebajoDeDeuda();

    const current = parseDbAmount(account.limite_credito, true);
    const unchanged = current !== null && current === limitCents
      && account.moneda_limite === 'USD' && Boolean(account.evidencia_limite?.trim());
    const now = new Date();
    const fechaUtc = utcSql(now);
    const previousLimit = account.limite_credito;
    let updated = account;
    if (!unchanged) {
      await updateAccountLimit(manager, account.id_cuenta_corriente, {
        limite: limit,
        evidencia: input.evidencia,
      });
      const row = await findAccountForUpdate(manager, clientId);
      if (!row) throw conflictoConcurrencia();
      updated = row;
    }
    const data = {
      cuenta: accountView(updated),
      limiteAnterior: previousLimit,
      limiteNuevo: limit,
      sinCambios: unchanged,
    };
    const eventoId = await insertEvent(manager, {
      clienteId: clientId,
      solicitudId: null,
      cuentaId: updated.id_cuenta_corriente,
      tipo: 'LIMITE_MODIFICADO',
      actorId: auth.id,
      rolActor: 'ADMIN',
      claveIdempotencia: key,
      estadoAnterior: accountStateName(account),
      estadoNuevo: accountStateName(updated),
      limiteAnterior: previousLimit,
      limiteNuevo: limit,
      motivo: input.motivo,
      evidencia: input.evidencia,
      revisionCuenta: updated.revision,
      fechaUtc,
      resultadoJson: JSON.stringify(data),
    });
    return { data, eventoId, replay: false };
  }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
}

export async function listCreditEvents(
  auth: AuthContext,
  query: CreditEventListQuery,
): Promise<{ items: ReturnType<typeof eventView>[]; siguienteAntesDeId: number | null }> {
  return inTransaction(async (manager) => {
    await readAdmin(manager, auth);
    const rows = await listEvents(manager, query);
    return {
      items: rows.map(eventView),
      siguienteAntesDeId: rows.length === query.limite
        ? Number(rows[rows.length - 1].id_evento_credito) : null,
    };
  }, { isolation: 'REPEATABLE READ' });
}
