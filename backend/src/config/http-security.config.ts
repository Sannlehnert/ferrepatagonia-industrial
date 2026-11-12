import Joi from 'joi';
import { isIP } from 'node:net';

export type NodeMode = 'development' | 'test' | 'production';
export interface HttpSecurityConfig {
  mode: NodeMode;
  publicOrigin: string;
  trustedProxies: false | string[];
  requireHttps: boolean;
  rate: { loginLimit: number; loginWindowMs: number; registerLimit: number; registerWindowMs: number };
}

interface ParsedHttpSecurityEnv {
  NODE_ENV: NodeMode;
  APP_PUBLIC_ORIGIN: string;
  TRUSTED_PROXY_CIDRS: false | string[];
  AUTH_LOGIN_LIMIT: number;
  AUTH_LOGIN_WINDOW_MS: number;
  AUTH_REGISTER_LIMIT: number;
  AUTH_REGISTER_WINDOW_MS: number;
}

const POSITIVE_INT_PATTERN = /^[1-9][0-9]*$/;
const invalid = (name: string): never => { throw new Error(`Configuración inválida: ${name}.`); };

function parsePublicOrigin(value: string, production: boolean): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.origin !== value ||
    (production && url.protocol !== 'https:')
  ) {
    return null;
  }
  return url.origin;
}

function parseTrustedProxies(value: string): false | string[] | null {
  if (value === 'none') return false;
  const cidrs = value.split(',').map(entry => entry.trim());
  for (const cidr of cidrs) {
    const parts = cidr.split('/');
    const family = isIP(parts[0]);
    const mask = parts[1] === undefined ? (family === 4 ? 32 : 128) : Number(parts[1]);
    if (
      !family ||
      parts.length > 2 ||
      (parts[1] !== undefined && !POSITIVE_INT_PATTERN.test(parts[1])) ||
      !Number.isInteger(mask) ||
      mask < 1 ||
      mask > (family === 4 ? 32 : 128)
    ) {
      return null;
    }
  }
  return cidrs;
}

const positiveIntField = (fallback: number, max: number): Joi.StringSchema =>
  Joi.string()
    .pattern(POSITIVE_INT_PATTERN)
    .custom((value: string, helpers) => {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed <= max ? parsed : helpers.error('any.invalid');
    })
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.string().default(fallback),
    });

const httpSecuritySchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').required(),
  APP_PUBLIC_ORIGIN: Joi.string()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.string().default('http://localhost:5173'),
    })
    .custom((value: string, helpers) => {
      const root = helpers.state.ancestors[0] as { NODE_ENV?: string } | undefined;
      return parsePublicOrigin(value, root?.NODE_ENV === 'production') ?? helpers.error('any.invalid');
    }),
  TRUSTED_PROXY_CIDRS: Joi.string()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.string().default(false),
    })
    .custom((value: string, helpers) => {
      const root = helpers.state.ancestors[0] as { NODE_ENV?: string } | undefined;
      const parsed = parseTrustedProxies(value);
      if (parsed === null) return helpers.error('any.invalid');
      // The current server is HTTP behind a TLS-terminating, explicitly trusted proxy.
      // No provider, public address, hop count or external CORS origin is assumed.
      if (root?.NODE_ENV === 'production' && parsed === false) {
        return helpers.error('https.proxy_required');
      }
      return parsed;
    }),
  HTTPS_TERMINATION: Joi.string()
    .valid('trusted-proxy')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  AUTH_RATE_STORE: Joi.string()
    .valid('memory')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.string().default('memory'),
    }),
  API_PROCESS_COUNT: positiveIntField(1, 1024).custom((value: number, helpers) =>
    value === 1 ? value : helpers.error('api.process_single'),
  ),
  AUTH_LOGIN_LIMIT: positiveIntField(20, 1_000_000),
  AUTH_LOGIN_WINDOW_MS: positiveIntField(900_000, 2_147_483_647),
  AUTH_REGISTER_LIMIT: positiveIntField(10, 1_000_000),
  AUTH_REGISTER_WINDOW_MS: positiveIntField(3_600_000, 2_147_483_647),
}).unknown(true);

const jwtSecretSchema = Joi.object({
  mode: Joi.string().valid('development', 'test', 'production').required(),
  value: Joi.when('mode', {
    is: 'production',
    then: Joi.string()
      .required()
      .custom((secret: string, helpers) => {
        if (
          Buffer.byteLength(secret, 'utf8') < 32 ||
          secret.trim() !== secret ||
          /^(.)\1+$/u.test(secret)
        ) {
          return helpers.error('any.invalid');
        }
        return secret;
      }),
    otherwise: Joi.string().allow('').required(),
  }),
});

/**
 * Validates HTTP security, proxy trust, origin and rate-limit settings with Joi.
 */
export function loadHttpSecurity(raw: NodeJS.ProcessEnv): HttpSecurityConfig {
  const { error, value } = httpSecuritySchema.validate(raw, { convert: false, abortEarly: true });
  if (error) {
    const detail = error.details[0];
    const key = String(detail?.path[0] ?? 'HTTP_SECURITY');
    if (detail?.type === 'https.proxy_required') {
      return invalid('HTTPS_TERMINATION/TRUSTED_PROXY_CIDRS');
    }
    if (key === 'AUTH_RATE_STORE' && detail?.type === 'any.only') {
      return invalid('AUTH_RATE_STORE (solo memory disponible)');
    }
    if (detail?.type === 'api.process_single') {
      return invalid('API_PROCESS_COUNT (memory requiere un único proceso)');
    }
    return invalid(key);
  }
  const parsed = value as ParsedHttpSecurityEnv;
  return {
    mode: parsed.NODE_ENV,
    publicOrigin: parsed.APP_PUBLIC_ORIGIN,
    trustedProxies: parsed.TRUSTED_PROXY_CIDRS,
    requireHttps: parsed.NODE_ENV === 'production',
    rate: {
      loginLimit: parsed.AUTH_LOGIN_LIMIT,
      loginWindowMs: parsed.AUTH_LOGIN_WINDOW_MS,
      registerLimit: parsed.AUTH_REGISTER_LIMIT,
      registerWindowMs: parsed.AUTH_REGISTER_WINDOW_MS,
    },
  };
}

/**
 * Validates the JWT signing secret for the active runtime environment.
 */
export function validateJwtSecret(value: string, mode: NodeMode): string {
  const { error, value: validated } = jwtSecretSchema.validate(
    { mode, value },
    { convert: false, abortEarly: true },
  );
  if (error) return invalid('JWT_SECRET');
  // Length cannot certify entropy: production keys must be randomly generated and
  // supplied by deployment. Never trim, generate a fallback, or print the value.
  return (validated as { value: string }).value;
}
