export type PaymentErrorDetails = Record<string, string | number | boolean | null>;

export class PaymentError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: PaymentErrorDetails,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export const invalidPaymentRequest = (message = 'La solicitud de pago es inválida.') =>
  new PaymentError('SOLICITUD_INVALIDA', 400, message);

export const noAutenticado = () =>
  new PaymentError('NO_AUTENTICADO', 401, 'No autenticado.');

export const sinPermiso = () =>
  new PaymentError('SIN_PERMISO', 403, 'No tenés permiso para acceder a este recurso.');

export const clienteInactivo = () =>
  new PaymentError('CLIENTE_INACTIVO', 403, 'La cuenta de cliente no está habilitada.');

export const cuentaNoEncontrada = () =>
  new PaymentError('CUENTA_NO_ENCONTRADA', 404, 'No se encontró una cuenta corriente habilitada para el pago.');

export const comprobanteNoEncontrado = () =>
  new PaymentError('COMPROBANTE_NO_ENCONTRADO', 404, 'No se encontró el comprobante indicado para esta cuenta.');

export const pagoNoEncontrado = () =>
  new PaymentError('PAGO_NO_ENCONTRADO', 404, 'No se encontró el pago indicado.');

export const claveIdempotenciaRequerida = () =>
  new PaymentError(
    'CLAVE_IDEMPOTENCIA_REQUERIDA',
    400,
    'La cabecera Idempotency-Key es obligatoria y debe ser un UUID v4.',
  );

export const claveIdempotenciaReutilizada = () =>
  new PaymentError(
    'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    409,
    'La clave de idempotencia ya fue utilizada para otra operación.',
  );

export const comprobanteYaDeclarado = () =>
  new PaymentError(
    'COMPROBANTE_YA_DECLARADO',
    409,
    'El comprobante ya fue utilizado en otra declaración de pago.',
  );

export const pagoYaRevisado = () =>
  new PaymentError('PAGO_YA_REVISADO', 409, 'La revisión documental del pago ya fue resuelta.');

export const pagoYaAcreditado = () =>
  new PaymentError('PAGO_YA_ACREDITADO', 409, 'El pago ya fue acreditado.');

export const pagoNoAcreditable = (message = 'El pago no se encuentra en un estado acreditable.') =>
  new PaymentError('TRANSICION_PAGO_INVALIDA', 409, message);

export const pagoPendienteRevision = () =>
  new PaymentError(
    'PAGO_PENDIENTE_REVISION',
    409,
    'El pago debe tener la revisión documental aprobada antes de acreditarse.',
  );

export const cuentaNoAcreditada = () =>
  new PaymentError(
    'CUENTA_NO_ACREDITADA',
    409,
    'La cuenta corriente no tiene cobertura histórica completa para acreditar pagos.',
  );

export const cuentaRestringida = () =>
  new PaymentError(
    'CUENTA_RESTRINGIDA',
    409,
    'La cuenta corriente tiene un libro restringido o sintético y no admite acreditaciones.',
  );

export const conflictoConcurrencia = () =>
  new PaymentError(
    'CONFLICTO_CONCURRENCIA',
    409,
    'La operación no pudo completarse por un cambio concurrente. Reintentá la consulta.',
  );

export const resultadoDesconocido = () =>
  new PaymentError(
    'RESULTADO_DESCONOCIDO',
    503,
    'No se pudo confirmar el resultado de la operación. Reintentá con la misma clave de idempotencia.',
  );
