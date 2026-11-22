import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { inTransaction } from '../../config/database.config';
import {
  formatPaymentAmount,
  normalizePaymentIdempotencyKey,
  normalizeReceiptId,
  parsePaymentAmount,
  parsePaymentListQuery,
  parseUtcIsoTimestamp,
  type AccreditPayment,
  type DeclarePayment,
  type ReviewPayment,
} from '../../dtos/payments/payment.dto';
import { calcularEstadoCuenta, registrarAbonoPorPago } from '../../repositories/cuentaCorriente.repository';
import { loadAccountQuote } from '../../repositories/cuentaCorriente.quote';
import {
  findPaymentIdempotency,
  insertPaymentIdempotency,
} from '../../repositories/adminPayment.repository';
import {
  accreditPaymentPayloadHash,
  matchesAccreditIdempotencyPayload,
} from './admin-payment.service';
import {
  findAccountIdForUser,
  findPaymentByAccreditationKey,
  findPaymentByAnyKey,
  findPaymentByDeclarationKey,
  findPaymentByReceipt,
  findPaymentDestination,
  insertDeclaration,
  listPayments,
  lockAccount,
  lockClient,
  lockPayment,
  lockPaymentReceipt,
  lockReceiptForDeclaration,
  lockUser,
  paymentDto,
  updatePaymentAccreditation,
  updatePaymentReview,
} from '../../repositories/payment.repository';
import type { AuthContext } from '../../types/auth';
import { PricingError } from '../pricing/money';
import {
  clienteInactivo,
  claveIdempotenciaReutilizada,
  comprobanteNoEncontrado,
  comprobanteYaDeclarado,
  conflictoConcurrencia,
  cotizacionAusente,
  cotizacionInvalida,
  cuentaNoAcreditada,
  cuentaNoEncontrada,
  cuentaRestringida,
  importeUsdInvalido,
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

const sqlUtc = (date: Date): string =>
  date.toISOString().slice(0, 23).replace('T', ' ');

async function assertPaymentReceipt(
  manager: EntityManager,
  payment: { id_comprobante: string | null },
  paymentId: number,
  accountId: number,
  clientId: number,
): Promise<void> {
  if (!payment.id_comprobante) throw comprobanteNoEncontrado();
  const receipt = await lockPaymentReceipt(manager, paymentId);
  if (!receipt || !receipt.id_comprobante) throw comprobanteNoEncontrado();
  if (Number(receipt.id_cliente) !== Number(clientId)
    || Number(receipt.id_cuenta_corriente) !== Number(accountId)) {
    throw comprobanteNoEncontrado();
  }
  if (receipt.id_pedido !== null
    && (receipt.pedido_id === null
      || Number(receipt.pedido_cliente) !== Number(receipt.id_cliente)
      || receipt.modalidad_pago !== 'CUENTA_CORRIENTE')) {
    throw comprobanteNoEncontrado();
  }
}

async function resolveAccreditation(
  manager: EntityManager,
  payment: { monto: string; moneda: string | null },
  account: { origen_datos: string },
  accreditedAt: Date,
): Promise<{ montoUsd: string; idCotizacion: number | null; tasaHistorica: string | null }> {
  const cents = parsePaymentAmount(payment.monto);
  if (cents === null) throw importeUsdInvalido();
  if (payment.moneda === 'USD') {
    return { montoUsd: formatPaymentAmount(cents), idCotizacion: null, tasaHistorica: null };
  }
  if (payment.moneda !== 'ARS') throw pagoNoAcreditable('El pago no tiene una moneda acreditable.');

  let quote: Awaited<ReturnType<typeof loadAccountQuote>>;
  try {
    quote = await loadAccountQuote(manager, accreditedAt);
  } catch (error) {
    mapAccreditationError(error);
  }
  if (quote.sintetica && account.origen_datos !== 'DEMO') throw cuentaRestringida();
  const rate = BigInt(quote.valor.replace('.', ''));
  if (rate <= 0n) throw cotizacionInvalida();
  const usd = (cents * 100000000n + rate / 2n) / rate;
  if (usd <= 0n) throw importeUsdInvalido();
  return {
    montoUsd: formatPaymentAmount(usd),
    idCotizacion: Number(quote.id),
    tasaHistorica: quote.valor,
  };
}

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
      const hash = digest({
        operacion: 'DECLARAR',
        cuentaCorrienteId: account.id_cuenta_corriente,
        usuarioId: user.id_usuario,
        monto: amount,
        moneda: currency,
        comprobanteId: receiptId,
        observaciones: observations,
      });

      const idempotency = await findPaymentIdempotency(manager, key);
      if (idempotency) {
        if (idempotency.operacion !== 'DECLARAR' || idempotency.payload_hash !== hash) {
          throw claveIdempotenciaReutilizada();
        }
        return replayOrConflict(manager, client.id_cliente, idempotency.id_pago, true);
      }

      const existing = await findPaymentByDeclarationKey(
        manager, account.id_cuenta_corriente, key, true,
      );
      if (existing) {
        if (existing.huella_declaracion !== hash) throw claveIdempotenciaReutilizada();
        return replayOrConflict(manager, client.id_cliente, Number(existing.id_pago), true);
      }

      if (await findPaymentByAnyKey(manager, key, 0)) throw claveIdempotenciaReutilizada();

      // Un libro mixto o sintético no puede generar pagos que luego quedarían
      // invisibles en los listados restringidos.
      const state = await calcularEstadoCuenta(account.id_cuenta_corriente, manager, { lock: true });
      if (!state) throw cuentaNoEncontrada();
      if (state.libro_mixto) throw cuentaRestringida();

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

      await insertPaymentIdempotency(manager, {
        claveIdempotencia: key,
        pagoId: paymentId,
        operacion: 'DECLARAR',
        payloadHash: hash,
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
    const hash = digest({
      operacion: 'DECLARAR',
      cuentaCorrienteId: account.id_cuenta_corriente,
      usuarioId: user.id_usuario,
      monto: amount,
      moneda: currency,
      comprobanteId: receiptId,
      observaciones: observations,
    });
    const idempotency = await findPaymentIdempotency(manager, key);
    if (idempotency) {
      if (idempotency.operacion !== 'DECLARAR' || idempotency.payload_hash !== hash) {
        throw claveIdempotenciaReutilizada();
      }
      return replayOrConflict(manager, client.id_cliente, idempotency.id_pago, true);
    }
    const existing = await findPaymentByDeclarationKey(
      manager, account.id_cuenta_corriente, key, true,
    );
    if (existing) {
      if (existing.huella_declaracion !== hash) throw claveIdempotenciaReutilizada();
      return replayOrConflict(manager, client.id_cliente, Number(existing.id_pago), true);
    }
    if (await findPaymentByAnyKey(manager, key, 0)) throw claveIdempotenciaReutilizada();
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
  keyValue?: unknown,
): Promise<PaymentResult> {
  const decision = input.decision === 'VALIDADO' ? 'APROBADO' : input.decision;
  const reason = typeof input.motivo === 'string' ? input.motivo.trim() || null : null;
  if (decision === 'RECHAZADO' && !reason) {
    throw invalidPaymentRequest('El motivo es obligatorio para rechazar la declaración.');
  }
  let key: string | null = null;
  if (keyValue !== undefined) {
    key = normalizePaymentIdempotencyKey(keyValue);
    if (!key) {
      throw invalidPaymentRequest('La cabecera Idempotency-Key debe ser un UUID v4.');
    }
  }
  const payloadHash = digest({
    operacion: 'REVISAR_PAGO',
    pagoId: paymentId,
    decision,
    motivo: decision === 'RECHAZADO' ? reason : null,
  });

  try {
    return await inTransaction(async manager => {
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

      if (key !== null) {
        const idempotency = await findPaymentIdempotency(manager, key);
        if (idempotency) {
          if (
            idempotency.operacion !== 'REVISAR_PAGO'
            || idempotency.id_pago !== paymentId
            || idempotency.payload_hash !== payloadHash
          ) {
            throw claveIdempotenciaReutilizada();
          }
          return replayOrConflict(manager, null, paymentId, true);
        }
        if (await findPaymentByAnyKey(manager, key, 0)) throw claveIdempotenciaReutilizada();
      }

      if (payment.estado === 'ACREDITADO') throw pagoYaAcreditado();
      if (payment.estado === 'ANULADO') throw pagoNoAcreditable('El pago está anulado.');
      if (payment.estado === 'RECHAZADO' || payment.estado_documental === 'RECHAZADO') {
        if (decision === 'RECHAZADO' && payment.motivo_revision === reason) {
          return replayOrConflict(manager, null, paymentId, true);
        }
        throw pagoYaRevisado();
      }
      if (payment.estado_documental === 'APROBADO' && decision === 'APROBADO') {
        return replayOrConflict(manager, null, paymentId, true);
      }
      if (payment.estado !== 'PENDIENTE') throw pagoNoAcreditable();

      await assertPaymentReceipt(
        manager, payment, paymentId, account.id_cuenta_corriente, client.id_cliente,
      );

      await updatePaymentReview(manager, {
        paymentId,
        financialState: decision === 'RECHAZADO' ? 'RECHAZADO' : 'PENDIENTE',
        documentState: decision,
        adminId: admin.id_usuario,
        reason: decision === 'RECHAZADO' ? reason : null,
      });

      if (key !== null) {
        await insertPaymentIdempotency(manager, {
          claveIdempotencia: key,
          pagoId: paymentId,
          operacion: 'REVISAR_PAGO',
          payloadHash,
        });
      }

      return replayOrConflict(manager, null, paymentId, false);
    }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
  } catch (error) {
    if (key !== null && isDuplicateEntry(error)) {
      return inTransaction(async manager => {
        await readActiveAdmin(manager, auth);
        const idempotency = await findPaymentIdempotency(manager, key!);
        if (idempotency) {
          if (
            idempotency.operacion !== 'REVISAR_PAGO'
            || idempotency.id_pago !== paymentId
            || idempotency.payload_hash !== payloadHash
          ) {
            throw claveIdempotenciaReutilizada();
          }
          return replayOrConflict(manager, null, paymentId, true);
        }
        throw claveIdempotenciaReutilizada();
      }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
    }
    throw error;
  }
}

function mapAccreditationError(error: unknown): never {
  if (error instanceof PricingError) {
    if (error.code === 'COTIZACION_AUSENTE') throw cotizacionAusente();
    throw cotizacionInvalida();
  }
  const message = error instanceof Error ? error.message : '';
  // Prioridad: restricciones de libro antes que cualquier coincidencia textual
  // con "cotización" o "DEMO".
  if (/libro mixto|procedencia del libro|DEMO|sintétic/i.test(message)) throw cuentaRestringida();
  if (/cobertura histórica/i.test(message)) throw cuentaNoAcreditada();
  if (/S704_PAGO_COTIZACION_NO_VERIFICADA|COTIZACION_AUSENTE|CALENDARIO_NO_VERIFICADO/i.test(message)) {
    throw cotizacionAusente();
  }
  if (/COTIZACION_INVALIDA|Cotización|tasa_historica|tasa histórica/i.test(message)) {
    throw cotizacionInvalida();
  }
  if (/S704_PAGO_ARS_REQUIERE_FER17/i.test(message)) throw cotizacionAusente();
  if (/S704_PAGO_CONVERSION_INVALIDA|Importe USD distinto|no positivo|fuera de rango/i.test(message)) {
    throw importeUsdInvalido();
  }
  if (/S704_PAGO_ACREDITACION_INCOMPLETA|moneda/i.test(message)) {
    throw pagoNoAcreditable('No se pudo validar el importe, la moneda o la cotización del pago.');
  }
  if (/reutilizado|Duplicate entry|uq_movimiento/i.test(message)) throw conflictoConcurrencia();
  // Un error de infraestructura desconocido no se degrada a error funcional.
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
  const evidence = (typeof input.evidencia === 'string' ? input.evidencia : input.evidenciaAcreditacion ?? '').trim();
  if (!evidence || evidence.length > 1000) {
    throw invalidPaymentRequest('La evidencia de acreditación es obligatoria y debe contener hasta 1000 caracteres.');
  }
  const requestedAt = input.fechaAcreditacionUtc
    ? parseUtcIsoTimestamp(input.fechaAcreditacionUtc) : null;
  if (input.fechaAcreditacionUtc && !requestedAt) {
    throw invalidPaymentRequest('La fecha de acreditación UTC es inválida.');
  }
  const accreditedAt = requestedAt ?? new Date();
  if (accreditedAt.getTime() > Date.now()) {
    throw invalidPaymentRequest('La fecha de acreditación UTC no puede estar en el futuro.');
  }
  const normalizedRequestedDateIso = requestedAt ? requestedAt.toISOString() : null;
  const hash = accreditPaymentPayloadHash(
    paymentId,
    evidence,
    normalizedRequestedDateIso,
    input.observaciones ?? null,
  );

  try {
    return await inTransaction(async manager => {
      const destination = await findPaymentDestination(manager, paymentId);
      if (!destination || destination.accountId === null || destination.orderId !== null) throw pagoNoEncontrado();
      const account = await lockAccount(manager, destination.accountId);
      if (!account) throw pagoNoEncontrado();
      const client = await lockClient(manager, account.id_cliente);
      if (!client) throw pagoNoEncontrado();
      const admin = await lockActiveAdmin(manager, auth);
      const payment = await lockPayment(manager, paymentId);
      if (!payment
        || Number(payment.id_cuenta_corriente) !== Number(destination.accountId)
        || payment.id_pedido !== null) throw pagoNoEncontrado();

      const lockedAdminAccreditationId =
        payment.id_admin_acreditacion !== null && payment.id_admin_acreditacion !== undefined
          ? Number(payment.id_admin_acreditacion)
          : null;
      const lockedFechaAcreditacionIso =
        payment.acreditacion_iso !== null && payment.acreditacion_iso !== undefined
          ? new Date(String(payment.acreditacion_iso)).toISOString()
          : null;
      const lockedEvidenciaAcreditacion =
        payment.evidencia_acreditacion !== null && payment.evidencia_acreditacion !== undefined
          ? String(payment.evidencia_acreditacion)
          : null;

      const idempotency = await findPaymentIdempotency(manager, key);
      if (idempotency) {
        if (
          idempotency.operacion !== 'ACREDITAR'
          || idempotency.id_pago !== paymentId
          || !matchesAccreditIdempotencyPayload({
            storedHash: idempotency.payload_hash,
            pagoId: paymentId,
            actorId: Number(admin.id_usuario),
            evidence,
            normalizedRequestedDateIso,
            observaciones: input.observaciones,
            lockedAdminAccreditationId,
            lockedFechaAcreditacionIso,
            lockedEvidenciaAcreditacion,
          })
        ) {
          throw claveIdempotenciaReutilizada();
        }
        return replayOrConflict(manager, null, paymentId, true);
      }

      if (payment.estado === 'ACREDITADO') {
        if (payment.clave_acreditacion === key || payment.clave_idempotencia_acreditacion === key) {
          if (
            typeof payment.huella_acreditacion === 'string' &&
            matchesAccreditIdempotencyPayload({
              storedHash: payment.huella_acreditacion,
              pagoId: paymentId,
              actorId: Number(admin.id_usuario),
              evidence,
              normalizedRequestedDateIso,
              observaciones: input.observaciones,
              lockedAdminAccreditationId,
              lockedFechaAcreditacionIso,
              lockedEvidenciaAcreditacion,
            })
          ) {
            return replayOrConflict(manager, null, paymentId, true);
          }
          throw claveIdempotenciaReutilizada();
        }
        throw pagoYaAcreditado();
      }
      if (payment.estado !== 'PENDIENTE') throw pagoNoAcreditable();
      if (payment.estado_documental !== 'APROBADO') throw pagoPendienteRevision();

      await assertPaymentReceipt(
        manager, payment, paymentId, account.id_cuenta_corriente, client.id_cliente,
      );

      const keyOwner = await findPaymentByAccreditationKey(
        manager, account.id_cuenta_corriente, key,
      );
      if (keyOwner && Number(keyOwner.id_pago) !== paymentId) throw claveIdempotenciaReutilizada();
      if (await findPaymentByAnyKey(manager, key, paymentId)) throw claveIdempotenciaReutilizada();

      if (account.origen_datos === 'DEMO' && process.env.NODE_ENV !== 'test') throw cuentaRestringida();
      const state = await calcularEstadoCuenta(account.id_cuenta_corriente, manager, { lock: true });
      if (!state) throw cuentaNoEncontrada();
      if (state.libro_mixto) throw cuentaRestringida();
      if (state.cobertura !== 'COMPLETA') throw cuentaNoAcreditada();

      // La conversión FER17-v1 se resuelve antes de tocar PAGO. Si falta o es
      // inválida, la transacción no deja ni pago parcial ni movimiento.
      const conversion = await resolveAccreditation(manager, payment, account, accreditedAt);

      try {
        await updatePaymentAccreditation(manager, {
          paymentId,
          adminId: admin.id_usuario,
          key,
          hash,
          evidence,
          montoUsd: conversion.montoUsd,
          idCotizacion: conversion.idCotizacion,
          tasaHistorica: conversion.tasaHistorica,
          accreditedAt: sqlUtc(accreditedAt),
        });
      } catch (error) {
        mapAccreditationError(error);
      }

      await insertPaymentIdempotency(manager, {
        claveIdempotencia: key,
        pagoId: paymentId,
        operacion: 'ACREDITAR',
        payloadHash: hash,
      });

      try {
        await registrarAbonoPorPago({
          id_cuenta_corriente: account.id_cuenta_corriente,
          id_pago: paymentId,
          monto: conversion.montoUsd,
          origen: 'PAGO',
          observaciones: input.observaciones ?? payment.observaciones ?? null,
          autorizado_por: String(admin.id_usuario),
        }, manager);
      } catch (error) {
        mapAccreditationError(error);
      }

      return replayOrConflict(manager, null, paymentId, false);
    }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
  } catch (error) {
    if (isDuplicateEntry(error)) {
      return inTransaction(async manager => {
        await readActiveAdmin(manager, auth);
        const idempotency = await findPaymentIdempotency(manager, key);
        if (idempotency) {
          if (
            idempotency.operacion !== 'ACREDITAR'
            || idempotency.id_pago !== paymentId
            || idempotency.payload_hash !== hash
          ) {
            throw claveIdempotenciaReutilizada();
          }
          return replayOrConflict(manager, null, paymentId, true);
        }
        throw claveIdempotenciaReutilizada();
      }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
    }
    throw error;
  }
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
    const data = await paymentDto(manager, paymentId, null);
    if (!data) throw pagoNoEncontrado();
    return data;
  }, { isolation: 'REPEATABLE READ' });
}

export async function listAdminPayments(auth: AuthContext, url: string) {
  const query = parsePaymentListQuery(url);
  return inTransaction(async manager => {
    await readActiveAdmin(manager, auth);
    return listPayments(manager, null, query.pagina);
  }, { isolation: 'REPEATABLE READ' });
}
