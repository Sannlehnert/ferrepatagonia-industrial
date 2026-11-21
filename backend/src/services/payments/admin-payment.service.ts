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
  lockPaymentReceiptForAccreditation,
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
  calcularEstadoCuenta,
  registrarAbonoPorPago,
} from '../../repositories/cuentaCorriente.repository';
import type { AuthContext } from '../../types/auth';
import { hasDatabaseError } from '../cart.errors';
import { academicOrderReference } from '../orders/academic-checkout';
import { PricingError } from '../pricing/money';
import {
  AdminPaymentError,
  claveIdempotenciaReutilizada,
  comprobanteNoEncontrado,
  conflictoConcurrencia,
  cotizacionAusente,
  cotizacionInvalida,
  cotizacionNoVerificada,
  cuentaNoAcreditada,
  cuentaNoEncontrada,
  cuentaRestringida,
  invalidPaymentRequest,
  montoUsdInvalido,
  noAutenticado,
  pagoDocumentalmenteRechazado,
  pagoNoEncontrado,
  pagoPendienteRevision,
  pagoYaAcreditado,
  pedidoNoEncontrado,
  sinPermiso,
  transicionPagoInvalida,
} from './admin-payment.errors';

export interface AdminPaymentDto {
  id: number;
  idPago: number;
  pedidoId: number | null;
  cuentaCorrienteId: number | null;
  clienteId: number;
  cliente: string;
  declaranteUsuarioId: number | null;
  revisadoPorUsuarioId: number | null;
  acreditadoPorUsuarioId: number | null;
  fecha: string;
  monto: string;
  moneda: 'USD' | 'ARS' | null;
  montoUSD: string | null;
  montoUsd: string | null;
  idCotizacion: number | null;
  tasaHistorica: string | null;
  metodoPago: string;
  estado: string;
  estadoDocumental: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';
  motivoRevision: string | null;
  revisadoEn: string | null;
  evidenciaAcreditacion: string | null;
  fechaAcreditacion: string | null;
  acreditadoEn: string | null;
  comprobante: string | null;
  comprobanteId: string | null;
  comprobanteTipoMime: string | null;
  comprobanteBytes: number | null;
  comprobanteRevisadoEn: string | null;
  observaciones: string | null;
  motivoCierre: string | null;
  fechaCierre: string | null;
  claveIdempotencia: string | null;
  claveAcreditacion: string | null;
  abonoMovimientoId: number | null;
  movimientoId: number | null;
  movimientoEstado: string | null;
  movimientoMonto: string | null;
}

export interface AdminPaymentActionResult {
  data: AdminPaymentDto;
  replay: boolean;
}

