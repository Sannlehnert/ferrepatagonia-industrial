import type { Request, RequestHandler } from 'express';
import {
  authenticateRequest,
  authorizeRequest,
} from '../middlewares/auth.middleware';
import {
  validateConfirmationBody,
} from '../dtos/orders/account-order.dto';
import { cartAdmission } from '../services/cart.admission';
import { CartError } from '../services/cart.errors';
import {
  AccountOrderError,
} from '../services/orders/account-order.errors';
import {
  confirmAccountOrder,
  getAccountOrderEligibility,
  getAccountOrderResult,
  getClientOrderDetail,
  listClientOrders,
} from '../services/orders/account-order.service';

type Operation = 'confirm' | 'recover' | 'eligibility';
type OrderMutationOperation = 'confirm' | 'recover' | 'eligibility';
type OrderReadOperation = 'list' | 'detail';

function validateRequest(req: Request, operation: OrderMutationOperation | OrderReadOperation): void {
  if (Object.keys(req.query).length > 0) {
    throw new AccountOrderError(
      'SOLICITUD_INVALIDA',
      400,
      'Esta operación no admite parámetros de consulta.',
    );
  }

  if (operation === 'confirm') {
    const validation = validateConfirmationBody(req.body);

    if (!validation.valid) {
      throw new AccountOrderError(
        validation.code,
        400,
        validation.message,
      );
    }

    return;
  }

  if (req.body !== undefined ||
    req.headers['transfer-encoding'] !== undefined ||
    Number(req.headers['content-length'] ?? 0) > 0) {
    throw new AccountOrderError(
      'SOLICITUD_INVALIDA',
      400,
      operation === 'eligibility'
        ? 'La consulta de elegibilidad no admite un cuerpo.'
        : operation === 'recover'
          ? 'La consulta del resultado no admite un cuerpo.'
          : 'La consulta no admite un cuerpo.',
    );
  }
}

export function handleAccountOrder(
  operation: Operation,
): RequestHandler {
  return async (req, res) => {
    const cancellation = new AbortController();
    const disconnect = () => cancellation.abort();

    res.once('close', disconnect);

    if (res.destroyed) {
      cancellation.abort();
    }

    try {
      await cartAdmission.run(
        cancellation.signal,
        async () => {
          if (!await authenticateRequest(req, res)) {
            return undefined;
          }

          if (!authorizeRequest(req, res, ['CLIENTE'])) {
            return undefined;
          }

          return req.auth;
        },
        async auth => {
          validateRequest(req, operation);

          const result = operation === 'confirm'
            ? await confirmAccountOrder(
              auth,
              req.get('Idempotency-Key'),
              (req.body as { cotizacion: string }).cotizacion,
            )
            : operation === 'recover'
              ? await getAccountOrderResult(
                auth,
                req.params.clave,
              )
              : await getAccountOrderEligibility(auth);

          if (cancellation.signal.aborted) return;

          if (result.status === 202) {
            res.setHeader('Retry-After', '1');
          }

          res.status(result.status).json(result.body);
        },
        { serializePerUser: operation !== 'recover' },
      );
    } catch (error) {
      if (cancellation.signal.aborted || res.headersSent) return;

      if (error instanceof AccountOrderError) {
        res.status(error.status).json({
          code: error.code,
          message: error.message,
        });
        return;
      }

      res.status(503).json({
        code: error instanceof CartError
          ? 'CONFIRMACION_OCUPADA'
          : 'CONFIRMACION_NO_DISPONIBLE',
        message: 'Consultá el resultado con la misma clave antes de reintentar.',
      });
    } finally {
      res.removeListener('close', disconnect);
    }
  };
}

export function handleClientOrderRead(
  operation: OrderReadOperation,
): RequestHandler {
  return async (req, res) => {
    try {
      if (!await authenticateRequest(req, res)) {
        return;
      }

      if (!authorizeRequest(req, res, ['CLIENTE'])) {
        return;
      }

      validateRequest(req, operation);

      const result = operation === 'list'
        ? await listClientOrders(req.auth!)
        : await getClientOrderDetail(req.auth!, req.params.id);

      res.status(result.status).json(result.body);
    } catch (error) {
      if (res.headersSent) return;

      if (error instanceof AccountOrderError) {
        res.status(error.status).json({
          code: error.code,
          message: error.message,
        });
        return;
      }

      res.status(503).json({
        code: 'CONSULTA_PEDIDOS_NO_DISPONIBLE',
        message: 'El historial de pedidos no está disponible temporalmente. Reintentá en unos instantes.',
      });
    }
  };
}