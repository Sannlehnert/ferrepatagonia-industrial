import type { Request, RequestHandler } from 'express';
import {
  authenticateRequest,
  authorizeRequest,
} from '../middlewares/auth.middleware';
import {
  validateTransferConfirmationBody,
} from '../dtos/orders/transfer-order.dto';
import { cartAdmission } from '../services/cart.admission';
import { CartError } from '../services/cart.errors';
import {
  AccountOrderError,
} from '../services/orders/account-order.errors';
import {
  confirmTransferOrder,
  getTransferOrderEligibility,
  getTransferOrderResult,
} from '../services/orders/transfer-order.service';
import type { RealtimeRequest } from '../realtime/committed-change';
import { academicCheckoutFor } from '../services/orders/academic-checkout';

type TransferOperation = 'confirm' | 'recover' | 'eligibility';

function validateTransferRequest(req: Request, operation: TransferOperation): void {
  if (Object.keys(req.query).length > 0) {
    throw new AccountOrderError(
      'SOLICITUD_INVALIDA',
      400,
      'Esta operación no admite parámetros de consulta.',
    );
  }

  if (operation === 'confirm') {
    const validation = validateTransferConfirmationBody(req.body);

    if (!validation.valid) {
      throw new AccountOrderError(
        validation.code,
        400,
        validation.message,
      );
    }

    return;
  }

  if (
    req.body !== undefined ||
    req.headers['transfer-encoding'] !== undefined ||
    Number(req.headers['content-length'] ?? 0) > 0
  ) {
    throw new AccountOrderError(
      'SOLICITUD_INVALIDA',
      400,
      operation === 'eligibility'
        ? 'La consulta de elegibilidad no admite un cuerpo.'
        : 'La consulta del resultado no admite un cuerpo.',
    );
  }
}

export function handleTransferOrder(
  operation: TransferOperation,
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
          validateTransferRequest(req, operation);

          const result = operation === 'confirm'
            ? await confirmTransferOrder(
              auth,
              req.get('Idempotency-Key'),
              (req.body as { cotizacion: string }).cotizacion,
              (req as RealtimeRequest).notifyCommittedChange,
              academicCheckoutFor(req),
            )
            : operation === 'recover'
              ? await getTransferOrderResult(
                auth,
                req.params.clave,
              )
              : await getTransferOrderEligibility(auth, academicCheckoutFor(req));

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
