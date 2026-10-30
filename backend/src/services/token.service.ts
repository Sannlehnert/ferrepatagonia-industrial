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

// Only consume claims after cryptographic verification (jwt.verify or Passport JWT).
// Expiration is mandatory for this application's session-token profile.
export function readAuthClaims(payload: unknown): AuthContext {
  if (
    typeof payload !== 'object' || payload === null ||
    !('id' in payload) || typeof payload.id !== 'number' ||
    !Number.isSafeInteger(payload.id) || payload.id <= 0 ||
    !('rol' in payload) || (payload.rol !== 'CLIENTE' && payload.rol !== 'ADMIN') ||
    !('exp' in payload) || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)
  ) {
    throw new Error('Payload de autenticación inválido.');
  }
  return { id: payload.id, rol: payload.rol };
}

export function verifyToken(token: string): AuthContext {
  return readAuthClaims(jwt.verify(token, env.jwtSecret, { algorithms: [algorithm] }));
}
