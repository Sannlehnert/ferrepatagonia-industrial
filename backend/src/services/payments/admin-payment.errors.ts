export class AdminPaymentError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AdminPaymentError';
  }
}

export const invalidPaymentRequest = (message = 'La solicitud de pago no es válida.') =>
  new AdminPaymentError('SOLICITUD_INVALIDA', 400, message);

export const claveIdempotenciaRequerida = () =>
  new AdminPaymentError(
    'CLAVE_IDEMPOTENCIA_REQUERIDA',
    400,
    'La cabecera Idempotency-Key (UUID v4) es obligatoria para esta operación.',
  );

export const noAutenticado = () =>
  new AdminPaymentError('NO_AUTENTICADO', 401, 'No autenticado.');

export const sinPermiso = () =>
  new AdminPaymentError('SIN_PERMISO', 403, 'El rol autenticado no tiene permiso.');

export const pagoNoEncontrado = () =>
  new AdminPaymentError('PAGO_NO_ENCONTRADO', 404, 'No se encontró el pago solicitado.');

export const pedidoNoEncontrado = () =>
  new AdminPaymentError('PEDIDO_NO_ENCONTRADO', 404, 'No se encontró el pedido indicado.');

export const cuentaNoEncontrada = () =>
  new AdminPaymentError('CUENTA_NO_ENCONTRADA', 404, 'No se encontró la cuenta corriente indicada.');

export const transicionPagoInvalida = (message = 'La transición solicitada sobre el pago no está permitida.') =>
  new AdminPaymentError('TRANSICION_PAGO_INVALIDA', 409, message);

export const claveIdempotenciaReutilizada = () =>
  new AdminPaymentError(
    'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    409,
    'La clave de idempotencia ya fue utilizada con otros parámetros.',
  );

export const conflictoConcurrencia = () =>
  new AdminPaymentError(
    'CONFLICTO_CONCURRENCIA',
    409,
    'La operación encontró un conflicto concurrente. Reintentá con la misma clave de idempotencia.',
  );

export const cotizacionNoVerificada = (
  message = 'No existe una cotización BNA vendedor verificada por FER17-v1 para acreditar el pago en ARS.',
) => new AdminPaymentError('COTIZACION_FER17_NO_VERIFICADA', 422, message);
