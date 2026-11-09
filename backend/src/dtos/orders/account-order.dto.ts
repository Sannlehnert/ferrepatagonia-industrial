import { isUUID } from 'class-validator';
import { Rule } from '../rules';
import { validateDtoInput, type DtoPolicy } from '../validation';

class ConfirmationKey {
  @Rule(value =>
    typeof value === 'string' && isUUID(value, '4')
      ? null
      : 'Indicá una clave de idempotencia UUID v4 válida.',
  )
  clave!: string;
}

const confirmationKeyPolicy: DtoPolicy<ConfirmationKey> = {
  type: ConfirmationKey,
  fields: ['clave'],
  objectError: 'Solicitud inválida.',
  unknownError: 'La solicitud contiene campos no permitidos.',
  prepare: input => ({
    clave: typeof input.clave === 'string'
      ? input.clave.toLowerCase()
      : input.clave,
  }),
};

export async function validateConfirmationKey(value: unknown) {
  const result = await validateDtoInput(
    confirmationKeyPolicy,
    { clave: value },
  );

  if (!result.valid) {
    return {
      valid: false as const,
      code: 'CLAVE_IDEMPOTENCIA_INVALIDA',
      message: result.message,
    };
  }

  return {
    valid: true as const,
    key: result.data.clave,
  };
}

export function validateConfirmationBody(value: unknown) {
  const validObject =
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === 1 &&
    Object.keys(value).length === 1 &&
    typeof (value as { cotizacion?: unknown }).cotizacion === 'string' &&
    (value as { cotizacion: string }).cotizacion.length >= 20 &&
    (value as { cotizacion: string }).cotizacion.length <= 2048;

  if (!validObject) {
    return {
      valid: false as const,
      code: 'SOLICITUD_INVALIDA',
      message: 'La solicitud debe incluir únicamente la cotización vigente.',
    };
  }

  return { valid: true as const, quoteToken: (value as { cotizacion: string }).cotizacion };
}
