import type { Request, RequestHandler, Response } from 'express';
import { DatabaseOutcomeUnknownError } from '../config/database-policy';
import {
  normalizeIdempotencyKey,
  parseCreditEventListQuery,
  parseCreditRequestListQuery,
  type ApproveCreditRequest,
  type ChangeCreditLimit,
  type CreateCreditRequest,
  type DisableCreditAccount,
  type EnableCreditAccount,
  type RejectCreditRequest,
} from '../dtos/credit/credit-workflow.dto';
import {
  approveCreditRequest,
  changeCreditLimit,
  createCreditRequest,
  disableCreditAccount,
  enableCreditAccount,
  getAdminCreditRequest,
  getClientCreditRequest,
  listAdminCreditRequests,
  listClientCreditRequests,
  listCreditEvents,
  rejectCreditRequest,
} from '../services/credit/credit-workflow.service';
import {
  getAdminCreditCompany,
  listAdminCreditCompanies,
} from '../services/credit/admin-credit-companies.service';
import { parseAdminCreditCompanyQuery } from '../dtos/credit/admin-credit-companies.dto';
import {
  claveIdempotenciaRequerida,
  CreditWorkflowError,
} from '../services/credit/credit-workflow.errors';
import {
  accountSourceUnavailable,
  isAccountSourceUnavailable,
} from '../services/adminAccount.errors';

function requireIdempotencyKey(req: Request): string {
  const key = normalizeIdempotencyKey(req.get('Idempotency-Key'));
  if (!key) throw claveIdempotenciaRequerida();
  return key;
}

function respond(res: Response, status: number, data: unknown, eventoId?: string, replay?: boolean): void {
  res.status(status).json({
    data,
    ...(eventoId !== undefined ? { meta: { eventoId, replay: replay === true } } : {}),
  });
}

