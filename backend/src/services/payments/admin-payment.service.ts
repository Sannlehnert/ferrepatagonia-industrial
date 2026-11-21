import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { inTransaction } from '../../config/database.config';
import {
  formatPaymentAmount,
  MAX_PAYMENT_CENTS,
  parsePaymentAmount,
  parseUtcIsoTimestamp,
  type AccreditAdminPaymentDto,
  type AdminPaymentListQuery,
  type CloseAdminPaymentDto,
  type CreateAdminPaymentDto,
} from '../../dtos/payments/admin-payment.dto';
import {
  notifyAfterCommit,
  type CommittedChange,
  type NotifyCommittedChange,
} from '../../realtime/committed-change';
import {
  findLinkedAccountAbonoForUpdate,
  findPaymentByAnyKey,
  findPaymentById,
  findPaymentIdempotency,
  insertPayment,
  insertPaymentIdempotency,
  listPayments,
  lockAccountById,
  lockClientById,
  lockOrderById,
  lockPaymentById,
  markPaymentAccredited,
  markPaymentClosed,
  probePaymentDestination,
  readAdminActor,
  readCurrentAccountRevision,
  utcSql,
  type AdminPaymentRow,
  type PaymentIdempotencyOperation,
} from '../../repositories/adminPayment.repository';
import { loadAccountQuote } from '../../repositories/cuentaCorriente.quote';
import {
  anularMovimiento,
  registrarAbonoPorPago,
} from '../../repositories/cuentaCorriente.repository';
import type { AuthContext } from '../../types/auth';
import { hasDatabaseError } from '../cart.errors';
import { academicOrderReference } from '../orders/academic-checkout';
import { PricingError } from '../pricing/money';
import {
  AdminPaymentError,
  claveIdempotenciaReutilizada,
  conflictoConcurrencia,
  cotizacionNoVerificada,
  cuentaNoEncontrada,
  invalidPaymentRequest,
  noAutenticado,
  pagoNoEncontrado,
  pedidoNoEncontrado,
  sinPermiso,
  transicionPagoInvalida,
} from './admin-payment.errors';

export interface AdminPaymentDto {
  idPago: number;
  pedidoId: number | null;
  cuentaCorrienteId: number | null;
  clienteId: number;
  fecha: string;
  monto: string;
  moneda: 'USD' | 'ARS' | null;
  montoUSD: string | null;
  idCotizacion: number | null;
  tasaHistorica: string | null;
  metodoPago: string;
  estado: string;
  evidenciaAcreditacion: string | null;
  fechaAcreditacion: string | null;
  comprobante: string | null;
  observaciones: string | null;
  motivoCierre: string | null;
  fechaCierre: string | null;
  abonoMovimientoId: number | null;
}

export interface AdminPaymentActionResult {
  data: AdminPaymentDto;
  replay: boolean;
}

function toDto(row: AdminPaymentRow): AdminPaymentDto {
  return {
    idPago: row.id_pago,
    pedidoId: row.id_pedido,
    cuentaCorrienteId: row.id_cuenta_corriente,
    clienteId: row.id_cliente,
    fecha: row.fecha_iso,
    monto: row.monto,
    moneda: row.moneda,
    montoUSD: row.monto_usd,
    idCotizacion: row.id_cotizacion,
    tasaHistorica: row.tasa_historica,
    metodoPago: row.metodo_pago,
    estado: row.estado,
    evidenciaAcreditacion: row.evidencia_acreditacion,
    fechaAcreditacion: row.fecha_acreditacion_iso,
    comprobante: row.comprobante,
    observaciones: row.observaciones,
    motivoCierre: row.motivo_cierre,
    fechaCierre: row.fecha_cierre_iso,
    abonoMovimientoId: row.abono_movimiento_id,
  };
}

async function assertActiveAdmin(
  manager: EntityManager,
  auth: AuthContext,
  lock: boolean,
): Promise<void> {
  if (auth.rol !== 'ADMIN') throw sinPermiso();
  const actor = await readAdminActor(manager, auth.id, lock);
  if (!actor || actor.activo !== 1) throw noAutenticado();
  if (actor.rol !== 'ADMIN') throw sinPermiso();
}

