import type { Request, RequestHandler, Response } from 'express';
import { DatabaseOutcomeUnknownError } from '../config/database-policy';
import {
  normalizePaymentIdempotencyKey,
  type AccreditPayment,
  type DeclarePayment,
  type ReviewPayment,
} from '../dtos/payments/payment.dto';
import {
  accreditPayment,
  declarePayment,
  getAdminPayment as getAdminPaymentService,
  getClientPayment as getClientPaymentService,
  listAdminPayments,
  listClientPayments,
  reviewPayment,
} from '../services/payments/payment.service';
import {
  claveIdempotenciaRequerida,
  PaymentError,
  resultadoDesconocido,
} from '../services/payments/payment.errors';

function privacy(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
}

function requireKey(req: Request): string {
  const key = normalizePaymentIdempotencyKey(req.get('Idempotency-Key'));
  if (!key) throw claveIdempotenciaRequerida();
  return key;
}

function respond(res: Response, status: number, data: unknown, replay?: boolean): void {
  res.status(status).json({
    data,
    ...(replay === undefined ? {} : { meta: { replay } }),
  });
}

function fail(res: Response, error: unknown, fallback: string): void {
  privacy(res);
  if (error instanceof PaymentError) {
    res.status(error.status).json({
      message: error.message,
      code: error.code,
      ...(error.details ?? {}),
    });
    return;
  }
  if (error instanceof DatabaseOutcomeUnknownError) {
    const failure = resultadoDesconocido();
    res.status(failure.status).json({ message: failure.message, code: failure.code });
    return;
  }
  if (error instanceof Error && error.message === 'CONSULTA_INVALIDA') {
    res.status(400).json({ message: 'La consulta de pagos es inválida.', code: 'CONSULTA_INVALIDA' });
    return;
  }
  const candidate = (error && typeof error === 'object' ? error : {}) as {
    code?: string; driverError?: { code?: string };
  };
  const databaseCode = candidate.driverError?.code ?? candidate.code;
  if (databaseCode === 'ER_DUP_ENTRY' || databaseCode === 'ER_LOCK_WAIT_TIMEOUT'
    || databaseCode === 'ER_LOCK_DEADLOCK' || databaseCode === 'ER_STATEMENT_TIMEOUT') {
    res.status(409).json({
      message: 'La operación encontró un conflicto concurrente. Reintentá con la misma clave de idempotencia.',
      code: 'CONFLICTO_CONCURRENCIA',
    });
    return;
  }
  console.error('Error interno en el flujo de pagos.');
  res.status(500).json({ message: fallback });
}

export const postDeclarePayment: RequestHandler = async (req, res) => {
  privacy(res);
  try {
    const dto = res.locals.dto.body as DeclarePayment;
    const result = await declarePayment(req.auth!, dto, requireKey(req));
    respond(res, result.replay ? 200 : 201, result.data, result.replay);
  } catch (error) {
    fail(res, error, 'No se pudo registrar la declaración de pago.');
  }
};

export const getClientPayments: RequestHandler = async (req, res) => {
  privacy(res);
  try {
    const data = await listClientPayments(req.auth!, req.originalUrl || req.url || '');
    respond(res, 200, data);
  } catch (error) {
    fail(res, error, 'No se pudieron consultar los pagos.');
  }
};

export const getClientPayment: RequestHandler = async (req, res) => {
  privacy(res);
  try {
    const { id } = res.locals.dto.params as { id: number };
    const data = await getClientPaymentService(req.auth!, id);
    respond(res, 200, data);
  } catch (error) {
    fail(res, error, 'No se pudo consultar el pago.');
  }
};

export const getAdminPayments: RequestHandler = async (req, res) => {
  privacy(res);
  try {
    const data = await listAdminPayments(req.auth!, req.originalUrl || req.url || '');
    respond(res, 200, data);
  } catch (error) {
    fail(res, error, 'No se pudieron consultar los pagos.');
  }
};

export const getAdminPayment: RequestHandler = async (req, res) => {
  privacy(res);
  try {
    const { id } = res.locals.dto.params as { id: number };
    const data = await getAdminPaymentService(req.auth!, id);
    respond(res, 200, data);
  } catch (error) {
    fail(res, error, 'No se pudo consultar el pago.');
  }
};

export const patchReviewPayment: RequestHandler = async (req, res) => {
  privacy(res);
  try {
    const { id } = res.locals.dto.params as { id: number };
    const body = res.locals.dto.body as ReviewPayment;
    const rawKey = req.get('Idempotency-Key');
    const result = await reviewPayment(req.auth!, id, body, rawKey);
    respond(res, 200, result.data, result.replay);
  } catch (error) {
    fail(res, error, 'No se pudo registrar la revisión documental del pago.');
  }
};

export const postAccreditPayment: RequestHandler = async (req, res) => {
  privacy(res);
  try {
    const { id } = res.locals.dto.params as { id: number };
    const body = res.locals.dto.body as AccreditPayment;
    const result = await accreditPayment(req.auth!, id, body, requireKey(req));
    respond(res, 200, result.data, result.replay);
  } catch (error) {
    fail(res, error, 'No se pudo acreditar el pago.');
  }
};
