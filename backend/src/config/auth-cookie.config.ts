import type { CookieOptions } from 'express';
import { env } from './env.config';

export const authCookieName = 'jwt_token';
// Snapshot the validated mode at startup. Mutating process.env later cannot
// silently switch off Secure. Clear and set always share path and scope.
export const clearAuthCookieOptions: Readonly<CookieOptions> = Object.freeze({
  httpOnly: true, secure: env.httpSecurity.mode === 'production',
  sameSite: 'strict', path: '/',
});
export const issueAuthCookieOptions: Readonly<CookieOptions> = Object.freeze({
  ...clearAuthCookieOptions, maxAge: 2 * 60 * 60 * 1000,
});
