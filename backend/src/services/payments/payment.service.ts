import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { inTransaction } from '../../config/database.config';
import {
  formatPaymentAmount,
  normalizePaymentIdempotencyKey,
  normalizeReceiptId,
  parsePaymentAmount,
  parsePaymentListQuery,
  type AccreditPayment,
  type DeclarePayment,
  type ReviewPayment,
} from '../../dtos/payments/payment.dto';
import { calcularEstadoCuenta, registrarAbonoPorPago } from '../../repositories/cuentaCorriente.repository';
import {
  findAccountIdForUser,
  findPaymentByAccreditationKey,
  findPaymentByDeclarationKey,
  findPaymentByReceipt,
  findPaymentDestination,
  insertDeclaration,
  listPayments,
  lockAccount,
  lockClient,
  lockPayment,
  lockReceiptForDeclaration,
  lockUser,
  paymentDto,
  updatePaymentAccreditation,
  updatePaymentReview,
} from '../../repositories/payment.repository';
import type { AuthContext } from '../../types/auth';
import {
  clienteInactivo,
  claveIdempotenciaReutilizada,
  comprobanteNoEncontrado,
  comprobanteYaDeclarado,
  conflictoConcurrencia,
  cuentaNoAcreditada,
  cuentaNoEncontrada,
  cuentaRestringida,
  invalidPaymentRequest,
  noAutenticado,
  pagoNoAcreditable,
  pagoNoEncontrado,
  pagoPendienteRevision,
  pagoYaAcreditado,
  pagoYaRevisado,
  sinPermiso,
} from './payment.errors';

