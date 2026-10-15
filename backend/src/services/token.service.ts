import jwt from 'jsonwebtoken';
import { env } from '../config/env.config';
import type { AuthContext } from '../types/auth';

const algorithm = 'HS256';

export function signToken(auth: AuthContext): string {
  return jwt.sign({ id: auth.id, rol: auth.rol }, env.jwtSecret, {
    algorithm,
    expiresIn: '2h',
  });
}

export function verifyToken(token: string): AuthContext {
  const payload = jwt.verify(token, env.jwtSecret, { algorithms: [algorithm] });
  if (
    typeof payload !== 'object' || payload === null ||
    !Number.isSafeInteger(payload.id) || payload.id <= 0 ||
    (payload.rol !== 'CLIENTE' && payload.rol !== 'ADMIN')
  ) {
    throw new Error('Payload de autenticación inválido.');
  }
  return { id: payload.id, rol: payload.rol };
}
