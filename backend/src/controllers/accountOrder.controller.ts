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
} from '../services/orders/account-order.service';

type Operation = 'confirm' | 'recover' | 'eligibility';

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
      operation === 'eligibility'
        ? 'La consulta de elegibilidad no admite un cuerpo.'
        : 'La consulta del resultado no admite un cuerpo.',
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
