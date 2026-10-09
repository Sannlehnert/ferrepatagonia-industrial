import type { RequestHandler } from 'express';
import { verifyToken } from '../services/token.service';
import type { Role } from '../types/auth';

// #148 definirá la traducción de esta denegación al contrato HTTP 403.
export class AuthorizationDeniedError extends Error {
  constructor() {
    super('El rol autenticado no tiene permiso.');
    this.name = 'AuthorizationDeniedError';
  }
}

export const authenticate: RequestHandler = (req, res, next) => {
  delete req.auth;
  const token: unknown = req.cookies?.jwt_token;
  if (typeof token !== 'string' || !token) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  try {
    req.auth = verifyToken(token);
  } catch {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }
  next();
};

// Uso esperado: authenticate, authorizeRoles('ADMIN'). No consulta JWT ni BD.
export function authorizeRoles(...roles: Role[]): RequestHandler {
  return (req, res, next) => {
    if (!req.auth) {
      res.status(401).json({ message: 'No autenticado.' });
      return;
    }
    if (!roles.includes(req.auth.rol)) {
      next(new AuthorizationDeniedError());
      return;
    }
    next();
  };
}