async function resolveUsdConversion(
  manager: EntityManager,
  moneda: 'USD' | 'ARS',
  montoCents: bigint,
  accreditedAt: Date,
  allowSyntheticQuote: boolean,
): Promise<{ montoUsd: string; idCotizacion: number | null; tasaHistorica: string | null }> {
  if (moneda === 'USD') {
    return {
      montoUsd: formatPaymentAmount(montoCents),
      idCotizacion: null,
      tasaHistorica: null,
    };
  }

  let quote: Awaited<ReturnType<typeof loadAccountQuote>>;
  try {
    quote = await loadAccountQuote(manager, accreditedAt);
  } catch (error) {
    if (error instanceof PricingError || error instanceof Error) {
      throw cotizacionNoVerificada();
    }
    throw error;
  }

  if (quote.sintetica && !allowSyntheticQuote) {
    throw cotizacionNoVerificada('Una cotización sintética DEMO no es válida para operaciones reales.');
  }

  const rate = BigInt(quote.valor.replace('.', ''));
  if (rate <= 0n) throw cotizacionNoVerificada();

  const usdCents = (montoCents * 100000000n + rate / 2n) / rate;
  if (usdCents <= 0n || usdCents > MAX_PAYMENT_CENTS) {
    throw new AdminPaymentError(
      'MONTO_USD_INVALIDO',
      422,
      'El importe convertido a USD resulta no positivo o fuera del rango permitido.',
    );
  }

  return {
    montoUsd: formatPaymentAmount(usdCents),
    idCotizacion: Number(quote.id),
    tasaHistorica: quote.valor,
  };
}

function validateAccreditationInstant(raw: string): Date {
  const parsed = parseUtcIsoTimestamp(raw);
  if (!parsed || parsed.getTime() > Date.now()) {
    throw invalidPaymentRequest('La fecha de acreditación UTC es inválida o se encuentra en el futuro.');
  }
  return parsed;
}

