export type RegisterInput = {
  tipoCliente: 'PARTICULAR' | 'EMPRESA';
  nombreRazonSocial: string;
  email: string;
  password: string;
  docCliente: string | null;
  cuit: string | null;
  telefono: string | null;
  direccion: string | null;
};

import { registerPolicy } from '../dtos/policies';
import { validateDtoSync } from '../dtos/validation';
import { registerInput } from '../dtos/auth/registro.dto';

export function validateRegister(body: unknown) {
  const result = validateDtoSync(registerPolicy, body);
  return result.valid ? { valid: true as const, data: registerInput(result.data) } : result;
}
