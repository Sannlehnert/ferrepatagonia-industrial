import { registrationPasswordError } from './password-policy';
import bcrypt from 'bcryptjs';

// Costo explícito para el proyecto académico; medir antes de cambiarlo.
const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  // bcrypt solo considera 72 bytes UTF-8: nunca aceptar truncamiento silencioso.
  const error = registrationPasswordError(password);
  if (error) throw Object.assign(new Error(error), { status: 400 });

  // La API asíncrona genera un salt aleatorio nuevo e incluido en el hash.
  // No normalizar la contraseña ni registrar su valor o el hash.
  return bcrypt.hash(password, SALT_ROUNDS);
}
