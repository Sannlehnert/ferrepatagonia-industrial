import type { Request, RequestHandler, Response } from 'express';
import { authPassport } from '../config/passport.config';
import type { Role, SessionUser } from '../types/auth';

export async function authenticateRequest(req: Request, res: Response): Promise<boolean> {
  delete req.auth;
  delete req.authUser;
  const { error, user } = await new Promise<{ error: unknown; user: SessionUser | false }>((resolve, reject) => {
    authPassport.authenticate('jwt', { session: false }, (error: unknown, user: SessionUser | false) => {
      resolve({ error, user });
    })(req, res, reject);
  });
  if (res.destroyed) return false;
  if (error) {
    res.status(500).json({ message: 'Error interno del servidor.' });
    return false;
  }
  if (!user) {
    res.status(401).json({ message: 'No autenticado.' });
    return false;
  }
  req.auth = { id: user.id, rol: user.rol };
  req.authUser = user;
  return true;
}

export const authenticate: RequestHandler = async (req, res, next) => {
  if (await authenticateRequest(req, res)) next();
};

export function authorizeRequest(req: Request, res: Response, roles: readonly Role[]): boolean {
  if (!req.auth) {
    res.status(401).json({ message: 'No autenticado.' });
    return false;
  }
  if (!roles.includes(req.auth.rol)) {
    res.status(403).json({ message: 'El rol autenticado no tiene permiso.' });
    return false;
  }
  return true;
}

// Uso esperado: authenticate, authorizeRoles('ADMIN'). No consulta JWT ni BD.
export function authorizeRoles(...roles: Role[]): RequestHandler {
  return (req, res, next) => {
    if (authorizeRequest(req, res, roles)) next();
  };
}
