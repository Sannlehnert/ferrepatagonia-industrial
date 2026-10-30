import { rateLimit, MemoryStore } from 'express-rate-limit';
import type { HttpSecurityConfig } from '../config/http-security.config';

export function authRateLimiter(limit: number, windowMs: number, store = new MemoryStore()) {
  return rateLimit({
    limit, windowMs, store, ipv6Subnet: 56,
    standardHeaders: 'draft-7', legacyHeaders: false,
    skipSuccessfulRequests: false, skipFailedRequests: false,
    passOnStoreError: false,
    // Untrusted forwarded headers are deliberately ignored by Express' explicit
    // trust function. They must neither select a key nor create sensitive logs.
    validate: { xForwardedForHeader: false, forwardedHeader: false },
    message: { message: 'Demasiadas solicitudes. Intente nuevamente más tarde.' },
  });
}
export const createAuthLimiters = (config: HttpSecurityConfig) => ({
  login: authRateLimiter(config.rate.loginLimit, config.rate.loginWindowMs),
  register: authRateLimiter(config.rate.registerLimit, config.rate.registerWindowMs),
});
