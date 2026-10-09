import type { RequestHandler } from 'express';
import { verifyToken } from '../services/token.service';
import type { Role } from '../types/auth';

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
      res.status(403).json({ message: 'El rol autenticado no tiene permiso.' });
      return;
    }
    next();
  };
}
