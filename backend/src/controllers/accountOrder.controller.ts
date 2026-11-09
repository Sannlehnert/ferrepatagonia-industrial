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
  getAccountOrderResult,
  getClientOrderDetail,
  listClientOrders,
} from '../services/orders/account-order.service';

type Operation = 'confirm' | 'recover' | 'list' | 'detail';

function validateRequest(req: Request, operation: Operation): void {
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
      'La consulta no admite un cuerpo.',
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

          let result;
          if (operation === 'confirm') {
            result = await confirmAccountOrder(auth, req.get('Idempotency-Key'));
          } else if (operation === 'recover') {
            result = await getAccountOrderResult(auth, req.params.clave);
          } else if (operation === 'list') {
            result = await listClientOrders(auth);
          } else {
            result = await getClientOrderDetail(auth, req.params.id);
          }

          if (cancellation.signal.aborted) return;

          if (result.status === 202) {
            res.setHeader('Retry-After', '1');
          }

          res.status(result.status).json(result.body);
        },
        { serializePerUser: operation === 'confirm' },
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

      const isReadOperation = operation === 'list' || operation === 'detail';
      res.status(503).json({
        code: error instanceof CartError
          ? (isReadOperation ? 'CONSULTA_PEDIDOS_OCUPADA' : 'CONFIRMACION_OCUPADA')
          : (isReadOperation ? 'CONSULTA_PEDIDOS_NO_DISPONIBLE' : 'CONFIRMACION_NO_DISPONIBLE'),
        message: isReadOperation
          ? 'El historial de pedidos no está disponible temporalmente. Reintentá en unos instantes.'
          : 'Consultá el resultado con la misma clave antes de reintentar.',
      });
    } finally {
      res.removeListener('close', disconnect);
    }
  };
}