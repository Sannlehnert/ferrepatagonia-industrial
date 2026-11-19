import type {
  TransferOrderAttempt,
} from '../../repositories/transferOrderAttempt.repository';
import type { TransferOrderResult } from './account-order.types';
import { AccountOrderError } from './account-order.errors';

export function pendingTransferOrder(): TransferOrderResult {
  return {
    status: 202,
    body: {
      data: {
        estado: 'PENDIENTE',
        code: 'CONFIRMACION_PENDIENTE',
        message: 'No hay un resultado definitivo. Conservá la misma clave para consultar o reintentar.',
      },
    },
  };
}

function invalidResult(): never {
  throw new AccountOrderError(
    'RESULTADO_NO_DISPONIBLE', 503,
    'No se pudo verificar el resultado guardado.',
  );
}

export function presentStoredTransferOrder(
  attempt: TransferOrderAttempt,
): TransferOrderResult {
  if (attempt.state === 'PENDIENTE') return pendingTransferOrder();

  let body;
  try {
    body = JSON.parse(attempt.responseJson ?? '');
  } catch {
    invalidResult();
  }

  if (attempt.state === 'CONFIRMADO') {
    const data = body?.data;

    if (
      attempt.orderId === null ||
      attempt.httpStatus !== 201 ||
      data?.pedidoId !== attempt.orderId ||
      data?.estado !== 'CONFIRMADO' ||
      data?.modalidadPago !== 'TRANSFERENCIA' ||
      data?.moneda !== 'USD' ||
      typeof data?.totalUSD !== 'string' ||
      !/^(0|[1-9]\d{0,9})\.\d{2}$/.test(data.totalUSD) ||
      data.totalUSD === '0.00' ||
      (data.simulado !== undefined && data.simulado !== true) ||
      data.cargoId !== undefined ||
      data.venceEl !== undefined
    ) {
      invalidResult();
    }

    return {
      status: 200,
      body: {
        data: {
          pedidoId: attempt.orderId,
          estado: 'CONFIRMADO',
          modalidadPago: 'TRANSFERENCIA',
          moneda: 'USD',
          totalUSD: data.totalUSD,
          ...(data.simulado === true ? { simulado: true as const } : {}),
        },
      },
    };
  }

  const status = attempt.httpStatus;
  if (
    attempt.state === 'RECHAZADO' &&
    (status === 400 || status === 403 ||
      status === 409 || status === 422) &&
    typeof body?.code === 'string' &&
    /^[A-Z][A-Z0-9_]{0,79}$/.test(body.code) &&
    typeof body?.message === 'string' &&
    body.message.trim().length > 0 &&
    body.message.length <= 400
  ) {
    return {
      status,
      body: { estado: 'RECHAZADO', code: body.code, message: body.message },
    };
  }

  return invalidResult();
}
