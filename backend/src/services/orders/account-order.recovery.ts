import type {
  AccountOrderAttempt,
} from '../../repositories/accountOrderAttempt.repository';
import type { AccountOrderResult } from './account-order.types';
import { AccountOrderError } from './account-order.errors';

export function pendingAccountOrder(): AccountOrderResult {
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

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

export function presentStoredAccountOrder(
  attempt: AccountOrderAttempt,
): AccountOrderResult {
  if (attempt.state === 'PENDIENTE') return pendingAccountOrder();

  let body;
  try {
    body = JSON.parse(attempt.responseJson ?? '');
  } catch {
    invalidResult();
  }

  if (attempt.state === 'CONFIRMADO') {
    const data = body?.data;

    if (attempt.orderId === null || attempt.chargeId === null ||
      attempt.httpStatus !== 201 ||
      data?.pedidoId !== attempt.orderId ||
      data?.cargoId !== String(attempt.chargeId) ||
      data?.estado !== 'CONFIRMADO' ||
      data?.modalidadPago !== 'CUENTA_CORRIENTE' ||
      data?.moneda !== 'USD' ||
      typeof data?.totalUSD !== 'string' ||
      !/^(0|[1-9]\d{0,9})\.\d{2}$/.test(data.totalUSD) ||
      data.totalUSD === '0.00' ||
      !validDate(data?.venceEl)) {
      invalidResult();
    }

    return {
      status: 200,
      body: {
        data: {
          pedidoId: attempt.orderId,
          estado: 'CONFIRMADO',
          modalidadPago: 'CUENTA_CORRIENTE',
          moneda: 'USD',
          totalUSD: data.totalUSD,
          cargoId: String(attempt.chargeId),
          venceEl: data.venceEl,
        },
      },
    };
  }

  const status = attempt.httpStatus;
  if (attempt.state === 'RECHAZADO' &&
    (status === 400 || status === 403 ||
      status === 409 || status === 422) &&
    typeof body?.code === 'string' &&
    /^[A-Z][A-Z0-9_]{0,79}$/.test(body.code) &&
    typeof body?.message === 'string' &&
    body.message.trim().length > 0 &&
    body.message.length <= 400) {
    return {
      status,
      body: { estado: 'RECHAZADO', code: body.code, message: body.message },
    };
  }

  return invalidResult();
}
