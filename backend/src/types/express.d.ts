import type { AuthContext, SessionUser } from './auth';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      authUser?: SessionUser;
    }
  }
}