function fail(res: Response, error: unknown, fallback: string): void {
  if (error instanceof CreditWorkflowError) {
    res.status(error.status).json({
      message: error.message,
      code: error.code,
      ...(error.details ?? {}),
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
  const candidate = (error && typeof error === 'object'
    ? error : {}) as { code?: string; driverError?: { code?: string } };
  const databaseCode = candidate.driverError?.code ?? candidate.code;
  if (databaseCode === 'ER_DUP_ENTRY' || databaseCode === 'ER_LOCK_WAIT_TIMEOUT'
    || databaseCode === 'ER_LOCK_DEADLOCK' || databaseCode === 'ER_STATEMENT_TIMEOUT') {
    res.status(409).json({
      message: 'La operación encontró un conflicto concurrente. Reintentá con la misma clave de idempotencia.',
      code: 'CONFLICTO_CONCURRENCIA',
    });
    return;
  }
  console.error('Error interno en el flujo de crédito.');
  res.status(500).json({ message: fallback });
}

export const postClientCreditRequest: RequestHandler = async (req, res) => {
  try {
    const dto = res.locals.dto.body as CreateCreditRequest;
    const result = await createCreditRequest(req.auth!, dto, requireIdempotencyKey(req));
    respond(res, result.replay ? 200 : 201, result.data, result.eventoId, result.replay);
  } catch (error) {
    fail(res, error, 'No se pudo registrar la solicitud de crédito.');
  }
};

export const getClientCreditRequests: RequestHandler = async (req, res) => {
  try {
    const query = parseCreditRequestListQuery(req.originalUrl, false);
    const data = await listClientCreditRequests(req.auth!, query);
    respond(res, 200, data);
  } catch (error) {
    fail(res, error, 'No se pudieron consultar las solicitudes de crédito.');
  }
};

export const getClientCreditRequestById: RequestHandler = async (req, res) => {
  try {
    const { id } = res.locals.dto.params as { id: number };
    const data = await getClientCreditRequest(req.auth!, id);
    respond(res, 200, data);
  } catch (error) {
    fail(res, error, 'No se pudo consultar la solicitud de crédito.');
  }
};

export const getAdminCreditRequests: RequestHandler = async (req, res) => {
  try {
    const query = parseCreditRequestListQuery(req.originalUrl, true);
    const data = await listAdminCreditRequests(req.auth!, query);
    respond(res, 200, data);
  } catch (error) {
    fail(res, error, 'No se pudieron consultar las solicitudes de crédito.');
  }
};

export const getAdminCreditRequestById: RequestHandler = async (req, res) => {
  try {
    const { id } = res.locals.dto.params as { id: number };
    const data = await getAdminCreditRequest(req.auth!, id);
    respond(res, 200, data);
  } catch (error) {
    fail(res, error, 'No se pudo consultar la solicitud de crédito.');
  }
};

export const postApproveCreditRequest: RequestHandler = async (req, res) => {
  try {
    const { id } = res.locals.dto.params as { id: number };
    const body = res.locals.dto.body as ApproveCreditRequest;
    const result = await approveCreditRequest(req.auth!, id, body, requireIdempotencyKey(req));
    respond(res, 200, result.data, result.eventoId, result.replay);
  } catch (error) {
    fail(res, error, 'No se pudo aprobar la solicitud de crédito.');
  }
};

export const postRejectCreditRequest: RequestHandler = async (req, res) => {
  try {
    const { id } = res.locals.dto.params as { id: number };
    const body = res.locals.dto.body as RejectCreditRequest;
    const result = await rejectCreditRequest(req.auth!, id, body, requireIdempotencyKey(req));
    respond(res, 200, result.data, result.eventoId, result.replay);
  } catch (error) {
    fail(res, error, 'No se pudo rechazar la solicitud de crédito.');
  }
};

export const postEnableCreditAccount: RequestHandler = async (req, res) => {
  try {
    const { clienteId } = res.locals.dto.params as { clienteId: number };
    const body = res.locals.dto.body as EnableCreditAccount;
    const result = await enableCreditAccount(req.auth!, clienteId, body, requireIdempotencyKey(req));
    respond(res, 200, result.data, result.eventoId, result.replay);
  } catch (error) {
    fail(res, error, 'No se pudo habilitar la cuenta corriente.');
  }
};

export const postDisableCreditAccount: RequestHandler = async (req, res) => {
  try {
    const { clienteId } = res.locals.dto.params as { clienteId: number };
    const body = res.locals.dto.body as DisableCreditAccount;
    const result = await disableCreditAccount(req.auth!, clienteId, body, requireIdempotencyKey(req));
    respond(res, 200, result.data, result.eventoId, result.replay);
  } catch (error) {
    fail(res, error, 'No se pudo deshabilitar la cuenta corriente.');
  }
};

export const putCreditLimit: RequestHandler = async (req, res) => {
  try {
    const { clienteId } = res.locals.dto.params as { clienteId: number };
    const body = res.locals.dto.body as ChangeCreditLimit;
    const result = await changeCreditLimit(req.auth!, clienteId, body, requireIdempotencyKey(req));
    respond(res, 200, result.data, result.eventoId || undefined, result.replay);
  } catch (error) {
    fail(res, error, 'No se pudo modificar el límite de crédito.');
  }
};

function failCreditCompany(res: Response, error: unknown, fallback: string): void {
  if (isAccountSourceUnavailable(error)) {
    const unavailable = accountSourceUnavailable();
    res.status(unavailable.status).json({ message: unavailable.message, code: unavailable.code });
    return;
  }
  fail(res, error, fallback);
}

export const getAdminCreditCompanies: RequestHandler = async (req, res) => {
  try {
    const query = parseAdminCreditCompanyQuery(req.originalUrl);
    const data = await listAdminCreditCompanies(req.auth!, query);
    respond(res, 200, data);
  } catch (error) {
    failCreditCompany(res, error, 'No se pudieron consultar las empresas para gestión de crédito.');
  }
};

export const getAdminCreditCompanyById: RequestHandler = async (req, res) => {
  try {
    const { clienteId } = res.locals.dto.params as { clienteId: number };
    const data = await getAdminCreditCompany(req.auth!, clienteId);
    respond(res, 200, data);
  } catch (error) {
    failCreditCompany(res, error, 'No se pudo consultar la empresa para gestión de crédito.');
  }
};

export const getAdminCreditEvents: RequestHandler = async (req, res) => {
  try {
    const query = parseCreditEventListQuery(req.originalUrl);
    const data = await listCreditEvents(req.auth!, query);
    respond(res, 200, data);
  } catch (error) {
    fail(res, error, 'No se pudo consultar la auditoría de crédito.');
  }
};
