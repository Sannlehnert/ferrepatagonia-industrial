import type { Request, RequestHandler, Response } from 'express';
import { DatabaseOutcomeUnknownError } from '../config/database-policy';
import {
  normalizePaymentIdempotencyKey,
  parseAdminPaymentListQuery,
  type AccreditAdminPaymentDto,
  type CloseAdminPaymentDto,
  type CreateAdminPaymentDto,
} from '../dtos/payments/admin-payment.dto';
import type { RealtimeRequest } from '../realtime/committed-change';
import { hasDatabaseError } from '../services/cart.errors';
import {
  AdminPaymentError,
  claveIdempotenciaRequerida,
} from '../services/payments/admin-payment.errors';
import {
  accreditAdminPaymentService,
  annulAdminPaymentService,
  createAdminPaymentService,
  getAdminPaymentDetailService,
  listAdminPaymentsService,
  rejectAdminPaymentService,
} from '../services/payments/admin-payment.service';

function requireIdempotencyKey(req: Request): string {
  const key = normalizePaymentIdempotencyKey(req.get('Idempotency-Key'));
  if (!key) throw claveIdempotenciaRequerida();
  return key;
}

function fail(res: Response, error: unknown, fallback: string): void {
  if (error instanceof AdminPaymentError) {
    res.status(error.status).json({
      message: error.message,
      code: error.code,
    });
    return;
  }
  if (error instanceof DatabaseOutcomeUnknownError) {
    res.status(503).json({
      message: 'No se pudo confirmar el resultado de la operación. Reintentá con la misma clave de idempotencia.',
      code: 'RESULTADO_DESCONOCIDO',
    });
    return;
  }
  if (
    hasDatabaseError(error, 'ER_DUP_ENTRY', 1062) ||
    hasDatabaseError(error, 'ER_LOCK_WAIT_TIMEOUT', 1205) ||
    hasDatabaseError(error, 'ER_LOCK_DEADLOCK', 1213) ||
    hasDatabaseError(error, 'ER_STATEMENT_TIMEOUT', 1969)
  ) {
    res.status(409).json({
      message: 'La operación encontró un conflicto concurrente. Reintentá con la misma clave de idempotencia.',
      code: 'CONFLICTO_CONCURRENCIA',
    });
    return;
  }
  console.error('Error interno en la gestión administrativa de pagos.');
  res.status(500).json({ message: fallback });
}

export const getAdminPayments: RequestHandler = async (req, res) => {
  try {
    const query = parseAdminPaymentListQuery(req.originalUrl);
    const data = await listAdminPaymentsService(req.auth!, query);
    res.status(200).json({ data });
  } catch (error) {
    fail(res, error, 'No se pudo consultar el listado de pagos.');
  }
};

export const getAdminPaymentById: RequestHandler = async (req, res) => {
  try {
    const { pagoId } = res.locals.dto.params as { pagoId: number };
    const data = await getAdminPaymentDetailService(req.auth!, pagoId);
    res.status(200).json({ data });
  } catch (error) {
    fail(res, error, 'No se pudo consultar el detalle del pago.');
  }
};

export const postAdminPayment: RequestHandler = async (req, res) => {
  try {
    const body = res.locals.dto.body as CreateAdminPaymentDto;
    const key = requireIdempotencyKey(req);
    const result = await createAdminPaymentService(
      req.auth!,
      body,
      key,
      (req as RealtimeRequest).notifyCommittedChange,
    );
    res.status(result.replay ? 200 : 201).json({ data: result.data, meta: { replay: result.replay } });
  } catch (error) {
    fail(res, error, 'No se pudo registrar el pago.');
  }
};

export const postAccreditAdminPayment: RequestHandler = async (req, res) => {
  try {
    const { pagoId } = res.locals.dto.params as { pagoId: number };
    const body = res.locals.dto.body as AccreditAdminPaymentDto;
    const key = requireIdempotencyKey(req);
    const result = await accreditAdminPaymentService(
      req.auth!,
      pagoId,
      body,
      key,
      (req as RealtimeRequest).notifyCommittedChange,
    );
    res.status(200).json({ data: result.data, meta: { replay: result.replay } });
  } catch (error) {
    fail(res, error, 'No se pudo acreditar el pago.');
  }
};

export const postRejectAdminPayment: RequestHandler = async (req, res) => {
  try {
    const { pagoId } = res.locals.dto.params as { pagoId: number };
    const body = res.locals.dto.body as CloseAdminPaymentDto;
    const key = requireIdempotencyKey(req);
    const result = await rejectAdminPaymentService(req.auth!, pagoId, body, key);
    res.status(200).json({ data: result.data, meta: { replay: result.replay } });
  } catch (error) {
    fail(res, error, 'No se pudo rechazar el pago.');
  }
};

export const postAnnulAdminPayment: RequestHandler = async (req, res) => {
  try {
    const { pagoId } = res.locals.dto.params as { pagoId: number };
    const body = res.locals.dto.body as CloseAdminPaymentDto;
    const key = requireIdempotencyKey(req);
    const result = await annulAdminPaymentService(
      req.auth!,
      pagoId,
      body,
      key,
      (req as RealtimeRequest).notifyCommittedChange,
    );
    res.status(200).json({ data: result.data, meta: { replay: result.replay } });
  } catch (error) {
    fail(res, error, 'No se pudo anular el pago.');
  }
};
