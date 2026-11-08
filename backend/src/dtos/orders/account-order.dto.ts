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
  const isEmptyObject =
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === 0;

  if (!isEmptyObject) {
    return {
      valid: false as const,
      code: 'SOLICITUD_INVALIDA',
      message: 'El cuerpo de la solicitud debe ser un objeto vacío.',
    };
  }

  return { valid: true as const };
}