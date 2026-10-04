import type { RegisterInput } from '../validators/register.validator';
import { hashPassword } from './password.service';

// Datos de USUARIO para el registro público; tipoCliente pertenece a CLIENTE.
export async function prepareRegisterUser(input: Pick<RegisterInput, 'email' | 'password'>) {
  return {
    email: input.email,
    passwordHash: await hashPassword(input.password),
    // El rol técnico se asigna exclusivamente en el servidor.
    rol: 'CLIENTE' as const,
  };
}
