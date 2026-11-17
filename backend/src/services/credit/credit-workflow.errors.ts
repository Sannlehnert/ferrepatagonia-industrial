export type CreditWorkflowErrorDetails = Record<string, string | number | boolean | null>;

/**
 * Error de dominio del flujo de crédito. El controlador solo expone el
 * mensaje y el código authored; nunca detalles de SQL ni valores internos.
 */
export class CreditWorkflowError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: CreditWorkflowErrorDetails,
  ) {
    super(message);
    this.name = 'CreditWorkflowError';
  }
}

export const invalidCreditRequest = (message = 'La solicitud de crédito es inválida.') =>
  new CreditWorkflowError('SOLICITUD_INVALIDA', 400, message);

export const noAutenticado = () =>
  new CreditWorkflowError('NO_AUTENTICADO', 401, 'No autenticado.');

export const sinPermiso = () =>
  new CreditWorkflowError('SIN_PERMISO', 403, 'No tenés permiso para acceder a este recurso.');

export const soloEmpresas = () =>
  new CreditWorkflowError('SOLO_EMPRESAS', 403, 'Solo las empresas pueden solicitar crédito comercial.');

export const clienteInactivo = () =>
  new CreditWorkflowError('CLIENTE_INACTIVO', 403, 'La cuenta de cliente no está habilitada.');

export const empresaNoAprobada = (status: 403 | 409 = 409) =>
  new CreditWorkflowError('EMPRESA_NO_APROBADA', status, 'La empresa debe estar activa y aprobada comercialmente.');

export const solicitudNoEncontrada = () =>
  new CreditWorkflowError('SOLICITUD_NO_ENCONTRADA', 404, 'No se encontró la solicitud de crédito.');

export const solicitudPendienteDuplicada = (solicitudId?: number) =>
  new CreditWorkflowError(
    'SOLICITUD_PENDIENTE',
    409,
    'Ya existe una solicitud de crédito pendiente para este cliente.',
    solicitudId === undefined ? undefined : { solicitudId },
  );

export const solicitudNoPendiente = () =>
  new CreditWorkflowError('SOLICITUD_NO_PENDIENTE', 409, 'La solicitud ya fue resuelta.');

export const cuentaNoEncontrada = () =>
  new CreditWorkflowError('CUENTA_NO_ENCONTRADA', 404, 'El cliente no tiene una cuenta corriente.');

export const cuentaNoAcreditada = (faltantes: string[]) =>
  new CreditWorkflowError(
    'CUENTA_NO_ACREDITADA',
    409,
    'La cuenta corriente no tiene la acreditación comercial mínima para habilitarse.',
    { faltantes: faltantes.join(',') },
  );

export const cuentaYaHabilitada = () =>
  new CreditWorkflowError('CUENTA_YA_HABILITADA', 409, 'La cuenta corriente ya está habilitada.');

export const cuentaYaDeshabilitada = () =>
  new CreditWorkflowError('CUENTA_YA_DESHABILITADA', 409, 'La cuenta corriente ya está deshabilitada.');

export const estadoFinancieroNoDeterminable = () =>
  new CreditWorkflowError(
    'ESTADO_FINANCIERO_NO_DETERMINABLE',
    409,
    'No se puede verificar el estado financiero actual de la cuenta.',
  );

export const limitePorDebajoDeDeuda = () =>
  new CreditWorkflowError(
    'LIMITE_POR_DEBAJO_DE_DEUDA',
    409,
    'El nuevo límite no puede ser inferior al crédito utilizado de la cuenta.',
  );

export const claveIdempotenciaRequerida = () =>
  new CreditWorkflowError(
    'CLAVE_IDEMPOTENCIA_REQUERIDA',
    400,
    'La cabecera Idempotency-Key es obligatoria y debe ser un UUID v4.',
  );

export const claveIdempotenciaReutilizada = () =>
  new CreditWorkflowError(
    'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    409,
    'La clave de idempotencia ya fue utilizada para otra operación.',
  );

export const conflictoConcurrencia = () =>
  new CreditWorkflowError(
    'CONFLICTO_CONCURRENCIA',
    409,
    'La operación no pudo completarse por un cambio concurrente. Reintentá la consulta.',
  );