function hashPaymentPayload(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function createPaymentPayloadHash(
  input: CreateAdminPaymentDto,
  normalizedMonto: string,
  normalizedDateIso: string | null,
): string {
  return hashPaymentPayload({
    operacion: 'CREAR',
    pedidoId: input.pedidoId,
    cuentaCorrienteId: input.cuentaCorrienteId,
    monto: normalizedMonto,
    moneda: input.moneda,
    metodoPago: input.metodoPago,
    estado: input.estado,
    evidenciaAcreditacion: input.estado === 'ACREDITADO' ? (input.evidenciaAcreditacion ?? null) : null,
    fechaAcreditacionUtc: input.estado === 'ACREDITADO' ? normalizedDateIso : null,
    comprobante: input.comprobante ?? null,
    observaciones: input.observaciones ?? null,
  });
}

function accreditPaymentPayloadHash(
  pagoId: number,
  input: AccreditAdminPaymentDto,
  normalizedDateIso: string,
): string {
  return hashPaymentPayload({
    operacion: 'ACREDITAR',
    pagoId,
    evidenciaAcreditacion: input.evidenciaAcreditacion,
    fechaAcreditacionUtc: normalizedDateIso,
    observaciones: input.observaciones ?? null,
  });
}

function closePaymentPayloadHash(
  operacion: 'RECHAZAR' | 'ANULAR',
  pagoId: number,
  input: CloseAdminPaymentDto,
): string {
  return hashPaymentPayload({
    operacion,
    pagoId,
    motivo: input.motivo,
  });
}

function matchesCreationPayload(
  existing: AdminPaymentRow,
  key: string,
  input: CreateAdminPaymentDto,
  normalizedMonto: string,
  normalizedDateIso: string | null,
): boolean {
  if (existing.clave_idempotencia !== key) return false;
  if (existing.id_pedido !== input.pedidoId) return false;
  if (existing.id_cuenta_corriente !== input.cuentaCorrienteId) return false;
  if (existing.monto !== normalizedMonto) return false;
  if (existing.moneda !== input.moneda) return false;
  if (existing.metodo_pago !== input.metodoPago) return false;
  if ((existing.comprobante ?? null) !== (input.comprobante ?? null)) return false;
  if ((existing.observaciones ?? null) !== (input.observaciones ?? null)) return false;

  if (input.estado === 'ACREDITADO') {
    if (existing.clave_idempotencia_acreditacion !== null) return false;
    if ((existing.evidencia_acreditacion ?? null) !== (input.evidenciaAcreditacion ?? null)) return false;
    if ((existing.fecha_acreditacion_iso ?? null) !== normalizedDateIso) return false;
  } else {
    // Registro preliminar PENDIENTE
    if (existing.fecha_acreditacion_iso !== null && existing.clave_idempotencia_acreditacion === null) {
      return false;
    }
  }

  return true;
}

function mapLedgerError(error: unknown): never {
  if (error instanceof AdminPaymentError) throw error;
  if (error instanceof Error) {
    if (/cobertura histórica no acreditada|corte conciliado/i.test(error.message)) {
      throw new AdminPaymentError(
        'COBERTURA_CUENTA_NO_ACREDITADA',
        409,
        'La cuenta corriente no posee cobertura histórica acreditada para registrar o anular el abono.',
      );
    }
    if (/Cotización DEMO|CALENDARIO|COTIZACION/i.test(error.message)) {
      throw cotizacionNoVerificada();
    }
    if (/Fecha de acreditación inválida/i.test(error.message)) {
      throw invalidPaymentRequest('La fecha de acreditación UTC es inválida.');
    }
  }
  throw error;
}

export async function listAdminPaymentsService(
  auth: AuthContext,
  query: AdminPaymentListQuery,
): Promise<{ items: AdminPaymentDto[]; siguienteAntesDeId: number | null }> {
  return inTransaction(async manager => {
    await assertActiveAdmin(manager, auth, false);
    const rows = await listPayments(manager, query);
    const hasMore = rows.length > query.limite;
    const page = rows.slice(0, query.limite);
    return {
      items: page.map(toDto),
      siguienteAntesDeId: hasMore && page.length > 0 ? page[page.length - 1].id_pago : null,
    };
  }, { isolation: 'REPEATABLE READ' });
}

export async function getAdminPaymentDetailService(
  auth: AuthContext,
  pagoId: number,
): Promise<AdminPaymentDto> {
  return inTransaction(async manager => {
    await assertActiveAdmin(manager, auth, false);
    const row = await findPaymentById(manager, pagoId);
    if (!row) throw pagoNoEncontrado();
    return toDto(row);
  }, { isolation: 'READ COMMITTED' });
}

export async function createAdminPaymentService(
  auth: AuthContext,
  input: CreateAdminPaymentDto,
  key: string,
  notify?: NotifyCommittedChange,
): Promise<AdminPaymentActionResult> {
  const montoCents = parsePaymentAmount(input.monto);
  if (montoCents === null) {
    throw invalidPaymentRequest('El monto debe ser mayor a cero con hasta dos decimales.');
  }
  const normalizedMonto = formatPaymentAmount(montoCents);
  const accreditedAt = input.estado === 'ACREDITADO'
    ? validateAccreditationInstant(input.fechaAcreditacionUtc!)
    : null;
  const normalizedDateIso = accreditedAt ? accreditedAt.toISOString() : null;
  const payloadHash = createPaymentPayloadHash(input, normalizedMonto, normalizedDateIso);

  let committed: { result: AdminPaymentActionResult; change?: CommittedChange };

  try {
    committed = await inTransaction(async manager => {
      let clientId: number;
      let allowSyntheticQuote = false;
      let targetAccountId: number | null = null;
      let targetOrderId: number | null = null;

      if (input.cuentaCorrienteId !== null) {
        // §10.1: CUENTA_CORRIENTE FOR UPDATE -> CLIENTE FOR UPDATE -> USUARIO (ADMIN activo) -> PAGO -> MOVIMIENTO -> IMPUTACION
        const account = await lockAccountById(manager, input.cuentaCorrienteId);
        if (!account) {
          await assertActiveAdmin(manager, auth, true);
          throw cuentaNoEncontrada();
        }
        const client = await lockClientById(manager, account.id_cliente);
        await assertActiveAdmin(manager, auth, true);
        if (!client || client.tipo_cliente !== 'EMPRESA') {
          throw new AdminPaymentError(
            'DESTINO_PAGO_INVALIDO',
            409,
            'La cuenta corriente indicada no corresponde a una empresa válida.',
          );
        }
        if (account.origen_datos === 'DEMO' && process.env.NODE_ENV !== 'test') {
          throw new AdminPaymentError(
            'CUENTA_DEMO',
            409,
            'La cuenta DEMO no admite pagos reales.',
          );
        }
        clientId = client.id_cliente;
        allowSyntheticQuote = account.origen_datos === 'DEMO';
        targetAccountId = account.id_cuenta_corriente;
      } else {
        // §10.2: PEDIDO FOR UPDATE -> USUARIO (ADMIN activo) -> PAGO
        const order = await lockOrderById(manager, input.pedidoId!);
        await assertActiveAdmin(manager, auth, true);
        if (!order) throw pedidoNoEncontrado();
        if (order.estado.startsWith('DEMO_') || order.modalidad_pago !== 'TRANSFERENCIA') {
          throw new AdminPaymentError(
            'MODALIDAD_PAGO_INCOMPATIBLE',
            409,
            'Solo se admiten pagos directos sobre pedidos con modalidad TRANSFERENCIA.',
          );
        }
        if (input.estado === 'ACREDITADO' && order.moneda_total !== 'USD') {
          throw new AdminPaymentError(
            'MONEDA_PEDIDO_NO_ACREDITADA',
            409,
            'No se puede acreditar un pago directo sobre un pedido sin moneda USD verificada.',
          );
        }
        clientId = order.id_cliente;
        allowSyntheticQuote = Boolean(order.evidencia_total_usd?.startsWith(academicOrderReference));
        targetOrderId = order.id_pedido;
      }

      const idempotency = await findPaymentIdempotency(manager, key);
      if (idempotency) {
        if (idempotency.operacion !== 'CREAR' || idempotency.payload_hash !== payloadHash) {
          throw claveIdempotenciaReutilizada();
        }
        const existing = await findPaymentById(manager, idempotency.id_pago);
        if (!existing) throw conflictoConcurrencia();
        return { result: { data: toDto(existing), replay: true } };
      }

      const existing = await findPaymentByAnyKey(manager, key);
      if (existing) {
        if (!matchesCreationPayload(existing, key, input, normalizedMonto, normalizedDateIso)) {
          throw claveIdempotenciaReutilizada();
        }
        return { result: { data: toDto(existing), replay: true } };
      }

      const conversion = input.estado === 'ACREDITADO'
        ? await resolveUsdConversion(manager, input.moneda, montoCents, accreditedAt!, allowSyntheticQuote)
        : { montoUsd: null, idCotizacion: null, tasaHistorica: null };

      const pagoId = await insertPayment(manager, {
        pedidoId: targetOrderId,
        cuentaCorrienteId: targetAccountId,
        monto: normalizedMonto,
        moneda: input.moneda,
        montoUsd: conversion.montoUsd,
        idCotizacion: conversion.idCotizacion,
        tasaHistorica: conversion.tasaHistorica,
        metodoPago: input.metodoPago,
        estado: input.estado,
        evidenciaAcreditacion: input.estado === 'ACREDITADO' ? input.evidenciaAcreditacion! : null,
        fechaAcreditacionUtc: accreditedAt ? utcSql(accreditedAt) : null,
        comprobante: input.comprobante ?? null,
        observaciones: input.observaciones ?? null,
        claveIdempotencia: key,
        adminId: auth.id,
      });

      await insertPaymentIdempotency(manager, {
        claveIdempotencia: key,
        pagoId,
        operacion: 'CREAR',
        payloadHash,
      });

      let revisionCuenta: string | null = null;
      if (input.estado === 'ACREDITADO' && targetAccountId !== null) {
        try {
          await registrarAbonoPorPago({
            id_cuenta_corriente: targetAccountId,
            id_pago: pagoId,
            monto: conversion.montoUsd!,
            origen: 'PAGO',
            observaciones: input.observaciones ?? null,
          }, manager);
        } catch (error) {
          mapLedgerError(error);
        }
        revisionCuenta = await readCurrentAccountRevision(manager, targetAccountId);
      }

      const saved = await findPaymentById(manager, pagoId);
      if (!saved) throw conflictoConcurrencia();

      const change: CommittedChange | undefined = input.estado === 'ACREDITADO'
        ? {
            kind: 'payment',
            clientId,
            payment: {
              pagoId: saved.id_pago,
              pedidoId: saved.id_pedido,
              cuentaCorrienteId: saved.id_cuenta_corriente,
              estadoPago: 'ACREDITADO',
              montoUSD: saved.monto_usd!,
              revisionCuenta,
              actualizadoEn: new Date().toISOString(),
            },
          }
        : undefined;

      return { result: { data: toDto(saved), replay: false }, change };
    }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
  } catch (error) {
    if (hasDatabaseError(error, 'ER_DUP_ENTRY', 1062)) {
      return recoverDuplicatePaymentAction(auth, key, 'CREAR', payloadHash);
    }
    throw error;
  }

  // Emision estrictamente post-COMMIT (§8).
  if (committed.change) notifyAfterCommit(notify, committed.change);
  return committed.result;
}

async function recoverDuplicatePaymentAction(
  auth: AuthContext,
  key: string,
  expectedOp: PaymentIdempotencyOperation,
  expectedHash: string,
  expectedPagoId?: number,
): Promise<AdminPaymentActionResult> {
  return inTransaction(async manager => {
    await assertActiveAdmin(manager, auth, false);
    const idempotency = await findPaymentIdempotency(manager, key);
    if (idempotency) {
      if (
        idempotency.operacion !== expectedOp ||
        idempotency.payload_hash !== expectedHash ||
        (expectedPagoId !== undefined && idempotency.id_pago !== expectedPagoId)
      ) {
        throw claveIdempotenciaReutilizada();
      }
      const existing = await findPaymentById(manager, idempotency.id_pago);
      if (!existing) throw conflictoConcurrencia();
      return { data: toDto(existing), replay: true };
    }

    const existing = await findPaymentByAnyKey(manager, key);
    if (existing) {
      throw claveIdempotenciaReutilizada();
    }
    throw conflictoConcurrencia();
  }, { isolation: 'READ COMMITTED' });
}

export async function accreditAdminPaymentService(
  auth: AuthContext,
  pagoId: number,
  input: AccreditAdminPaymentDto,
  key: string,
  notify?: NotifyCommittedChange,
): Promise<AdminPaymentActionResult> {
  const accreditedAt = validateAccreditationInstant(input.fechaAcreditacionUtc);
  const normalizedDateIso = accreditedAt.toISOString();
  const payloadHash = accreditPaymentPayloadHash(pagoId, input, normalizedDateIso);

  let committed: { result: AdminPaymentActionResult; change?: CommittedChange };
  try {
    committed = await inTransaction(async manager => {
      // §10.3 Fase 1 (sin lock): leer destino para determinar el agregado raiz.
      const probe = await probePaymentDestination(manager, pagoId);
      if (!probe) {
        await assertActiveAdmin(manager, auth, true);
        throw pagoNoEncontrado();
      }

      // §10.3 Fase 2: bloquear agregado raiz ANTES que PAGO FOR UPDATE.
      let clientId: number;
      let allowSyntheticQuote = false;
      let lockedOrder: Awaited<ReturnType<typeof lockOrderById>> = null;
      let lockedAccount: Awaited<ReturnType<typeof lockAccountById>> = null;

      if (probe.id_cuenta_corriente !== null) {
        lockedAccount = await lockAccountById(manager, probe.id_cuenta_corriente);
        if (!lockedAccount) {
          await assertActiveAdmin(manager, auth, true);
          throw cuentaNoEncontrada();
        }
        const client = await lockClientById(manager, lockedAccount.id_cliente);
        await assertActiveAdmin(manager, auth, true);
        if (!client || client.tipo_cliente !== 'EMPRESA') {
          throw new AdminPaymentError(
            'DESTINO_PAGO_INVALIDO',
            409,
            'La cuenta corriente indicada no corresponde a una empresa válida.',
          );
        }
        if (lockedAccount.origen_datos === 'DEMO' && process.env.NODE_ENV !== 'test') {
          throw new AdminPaymentError('CUENTA_DEMO', 409, 'La cuenta DEMO no admite operaciones reales.');
        }
        clientId = client.id_cliente;
        allowSyntheticQuote = lockedAccount.origen_datos === 'DEMO';
      } else if (probe.id_pedido !== null) {
        lockedOrder = await lockOrderById(manager, probe.id_pedido);
        await assertActiveAdmin(manager, auth, true);
        if (!lockedOrder) throw pedidoNoEncontrado();
        clientId = lockedOrder.id_cliente;
        allowSyntheticQuote = Boolean(lockedOrder.evidencia_total_usd?.startsWith(academicOrderReference));
      } else {
        await assertActiveAdmin(manager, auth, true);
        throw conflictoConcurrencia();
      }

      // §10.3 Fase 3: bloquear PAGO FOR UPDATE bajo la jerarquia y revalidar existencia, destino, estado y moneda/importe.
      const locked = await lockPaymentById(manager, pagoId, clientId);
      if (!locked) throw pagoNoEncontrado();
      if (
        locked.id_cuenta_corriente !== probe.id_cuenta_corriente ||
        locked.id_pedido !== probe.id_pedido
      ) {
        throw conflictoConcurrencia();
      }

      const idempotency = await findPaymentIdempotency(manager, key);
      if (idempotency) {
        if (
          idempotency.operacion !== 'ACREDITAR' ||
          idempotency.id_pago !== pagoId ||
          idempotency.payload_hash !== payloadHash
        ) {
          throw claveIdempotenciaReutilizada();
        }
        const existing = await findPaymentById(manager, pagoId);
        if (!existing) throw pagoNoEncontrado();
        return { result: { data: toDto(existing), replay: true } };
      }

      const keyOwner = await findPaymentByAnyKey(manager, key);
      if (keyOwner && keyOwner.id_pago !== pagoId) {
        throw claveIdempotenciaReutilizada();
      }
      if (locked.clave_idempotencia === key || locked.clave_idempotencia_cierre === key) {
        throw claveIdempotenciaReutilizada();
      }

      if (locked.estado === 'ACREDITADO' && locked.clave_idempotencia_acreditacion === key) {
        const samePayload =
          locked.evidencia_acreditacion === input.evidenciaAcreditacion &&
          locked.fecha_acreditacion_iso === normalizedDateIso &&
          (locked.observaciones ?? null) === (input.observaciones ?? null);
        if (!samePayload) throw claveIdempotenciaReutilizada();
        const existing = await findPaymentById(manager, pagoId);
        if (!existing) throw pagoNoEncontrado();
        return { result: { data: toDto(existing), replay: true } };
      }

      if (locked.estado !== 'PENDIENTE') {
        throw transicionPagoInvalida(
          `No se puede acreditar un pago en estado ${locked.estado}.`,
        );
      }

      if (locked.moneda !== 'USD' && locked.moneda !== 'ARS') {
        throw invalidPaymentRequest('El pago no posee una moneda válida (USD o ARS).');
      }
      const montoCents = parsePaymentAmount(locked.monto);
      if (montoCents === null) {
        throw invalidPaymentRequest('El monto del pago es inválido.');
      }

      if (lockedOrder) {
        if (lockedOrder.estado.startsWith('DEMO_') || lockedOrder.modalidad_pago !== 'TRANSFERENCIA') {
          throw new AdminPaymentError(
            'MODALIDAD_PAGO_INCOMPATIBLE',
            409,
            'Solo se pueden acreditar pagos directos sobre pedidos TRANSFERENCIA.',
          );
        }
        if (lockedOrder.moneda_total !== 'USD') {
          throw new AdminPaymentError(
            'MONEDA_PEDIDO_NO_ACREDITADA',
            409,
            'No se puede acreditar un pago directo sobre un pedido sin moneda USD verificada.',
          );
        }
      }

      const conversion = await resolveUsdConversion(
        manager,
        locked.moneda,
        montoCents,
        accreditedAt,
        allowSyntheticQuote,
      );

      const affected = await markPaymentAccredited(manager, {
        pagoId,
        montoUsd: conversion.montoUsd,
        idCotizacion: conversion.idCotizacion,
        tasaHistorica: conversion.tasaHistorica,
        evidenciaAcreditacion: input.evidenciaAcreditacion,
        fechaAcreditacionUtc: utcSql(accreditedAt),
        observaciones: input.observaciones,
        claveIdempotenciaAcreditacion: key,
        adminId: auth.id,
      });
      if (affected !== 1) throw transicionPagoInvalida();

      await insertPaymentIdempotency(manager, {
        claveIdempotencia: key,
        pagoId,
        operacion: 'ACREDITAR',
        payloadHash,
      });

      let revisionCuenta: string | null = null;
      if (lockedAccount) {
        try {
          await registrarAbonoPorPago({
            id_cuenta_corriente: lockedAccount.id_cuenta_corriente,
            id_pago: pagoId,
            monto: conversion.montoUsd,
            origen: 'PAGO',
            observaciones: input.observaciones ?? locked.observaciones ?? null,
          }, manager);
        } catch (error) {
          mapLedgerError(error);
        }
        revisionCuenta = await readCurrentAccountRevision(manager, lockedAccount.id_cuenta_corriente);
      }

      const saved = await findPaymentById(manager, pagoId);
      if (!saved) throw conflictoConcurrencia();

      const change: CommittedChange = {
        kind: 'payment',
        clientId,
        payment: {
          pagoId: saved.id_pago,
          pedidoId: saved.id_pedido,
          cuentaCorrienteId: saved.id_cuenta_corriente,
          estadoPago: 'ACREDITADO',
          montoUSD: saved.monto_usd!,
          revisionCuenta,
          actualizadoEn: new Date().toISOString(),
        },
      };

      return { result: { data: toDto(saved), replay: false }, change };
    }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
  } catch (error) {
    if (hasDatabaseError(error, 'ER_DUP_ENTRY', 1062)) {
      return recoverDuplicatePaymentAction(auth, key, 'ACREDITAR', payloadHash, pagoId);
    }
    throw error;
  }

  // Emision estrictamente post-COMMIT (§8).
  if (committed.change) notifyAfterCommit(notify, committed.change);
  return committed.result;
}

export async function rejectAdminPaymentService(
  auth: AuthContext,
  pagoId: number,
  input: CloseAdminPaymentDto,
  key: string,
): Promise<AdminPaymentActionResult> {
  const payloadHash = closePaymentPayloadHash('RECHAZAR', pagoId, input);
  try {
    return await inTransaction(async manager => {
      // §10.3 Fase 1 (sin lock)
      const probe = await probePaymentDestination(manager, pagoId);
      if (!probe) {
        await assertActiveAdmin(manager, auth, true);
        throw pagoNoEncontrado();
      }

      // §10.3 Fase 2: root aggregate primero
      let clientId: number;
      if (probe.id_cuenta_corriente !== null) {
        const account = await lockAccountById(manager, probe.id_cuenta_corriente);
        if (account) await lockClientById(manager, account.id_cliente);
        await assertActiveAdmin(manager, auth, true);
        if (!account) throw cuentaNoEncontrada();
        clientId = account.id_cliente;
      } else if (probe.id_pedido !== null) {
        const order = await lockOrderById(manager, probe.id_pedido);
        await assertActiveAdmin(manager, auth, true);
        if (!order) throw pedidoNoEncontrado();
        clientId = order.id_cliente;
      } else {
        await assertActiveAdmin(manager, auth, true);
        throw conflictoConcurrencia();
      }

      // §10.3 Fase 3: PAGO FOR UPDATE + revalidacion
      const locked = await lockPaymentById(manager, pagoId, clientId);
      if (!locked) throw pagoNoEncontrado();
      if (
        locked.id_cuenta_corriente !== probe.id_cuenta_corriente ||
        locked.id_pedido !== probe.id_pedido
      ) {
        throw conflictoConcurrencia();
      }

      const idempotency = await findPaymentIdempotency(manager, key);
      if (idempotency) {
        if (
          idempotency.operacion !== 'RECHAZAR' ||
          idempotency.id_pago !== pagoId ||
          idempotency.payload_hash !== payloadHash
        ) {
          throw claveIdempotenciaReutilizada();
        }
        const existing = await findPaymentById(manager, pagoId);
        if (!existing) throw pagoNoEncontrado();
        return { data: toDto(existing), replay: true };
      }

      const keyOwner = await findPaymentByAnyKey(manager, key);
      if (keyOwner && keyOwner.id_pago !== pagoId) {
        throw claveIdempotenciaReutilizada();
      }
      if (locked.clave_idempotencia === key || locked.clave_idempotencia_acreditacion === key) {
        throw claveIdempotenciaReutilizada();
      }

      if (locked.estado === 'RECHAZADO' && locked.clave_idempotencia_cierre === key) {
        if (locked.motivo_cierre !== input.motivo) throw claveIdempotenciaReutilizada();
        const existing = await findPaymentById(manager, pagoId);
        if (!existing) throw pagoNoEncontrado();
        return { data: toDto(existing), replay: true };
      }

      if (locked.estado !== 'PENDIENTE') {
        throw transicionPagoInvalida(
          `Solo se puede rechazar un pago preliminar en estado PENDIENTE (actual: ${locked.estado}).`,
        );
      }

      const affected = await markPaymentClosed(manager, {
        pagoId,
        fromState: 'PENDIENTE',
        toState: 'RECHAZADO',
        motivo: input.motivo,
        claveIdempotenciaCierre: key,
        adminId: auth.id,
        fechaCierreUtc: utcSql(new Date()),
      });
      if (affected !== 1) throw transicionPagoInvalida();

      await insertPaymentIdempotency(manager, {
        claveIdempotencia: key,
        pagoId,
        operacion: 'RECHAZAR',
        payloadHash,
      });

      const saved = await findPaymentById(manager, pagoId);
      if (!saved) throw conflictoConcurrencia();
      return { data: toDto(saved), replay: false };
    }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
  } catch (error) {
    if (hasDatabaseError(error, 'ER_DUP_ENTRY', 1062)) {
      return recoverDuplicatePaymentAction(auth, key, 'RECHAZAR', payloadHash, pagoId);
    }
    throw error;
  }
}

export async function annulAdminPaymentService(
  auth: AuthContext,
  pagoId: number,
  input: CloseAdminPaymentDto,
  key: string,
  notify?: NotifyCommittedChange,
): Promise<AdminPaymentActionResult> {
  const payloadHash = closePaymentPayloadHash('ANULAR', pagoId, input);
  let committed: { result: AdminPaymentActionResult; change?: CommittedChange };
  try {
    committed = await inTransaction(async manager => {
      // §10.3 Fase 1 (sin lock)
      const probe = await probePaymentDestination(manager, pagoId);
      if (!probe) {
        await assertActiveAdmin(manager, auth, true);
        throw pagoNoEncontrado();
      }

      // §10.3 Fase 2: root aggregate primero
      let clientId: number;
      let targetAccountId: number | null = null;
      if (probe.id_cuenta_corriente !== null) {
        const account = await lockAccountById(manager, probe.id_cuenta_corriente);
        if (!account) {
          await assertActiveAdmin(manager, auth, true);
          throw cuentaNoEncontrada();
        }
        const client = await lockClientById(manager, account.id_cliente);
        await assertActiveAdmin(manager, auth, true);
        if (!client) throw cuentaNoEncontrada();
        clientId = client.id_cliente;
        targetAccountId = account.id_cuenta_corriente;
      } else if (probe.id_pedido !== null) {
        const order = await lockOrderById(manager, probe.id_pedido);
        await assertActiveAdmin(manager, auth, true);
        if (!order) throw pedidoNoEncontrado();
        clientId = order.id_cliente;
      } else {
        await assertActiveAdmin(manager, auth, true);
        throw conflictoConcurrencia();
      }

      // §10.3 Fase 3: PAGO FOR UPDATE + revalidacion
      const locked = await lockPaymentById(manager, pagoId, clientId);
      if (!locked) throw pagoNoEncontrado();
      if (
        locked.id_cuenta_corriente !== probe.id_cuenta_corriente ||
        locked.id_pedido !== probe.id_pedido
      ) {
        throw conflictoConcurrencia();
      }

      const idempotency = await findPaymentIdempotency(manager, key);
      if (idempotency) {
        if (
          idempotency.operacion !== 'ANULAR' ||
          idempotency.id_pago !== pagoId ||
          idempotency.payload_hash !== payloadHash
        ) {
          throw claveIdempotenciaReutilizada();
        }
        const existing = await findPaymentById(manager, pagoId);
        if (!existing) throw pagoNoEncontrado();
        return { result: { data: toDto(existing), replay: true } };
      }

      const keyOwner = await findPaymentByAnyKey(manager, key);
      if (keyOwner && keyOwner.id_pago !== pagoId) {
        throw claveIdempotenciaReutilizada();
      }
      if (locked.clave_idempotencia === key || locked.clave_idempotencia_acreditacion === key) {
        throw claveIdempotenciaReutilizada();
      }

      if (locked.estado === 'ANULADO' && locked.clave_idempotencia_cierre === key) {
        if (locked.motivo_cierre !== input.motivo) throw claveIdempotenciaReutilizada();
        const existing = await findPaymentById(manager, pagoId);
        if (!existing) throw pagoNoEncontrado();
        return { result: { data: toDto(existing), replay: true } };
      }

      if (locked.estado !== 'ACREDITADO') {
        throw transicionPagoInvalida(
          `Solo se puede anular un pago en estado ACREDITADO (actual: ${locked.estado}).`,
        );
      }

      const affected = await markPaymentClosed(manager, {
        pagoId,
        fromState: 'ACREDITADO',
        toState: 'ANULADO',
        motivo: input.motivo,
        claveIdempotenciaCierre: key,
        adminId: auth.id,
        fechaCierreUtc: utcSql(new Date()),
      });
      if (affected !== 1) throw transicionPagoInvalida();

      await insertPaymentIdempotency(manager, {
        claveIdempotencia: key,
        pagoId,
        operacion: 'ANULAR',
        payloadHash,
      });

      let revisionCuenta: string | null = null;
      if (targetAccountId !== null) {
        const abono = await findLinkedAccountAbonoForUpdate(manager, targetAccountId, pagoId);
        if (abono && abono.estado === 'ACREDITADO') {
          try {
            await anularMovimiento({
              id_cuenta_corriente: targetAccountId,
              id_movimiento_cuenta: abono.id_movimiento_cuenta,
              evento: `PAGO_ANULADO:${key}`,
              actor: String(auth.id),
              motivo: input.motivo,
            }, manager);
          } catch (error) {
            mapLedgerError(error);
          }
        }
        revisionCuenta = await readCurrentAccountRevision(manager, targetAccountId);
      }

      const saved = await findPaymentById(manager, pagoId);
      if (!saved) throw conflictoConcurrencia();

      const change: CommittedChange = {
        kind: 'payment',
        clientId,
        payment: {
          pagoId: saved.id_pago,
          pedidoId: saved.id_pedido,
          cuentaCorrienteId: saved.id_cuenta_corriente,
          estadoPago: 'ANULADO',
          montoUSD: saved.monto_usd ?? saved.monto,
          revisionCuenta,
          actualizadoEn: new Date().toISOString(),
        },
      };

      return { result: { data: toDto(saved), replay: false }, change };
    }, { isolation: 'READ COMMITTED', lockWaitSeconds: 3 });
  } catch (error) {
    if (hasDatabaseError(error, 'ER_DUP_ENTRY', 1062)) {
      return recoverDuplicatePaymentAction(auth, key, 'ANULAR', payloadHash, pagoId);
    }
    throw error;
  }

  // Emision estrictamente post-COMMIT (§8).
  if (committed.change) notifyAfterCommit(notify, committed.change);
  return committed.result;
}