export interface PaymentResult {
  data: Record<string, unknown>;
  replay: boolean;
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const isDuplicateEntry = (error: unknown): boolean => {
  const candidate = (error && typeof error === 'object' ? error : {}) as {
    code?: string; driverError?: { code?: string };
  };
  return candidate.code === 'ER_DUP_ENTRY' || candidate.driverError?.code === 'ER_DUP_ENTRY';
};

function amountAndCurrency(input: DeclarePayment) {
  const cents = parsePaymentAmount(input.monto);
  if (cents === null) throw invalidPaymentRequest('El importe debe ser una cadena decimal mayor a cero con hasta dos decimales.');
  if (input.moneda !== 'USD' && input.moneda !== 'ARS') throw invalidPaymentRequest('La moneda debe ser USD o ARS.');
  const receiptId = normalizeReceiptId(input.comprobanteId);
  if (!receiptId) throw invalidPaymentRequest('Indicá un comprobante válido.');
  const observations = typeof input.observaciones === 'string'
    ? input.observaciones.trim() || null
    : null;
  return {
    amount: formatPaymentAmount(cents),
    currency: input.moneda,
    receiptId,
    observations,
  };
}

async function lockClientContext(manager: EntityManager, auth: AuthContext) {
  if (auth.rol !== 'CLIENTE') throw sinPermiso();
  const accountId = await findAccountIdForUser(manager, auth.id);
  if (accountId === null) throw cuentaNoEncontrada();
  const account = await lockAccount(manager, accountId);
  if (!account) throw cuentaNoEncontrada();
  const client = await lockClient(manager, account.id_cliente);
  if (!client) throw cuentaNoEncontrada();
  const user = await lockUser(manager, auth.id);
  if (!user || user.activo !== 1) throw noAutenticado();
  if (user.rol !== 'CLIENTE' || user.id_cliente !== client.id_cliente) throw sinPermiso();
  if (client.activo !== 1) throw clienteInactivo();
  if (client.tipo_cliente !== 'EMPRESA') throw cuentaNoEncontrada();
  if (account.origen_datos === 'DEMO' && process.env.NODE_ENV !== 'test') throw cuentaRestringida();
  return { account, client, user };
}

async function lockActiveAdmin(manager: EntityManager, auth: AuthContext) {
  if (auth.rol !== 'ADMIN') throw sinPermiso();
  const user = await lockUser(manager, auth.id);
  if (!user || user.activo !== 1) throw noAutenticado();
  if (user.rol !== 'ADMIN' || user.id_cliente !== null) throw sinPermiso();
  return user;
}

async function readActiveAdmin(manager: EntityManager, auth: AuthContext) {
  if (auth.rol !== 'ADMIN') throw sinPermiso();
  const [user] = await manager.query(
    'SELECT id_usuario, id_cliente, rol, activo FROM USUARIO WHERE id_usuario = ?',
    [auth.id],
  );
  if (!user || user.activo !== 1) throw noAutenticado();
  if (user.rol !== 'ADMIN' || user.id_cliente !== null) throw sinPermiso();
  return user;
}

async function readClientId(manager: EntityManager, auth: AuthContext): Promise<number> {
  if (auth.rol !== 'CLIENTE') throw sinPermiso();
  const [user] = await manager.query(
    'SELECT id_usuario, id_cliente, rol, activo FROM USUARIO WHERE id_usuario = ?',
    [auth.id],
  );
  if (!user || user.activo !== 1) throw noAutenticado();
  if (user.rol !== 'CLIENTE' || user.id_cliente === null) throw sinPermiso();
  const [client] = await manager.query(
    'SELECT id_cliente, tipo_cliente, activo FROM CLIENTE WHERE id_cliente = ?',
    [user.id_cliente],
  );
  if (!client || client.activo !== 1) throw clienteInactivo();
  if (client.tipo_cliente !== 'EMPRESA') throw cuentaNoEncontrada();
  const [account] = await manager.query(
    'SELECT id_cuenta_corriente, origen_datos FROM CUENTA_CORRIENTE WHERE id_cliente = ?',
    [client.id_cliente],
  );
  if (!account) throw cuentaNoEncontrada();
  if (account.origen_datos === 'DEMO' && process.env.NODE_ENV !== 'test') throw cuentaRestringida();
  return Number(client.id_cliente);
}

async function replayOrConflict(
  manager: EntityManager,
  clientId: number | null,
  paymentId: number,
  replay: boolean,
): Promise<PaymentResult> {
  const data = await paymentDto(manager, paymentId, clientId);
  if (!data) throw conflictoConcurrencia();
  return { data, replay };
}

export async function declarePayment(
  auth: AuthContext,
  input: DeclarePayment,
  keyValue: unknown,
): Promise<PaymentResult> {
  const key = normalizePaymentIdempotencyKey(keyValue);
  if (!key) throw invalidPaymentRequest('La cabecera Idempotency-Key es obligatoria y debe ser un UUID v4.');
  const { amount, currency, receiptId, observations } = amountAndCurrency(input);

  try {
    return await inTransaction(async manager => {
      const { account, client, user } = await lockClientContext(manager, auth);
      const hash = digest([
        'DECLARACION_PAGO', account.id_cuenta_corriente, user.id_usuario,
        amount, currency, receiptId, observations,
      ]);

      const existing = await findPaymentByDeclarationKey(
        manager, account.id_cuenta_corriente, key, true,
      );
      if (existing) {
        if (existing.huella_declaracion !== hash) throw claveIdempotenciaReutilizada();
        return replayOrConflict(manager, client.id_cliente, Number(existing.id_pago), true);
      }

      const receipt = await lockReceiptForDeclaration(
        manager, receiptId, client.id_cliente, account.id_cuenta_corriente,
      );
      if (!receipt) throw comprobanteNoEncontrado();

      const duplicate = await findPaymentByReceipt(manager, receiptId);
      if (duplicate) {
        if (duplicate.huella_declaracion === hash
          && Number(duplicate.id_cuenta_corriente) === Number(account.id_cuenta_corriente)) {
          return replayOrConflict(manager, client.id_cliente, Number(duplicate.id_pago), true);
        }
        throw comprobanteYaDeclarado();
      }

      const paymentId = await insertDeclaration(manager, {
        accountId: account.id_cuenta_corriente,
        clientId: client.id_cliente,
        userId: user.id_usuario,
        receiptId,
        amount,
        currency,
        hash,
        key,
        observations,
      });
      return replayOrConflict(manager, client.id_cliente, paymentId, false);
    }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
  } catch (error) {
    if (!isDuplicateEntry(error)) throw error;
    return recoverDeclaration(auth, amount, currency, receiptId, observations, key);
  }
}

async function recoverDeclaration(
  auth: AuthContext,
  amount: string,
  currency: 'USD' | 'ARS',
  receiptId: string,
  observations: string | null,
  key: string,
): Promise<PaymentResult> {
  return inTransaction(async manager => {
    const { account, client, user } = await lockClientContext(manager, auth);
    const hash = digest([
      'DECLARACION_PAGO', account.id_cuenta_corriente, user.id_usuario,
      amount, currency, receiptId, observations,
    ]);
    const existing = await findPaymentByDeclarationKey(
      manager, account.id_cuenta_corriente, key, true,
    );
    if (existing) {
      if (existing.huella_declaracion !== hash) throw claveIdempotenciaReutilizada();
      return replayOrConflict(manager, client.id_cliente, Number(existing.id_pago), true);
    }
    const duplicate = await findPaymentByReceipt(manager, receiptId);
    if (duplicate) {
      if (duplicate.huella_declaracion === hash
        && Number(duplicate.id_cuenta_corriente) === Number(account.id_cuenta_corriente)) {
        return replayOrConflict(manager, client.id_cliente, Number(duplicate.id_pago), true);
      }
      throw comprobanteYaDeclarado();
    }
    throw conflictoConcurrencia();
  }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
}

export async function reviewPayment(
  auth: AuthContext,
  paymentId: number,
  input: ReviewPayment,
): Promise<PaymentResult> {
  const decision = input.decision === 'VALIDADO' ? 'APROBADO' : input.decision;
  const reason = typeof input.motivo === 'string' ? input.motivo.trim() || null : null;
  if (decision === 'RECHAZADO' && !reason) {
    throw invalidPaymentRequest('El motivo es obligatorio para rechazar la declaración.');
  }

  return inTransaction(async manager => {
    const destination = await findPaymentDestination(manager, paymentId);
    if (!destination || destination.accountId === null || destination.orderId !== null) throw pagoNoEncontrado();
    const account = await lockAccount(manager, destination.accountId);
    if (!account) throw pagoNoEncontrado();
    if (account.origen_datos === 'DEMO' && process.env.NODE_ENV !== 'test') throw cuentaRestringida();
    const client = await lockClient(manager, account.id_cliente);
    if (!client) throw pagoNoEncontrado();
    const admin = await lockActiveAdmin(manager, auth);
    const payment = await lockPayment(manager, paymentId);
    if (!payment
      || Number(payment.id_cuenta_corriente) !== Number(destination.accountId)
      || payment.id_pedido !== null) throw pagoNoEncontrado();

    if (payment.estado === 'ACREDITADO') throw pagoYaAcreditado();
    if (payment.estado === 'ANULADO') throw pagoNoAcreditable('El pago está anulado.');
    if (payment.estado === 'RECHAZADO' || payment.estado_documental === 'RECHAZADO') {
      if (decision === 'RECHAZADO' && payment.motivo_revision === reason) {
        return replayOrConflict(manager, null, paymentId, true);
      }
      throw pagoYaRevisado();
    }
    if (payment.estado_documental === 'APROBADO') {
      if (decision === 'APROBADO') return replayOrConflict(manager, null, paymentId, true);
      throw pagoYaRevisado();
    }
    if (payment.estado !== 'PENDIENTE') throw pagoNoAcreditable();

    await updatePaymentReview(manager, {
      paymentId,
      financialState: decision === 'RECHAZADO' ? 'RECHAZADO' : 'PENDIENTE',
      documentState: decision,
      adminId: admin.id_usuario,
      reason: decision === 'RECHAZADO' ? reason : null,
    });
    return replayOrConflict(manager, null, paymentId, false);
  }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
}

function mapAccreditationError(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  if (/cobertura histórica/i.test(message)) throw cuentaNoAcreditada();
  if (/DEMO|sintétic/i.test(message)) throw cuentaRestringida();
  if (/Cotización|CALENDARIO|tasa|moneda|acreditación|Importe USD/i.test(message)) {
    throw pagoNoAcreditable('No se pudo validar el importe, la moneda o la cotización del pago.');
  }
  if (/reutilizado|Duplicate entry|uq_movimiento/i.test(message)) throw conflictoConcurrencia();
  throw error;
}

export async function accreditPayment(
  auth: AuthContext,
  paymentId: number,
  input: AccreditPayment,
  keyValue: unknown,
): Promise<PaymentResult> {
  const key = normalizePaymentIdempotencyKey(keyValue);
  if (!key) throw invalidPaymentRequest('La cabecera Idempotency-Key es obligatoria y debe ser un UUID v4.');
  const evidence = typeof input.evidencia === 'string' ? input.evidencia.trim() : '';
  if (!evidence || evidence.length > 1000) {
    throw invalidPaymentRequest('La evidencia de acreditación es obligatoria y debe contener hasta 1000 caracteres.');
  }
  const hash = digest(['ACREDITACION_PAGO', paymentId, auth.id, evidence]);

  return inTransaction(async manager => {
    const destination = await findPaymentDestination(manager, paymentId);
    if (!destination || destination.accountId === null || destination.orderId !== null) throw pagoNoEncontrado();
    const account = await lockAccount(manager, destination.accountId);
    if (!account) throw pagoNoEncontrado();
    const client = await lockClient(manager, account.id_cliente);
    if (!client || client.activo !== 1) throw clienteInactivo();
    const admin = await lockActiveAdmin(manager, auth);
    const payment = await lockPayment(manager, paymentId);
    if (!payment
      || Number(payment.id_cuenta_corriente) !== Number(destination.accountId)
      || payment.id_pedido !== null) throw pagoNoEncontrado();

    if (payment.estado === 'ACREDITADO') {
      if (payment.clave_acreditacion === key) {
        if (payment.huella_acreditacion === hash) return replayOrConflict(manager, null, paymentId, true);
        throw claveIdempotenciaReutilizada();
      }
      throw pagoYaAcreditado();
    }
    if (payment.estado !== 'PENDIENTE') throw pagoNoAcreditable();
    if (payment.estado_documental !== 'APROBADO') throw pagoPendienteRevision();
    if (payment.moneda !== 'USD' && payment.moneda !== 'ARS') {
      throw pagoNoAcreditable('El pago no tiene una moneda acreditable.');
    }

    const keyOwner = await findPaymentByAccreditationKey(
      manager, account.id_cuenta_corriente, key,
    );
    if (keyOwner && Number(keyOwner.id_pago) !== paymentId) throw claveIdempotenciaReutilizada();

    if (account.origen_datos === 'DEMO' && process.env.NODE_ENV !== 'test') throw cuentaRestringida();
    const state = await calcularEstadoCuenta(account.id_cuenta_corriente, manager, { lock: true });
    if (!state) throw cuentaNoEncontrada();
    if (state.libro_mixto) throw cuentaRestringida();
    if (state.cobertura !== 'COMPLETA') throw cuentaNoAcreditada();

    await updatePaymentAccreditation(manager, {
      paymentId,
      adminId: admin.id_usuario,
      key,
      hash,
      evidence,
    });

    try {
      await registrarAbonoPorPago({
        id_cuenta_corriente: account.id_cuenta_corriente,
        id_pago: paymentId,
        origen: 'PAGO',
        observaciones: payment.observaciones ?? null,
        autorizado_por: String(admin.id_usuario),
      }, manager);
    } catch (error) {
      mapAccreditationError(error);
    }

    return replayOrConflict(manager, null, paymentId, false);
  }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
}

export async function getClientPayment(auth: AuthContext, paymentId: number) {
  return inTransaction(async manager => {
    const clientId = await readClientId(manager, auth);
    const data = await paymentDto(manager, paymentId, clientId);
    if (!data) throw pagoNoEncontrado();
    return data;
  }, { isolation: 'REPEATABLE READ' });
}

export async function listClientPayments(auth: AuthContext, url: string) {
  const query = parsePaymentListQuery(url);
  return inTransaction(async manager => {
    const clientId = await readClientId(manager, auth);
    return listPayments(manager, clientId, query.pagina);
  }, { isolation: 'REPEATABLE READ' });
}

export async function getAdminPayment(auth: AuthContext, paymentId: number) {
  return inTransaction(async manager => {
    await readActiveAdmin(manager, auth);
    const data = await paymentDto(manager, paymentId, null, process.env.NODE_ENV === 'test');
    if (!data) throw pagoNoEncontrado();
    return data;
  }, { isolation: 'REPEATABLE READ' });
}

export async function listAdminPayments(auth: AuthContext, url: string) {
  const query = parsePaymentListQuery(url);
  return inTransaction(async manager => {
    await readActiveAdmin(manager, auth);
    return listPayments(manager, null, query.pagina, process.env.NODE_ENV === 'test');
  }, { isolation: 'REPEATABLE READ' });
}