function toDto(row: AdminPaymentRow): AdminPaymentDto {
  const acreditadoPor =
    row.id_admin_acreditacion !== null
      ? row.id_admin_acreditacion
      : row.estado === 'ACREDITADO'
        ? row.id_admin_actor
        : null;
  return {
    id: row.id_pago,
    idPago: row.id_pago,
    pedidoId: row.id_pedido,
    cuentaCorrienteId: row.id_cuenta_corriente,
    clienteId: row.id_cliente,
    cliente: row.cliente,
    declaranteUsuarioId: row.id_usuario_declarante,
    revisadoPorUsuarioId: row.id_admin_revision,
    acreditadoPorUsuarioId: acreditadoPor,
    fecha: row.fecha_iso,
    monto: row.monto,
    moneda: row.moneda,
    montoUSD: row.monto_usd,
    montoUsd: row.monto_usd,
    idCotizacion: row.id_cotizacion,
    tasaHistorica: row.tasa_historica,
    metodoPago: row.metodo_pago,
    estado: row.estado,
    estadoDocumental: row.estado_documental,
    motivoRevision: row.motivo_revision,
    revisadoEn: row.revision_iso,
    evidenciaAcreditacion: row.evidencia_acreditacion,
    fechaAcreditacion: row.fecha_acreditacion_iso,
    acreditadoEn: row.fecha_acreditacion_iso,
    comprobante: row.comprobante,
    comprobanteId: row.id_comprobante,
    comprobanteTipoMime: row.comprobante_tipo_mime,
    comprobanteBytes: row.comprobante_bytes,
    comprobanteRevisadoEn: row.comprobante_revisado_iso,
    observaciones: row.observaciones,
    motivoCierre: row.motivo_cierre,
    fechaCierre: row.fecha_cierre_iso,
    claveIdempotencia: row.clave_idempotencia,
    claveAcreditacion: row.clave_acreditacion ?? row.clave_idempotencia_acreditacion,
    abonoMovimientoId: row.abono_movimiento_id,
    movimientoId: row.abono_movimiento_id,
    movimientoEstado: row.movimiento_estado,
    movimientoMonto: row.movimiento_monto,
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

const FER17_QUOTE_ERROR_CODES: ReadonlySet<string> = new Set([
  'CALENDARIO_NO_VERIFICADO',
  'COTIZACION_AUSENTE',
  'COTIZACION_INVALIDA',
  'DATOS_COMERCIALES_INVALIDOS',
  'IMPORTE_FUERA_DE_RANGO',
]);

export function isDatabaseOrInfrastructureError(error: unknown): boolean {
  const pending = [error];
  const seen = new Set<object>();
  while (pending.length) {
    const next = pending.pop();
    if (!next || typeof next !== 'object' || seen.has(next)) continue;
    seen.add(next);
    const candidate = next as {
      name?: unknown;
      code?: unknown;
      errno?: unknown;
      sqlState?: unknown;
      driverError?: unknown;
      cause?: unknown;
    };
    if (candidate.name === 'QueryFailedError') return true;
    if (typeof candidate.errno === 'number' && candidate.errno !== 0) return true;
    if (typeof candidate.sqlState === 'string' && candidate.sqlState.length > 0) return true;
    if (
      typeof candidate.code === 'string' &&
      (
        candidate.code.startsWith('ER_') ||
        candidate.code.startsWith('ECONN') ||
        candidate.code.startsWith('ETIMEDOUT') ||
        candidate.code.startsWith('PROTOCOL_') ||
        candidate.code === 'ENOTFOUND' ||
        candidate.code === 'EPIPE' ||
        candidate.code === 'EHOSTUNREACH'
      )
    ) {
      return true;
    }
    pending.push(candidate.driverError, candidate.cause);
  }
  return false;
}

export function extractFer17QuoteErrorCode(error: unknown): string | null {
  if (error instanceof PricingError) {
    return error.code;
  }
  // loadAccountQuote lanza Error('CALENDARIO_NO_VERIFICADO') si dias_json no es un objeto plano.
  if (
    error instanceof Error &&
    error.name === 'Error' &&
    !isDatabaseOrInfrastructureError(error) &&
    FER17_QUOTE_ERROR_CODES.has(error.message)
  ) {
    return error.message;
  }
  return null;
}

export async function resolveUsdConversion(
  manager: EntityManager,
  moneda: 'USD' | 'ARS',
  montoCents: bigint,
  accreditedAt: Date,
  allowSyntheticQuote: boolean,
  options: {
    isClientDeclared?: boolean;
    quoteLoader?: typeof loadAccountQuote;
  } = {},
): Promise<{ montoUsd: string; idCotizacion: number | null; tasaHistorica: string | null }> {
  if (moneda === 'USD') {
    return {
      montoUsd: formatPaymentAmount(montoCents),
      idCotizacion: null,
      tasaHistorica: null,
    };
  }

  const isClientDeclared = Boolean(options.isClientDeclared);
  const loader = options.quoteLoader ?? loadAccountQuote;

  let quote: Awaited<ReturnType<typeof loadAccountQuote>>;
  try {
    quote = await loader(manager, accreditedAt);
  } catch (error) {
    const fer17Code = extractFer17QuoteErrorCode(error);
    if (fer17Code === null) {
      // R01: todo fallo SQL, de concurrencia o infraestructura se relanza sin envolver como 422.
      throw error;
    }
    if (fer17Code === 'COTIZACION_AUSENTE') {
      throw cotizacionAusente();
    }
    throw isClientDeclared ? cotizacionInvalida() : cotizacionNoVerificada();
  }

  if (quote.sintetica && !allowSyntheticQuote) {
    if (isClientDeclared) {
      throw cuentaRestringida();
    }
    throw cotizacionNoVerificada('Una cotización sintética DEMO no es válida para operaciones reales.');
  }

  const rate = BigInt(quote.valor.replace('.', ''));
  if (rate <= 0n) {
    throw isClientDeclared ? cotizacionInvalida() : cotizacionNoVerificada();
  }

  const usdCents = (montoCents * 100000000n + rate / 2n) / rate;
  if (usdCents <= 0n || usdCents > MAX_PAYMENT_CENTS) {
    throw montoUsdInvalido();
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
  evidenciaAcreditacion: string,
  normalizedRequestedDateIso: string | null,
  observaciones: string | null,
): string {
  return hashPaymentPayload({
    operacion: 'ACREDITAR',
    pagoId,
    evidenciaAcreditacion,
    fechaAcreditacionUtc: normalizedRequestedDateIso,
    observaciones,
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

function mapLedgerError(error: unknown, isClientDeclared = false): never {
  if (error instanceof AdminPaymentError) throw error;
  if (error instanceof PricingError) {
    if (error.code === 'COTIZACION_AUSENTE') throw cotizacionAusente();
    throw isClientDeclared ? cotizacionInvalida() : cotizacionNoVerificada();
  }
  if (isDatabaseOrInfrastructureError(error)) {
    throw error;
  }
  if (error instanceof Error) {
    if (/libro mixto|procedencia del libro|Datos DEMO restringidos|Cotización DEMO/i.test(error.message)) {
      throw cuentaRestringida();
    }
    if (/cobertura histórica no acreditada|corte conciliado/i.test(error.message)) {
      throw cuentaNoAcreditada();
    }
    if (/CALENDARIO_NO_VERIFICADO|Cotización histórica del pago inconsistente/i.test(error.message)) {
      throw isClientDeclared ? cotizacionInvalida() : cotizacionNoVerificada();
    }
    if (/Importe USD distinto del pago acreditado|fuera de rango/i.test(error.message)) {
      throw montoUsdInvalido();
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
): Promise<{ items: AdminPaymentDto[]; siguienteAntesDeId: number | null; paginaSiguiente?: number | null }> {
  return inTransaction(async manager => {
    await assertActiveAdmin(manager, auth, false);
    const rows = await listPayments(manager, query);
    const hasMore = rows.length > query.limite;
    const page = rows.slice(0, query.limite);
    return {
      items: page.map(toDto),
      siguienteAntesDeId: hasMore && page.length > 0 ? page[page.length - 1].id_pago : null,
      ...(query.pagina !== undefined ? { paginaSiguiente: hasMore ? query.pagina + 1 : null } : {}),
    };
  }, { isolation: 'REPEATABLE READ' });
}

export async function getAdminPaymentDetailService(
  auth: AuthContext,
  pagoId: number,
): Promise<AdminPaymentDto> {
  return inTransaction(async manager => {
    await assertActiveAdmin(manager, auth, false);
    const row = await findPaymentById(manager, pagoId, { excludeRestricted: true });
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

      if (input.estado === 'ACREDITADO' && targetAccountId !== null) {
        const accountState = await calcularEstadoCuenta(targetAccountId, manager, { lock: true });
        if (!accountState) throw cuentaNoEncontrada();
        if (accountState.libro_mixto) throw cuentaRestringida();
        if (accountState.cobertura !== 'COMPLETA') throw cuentaNoAcreditada();
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
            autorizado_por: String(auth.id),
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
  const evidence = (input.evidenciaAcreditacion ?? input.evidencia ?? '').trim();
  if (!evidence || evidence.length > 1000) {
    throw invalidPaymentRequest('La evidencia de acreditación es obligatoria y debe contener hasta 1000 caracteres.');
  }
  const requestedAt =
    input.fechaAcreditacionUtc !== undefined && input.fechaAcreditacionUtc !== null
      ? validateAccreditationInstant(input.fechaAcreditacionUtc)
      : null;
  const accreditedAt = requestedAt ?? new Date();
  const normalizedRequestedDateIso = requestedAt ? requestedAt.toISOString() : null;
  const normalizedObs = input.observaciones ?? null;
  const payloadHash = accreditPaymentPayloadHash(pagoId, evidence, normalizedRequestedDateIso, normalizedObs);

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
          throw cuentaRestringida();
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

      const isClientDeclared = locked.id_usuario_declarante !== null || locked.id_comprobante !== null;

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

      if (
        locked.estado === 'ACREDITADO' &&
        (locked.clave_idempotencia_acreditacion === key || locked.clave_acreditacion === key)
      ) {
        const samePayload =
          locked.evidencia_acreditacion === evidence &&
          (normalizedRequestedDateIso === null || locked.fecha_acreditacion_iso === normalizedRequestedDateIso) &&
          (locked.observaciones ?? null) === normalizedObs;
        if (!samePayload) throw claveIdempotenciaReutilizada();
        const existing = await findPaymentById(manager, pagoId);
        if (!existing) throw pagoNoEncontrado();
        return { result: { data: toDto(existing), replay: true } };
      }

      if (locked.estado === 'ACREDITADO') {
        if (isClientDeclared) throw pagoYaAcreditado();
        throw transicionPagoInvalida('No se puede acreditar un pago en estado ACREDITADO.');
      }

      if (locked.estado !== 'PENDIENTE') {
        throw transicionPagoInvalida(
          `No se puede acreditar un pago en estado ${locked.estado}.`,
        );
      }

      // R03: Guardia documental obligatoria para pagos declarados por cliente (#333).
      if (isClientDeclared) {
        if (locked.estado_documental === 'PENDIENTE') {
          throw pagoPendienteRevision();
        }
        if (locked.estado_documental === 'RECHAZADO') {
          throw pagoDocumentalmenteRechazado();
        }
        if (locked.estado_documental !== 'APROBADO') {
          throw pagoPendienteRevision();
        }
        if (!locked.id_comprobante) {
          throw comprobanteNoEncontrado();
        }
        const receipt = await lockPaymentReceiptForAccreditation(manager, pagoId);
        if (!receipt || !receipt.id_comprobante) {
          throw comprobanteNoEncontrado();
        }
        if (Number(receipt.id_cliente) !== clientId) {
          throw comprobanteNoEncontrado();
        }
        if (lockedAccount && Number(receipt.id_cuenta_corriente) !== lockedAccount.id_cuenta_corriente) {
          throw comprobanteNoEncontrado();
        }
        if (lockedOrder && Number(receipt.id_pedido) !== lockedOrder.id_pedido) {
          throw comprobanteNoEncontrado();
        }
        if (
          lockedAccount &&
          receipt.id_pedido !== null &&
          (
            receipt.pedido_id === null ||
            Number(receipt.pedido_cliente) !== Number(receipt.id_cliente) ||
            receipt.modalidad_pago !== 'CUENTA_CORRIENTE'
          )
        ) {
          throw comprobanteNoEncontrado();
        }
        if (receipt.estado_revision === 'RECHAZADO') {
          throw pagoDocumentalmenteRechazado(
            'El comprobante asociado al pago fue rechazado documentalmente y no admite acreditación.',
          );
        }
      }

      if (locked.moneda !== 'USD' && locked.moneda !== 'ARS') {
        throw invalidPaymentRequest('El pago no posee una moneda válida (USD o ARS).');
      }
      const montoCents = parsePaymentAmount(locked.monto);
      if (montoCents === null) {
        throw invalidPaymentRequest('El monto del pago es inválido.');
      }

      if (lockedAccount) {
        const accountState = await calcularEstadoCuenta(lockedAccount.id_cuenta_corriente, manager, { lock: true });
        if (!accountState) throw cuentaNoEncontrada();
        if (accountState.libro_mixto) throw cuentaRestringida();
        if (accountState.cobertura !== 'COMPLETA') throw cuentaNoAcreditada();
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
        { isClientDeclared },
      );

      const affected = await markPaymentAccredited(manager, {
        pagoId,
        montoUsd: conversion.montoUsd,
        idCotizacion: conversion.idCotizacion,
        tasaHistorica: conversion.tasaHistorica,
        evidenciaAcreditacion: evidence,
        fechaAcreditacionUtc: utcSql(accreditedAt),
        observaciones: input.observaciones,
        claveIdempotenciaAcreditacion: key,
        huellaAcreditacion: payloadHash,
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
            autorizado_por: String(auth.id),
          }, manager);
        } catch (error) {
          mapLedgerError(error, isClientDeclared);
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
      if (
        locked.clave_idempotencia === key ||
        locked.clave_idempotencia_acreditacion === key ||
        locked.clave_acreditacion === key
      ) {
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
      if (
        locked.clave_idempotencia === key ||
        locked.clave_idempotencia_acreditacion === key ||
        locked.clave_acreditacion === key
      ) {
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
