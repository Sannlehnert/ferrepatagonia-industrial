export type AdminPaymentErrorDetails = Record<string, string | number | boolean | null>;

export class AdminPaymentError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: AdminPaymentErrorDetails,
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

export const comprobanteNoEncontrado = () =>
  new AdminPaymentError(
    'COMPROBANTE_NO_ENCONTRADO',
    404,
    'No se encontró un comprobante válido asociado al pago para este cliente y cuenta.',
  );

export const transicionPagoInvalida = (message = 'La transición solicitada sobre el pago no está permitida.') =>
  new AdminPaymentError('TRANSICION_PAGO_INVALIDA', 409, message);

export const pagoYaAcreditado = () =>
  new AdminPaymentError('PAGO_YA_ACREDITADO', 409, 'El pago ya fue acreditado.');

export const pagoPendienteRevision = () =>
  new AdminPaymentError(
    'PAGO_PENDIENTE_REVISION',
    409,
    'El pago declarado por cliente debe tener la revisión documental aprobada antes de acreditarse.',
  );

export const pagoDocumentalmenteRechazado = (
  message = 'El pago declarado por cliente fue rechazado documentalmente y no puede acreditarse.',
) => new AdminPaymentError('PAGO_DOCUMENTALMENTE_RECHAZADO', 409, message);

export const cuentaNoAcreditada = () =>
  new AdminPaymentError(
    'CUENTA_NO_ACREDITADA',
    409,
    'La cuenta corriente no posee cobertura histórica acreditada para registrar o anular el abono.',
  );

export const cuentaRestringida = () =>
  new AdminPaymentError(
    'CUENTA_RESTRINGIDA',
    409,
    'La cuenta corriente tiene un libro restringido o sintético y no admite acreditaciones.',
  );

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

export const cotizacionAusente = () =>
  new AdminPaymentError(
    'COTIZACION_AUSENTE',
    409,
    'No existe una cotización FER17-v1 verificada para la fecha de acreditación.',
    { origen: 'FER17-v1' },
  );

export const cotizacionInvalida = (
  message = 'La cotización FER17-v1 de la fecha de acreditación no es válida o no está verificada.',
) => new AdminPaymentError('COTIZACION_INVALIDA', 422, message, { origen: 'FER17-v1' });

export const cotizacionNoVerificada = (
  message = 'No existe una cotización BNA vendedor verificada por FER17-v1 para acreditar el pago en ARS.',
) => new AdminPaymentError('COTIZACION_FER17_NO_VERIFICADA', 422, message);

export const montoUsdInvalido = () =>
  new AdminPaymentError(
    'MONTO_USD_INVALIDO',
    422,
    'El importe convertido a USD resulta no positivo o fuera del rango permitido.',
  );
