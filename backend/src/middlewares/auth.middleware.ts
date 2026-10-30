import type { RequestHandler } from 'express';
import { authPassport } from '../config/passport.config';
import type { Role, SessionUser } from '../types/auth';

export const authenticate: RequestHandler = (req, res, next) => {
  delete req.auth;
  delete req.authUser;
  return authPassport.authenticate('jwt', { session: false }, (error: unknown, user: SessionUser | false) => {
    if (error) {
      res.status(500).json({ message: 'Error interno del servidor.' });
      return;
    }
    if (!user) {
      res.status(401).json({ message: 'No autenticado.' });
      return;
    }
    req.auth = { id: user.id, rol: user.rol };
    req.authUser = user;
    next();
  })(req, res, next);
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
