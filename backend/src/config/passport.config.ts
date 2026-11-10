import { Passport } from 'passport';
import { Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { withCancellableRead } from './database.config';
import { env } from './env.config';
import { readAuthClaims, sessionJwtAlgorithm } from '../services/token.service';
import { authCookieName } from './auth-cookie.config';
import { restoreUsuario } from '../services/auth.services';
import type { AuthContext } from '../types/auth';

// Dedicated instance: no global Passport state, server sessions or serialization.
export const authPassport = new Passport();
export const authReadSignal = new WeakMap<Request, AbortSignal>();
export const sessionJwtStrategy = new Strategy({
  jwtFromRequest: req => {
    const token: unknown = req.cookies?.[authCookieName];
    return typeof token === 'string' && token.length > 0 ? token : null;
  },
  secretOrKey: env.jwtSecret,
  algorithms: [sessionJwtAlgorithm],
  ignoreExpiration: false,
  passReqToCallback: true,
}, (req: Request, payload: unknown, done) => {
  let auth: AuthContext;
  try {
    // Passport has verified signature/algorithm/expiration; require exp and id/rol too.
    auth = readAuthClaims(payload);
  } catch {
    done(null, false);
    return;
  }
  // A DB failure is an operational error, never a failed credential or allowed access.
  // Do not cache across requests: changes to active state/role must take effect.
  const signal = authReadSignal.get(req);
  const restore = signal
    ? withCancellableRead(signal, (_query, runner) => restoreUsuario(auth, runner))
    : restoreUsuario(auth);
  restore.then(user => done(null, user ?? false), error => done(error));
});

authPassport.use('jwt', sessionJwtStrategy);
