import { isIP } from 'node:net';

export type NodeMode = 'development' | 'test' | 'production';
export interface HttpSecurityConfig {
  mode: NodeMode;
  publicOrigin: string;
  trustedProxies: false | string[];
  requireHttps: boolean;
  rate: { loginLimit: number; loginWindowMs: number; registerLimit: number; registerWindowMs: number };
}
const invalid = (name: string): never => { throw new Error(`Configuración inválida: ${name}.`); };
const required = (raw: NodeJS.ProcessEnv, name: string): string => raw[name]?.trim() || invalid(name);
function integer(raw: NodeJS.ProcessEnv, name: string, fallback: number | undefined, max: number): number {
  const text = raw[name] ?? (fallback === undefined ? undefined : String(fallback));
  if (!text || !/^[1-9][0-9]*$/.test(text)) return invalid(name);
  const value = Number(text);
  return Number.isSafeInteger(value) && value <= max ? value : invalid(name);
}
function origin(value: string, production: boolean): string {
  let url: URL;
  try { url = new URL(value); } catch { return invalid('APP_PUBLIC_ORIGIN'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash || url.origin !== value ||
    (production && url.protocol !== 'https:')) return invalid('APP_PUBLIC_ORIGIN');
  return url.origin;
}
export function loadHttpSecurity(raw: NodeJS.ProcessEnv): HttpSecurityConfig {
  const mode = raw.NODE_ENV;
  if (mode !== 'development' && mode !== 'test' && mode !== 'production') return invalid('NODE_ENV');
  const production = mode === 'production';
  const publicOrigin = origin(raw.APP_PUBLIC_ORIGIN ?? (production ? required(raw, 'APP_PUBLIC_ORIGIN') : 'http://localhost:5173'), production);
  const proxyText = raw.TRUSTED_PROXY_CIDRS ?? (production ? required(raw, 'TRUSTED_PROXY_CIDRS') : 'none');
  let trustedProxies: false | string[] = false;
  if (proxyText !== 'none') {
    const cidrs = proxyText.split(',').map(value => value.trim());
    for (const cidr of cidrs) {
      const parts = cidr.split('/'), family = isIP(parts[0]);
      const mask = parts[1] === undefined ? (family === 4 ? 32 : 128) : Number(parts[1]);
      if (!family || parts.length > 2 || (parts[1] !== undefined && !/^[1-9][0-9]*$/.test(parts[1])) ||
        !Number.isInteger(mask) || mask < 1 || mask > (family === 4 ? 32 : 128)) return invalid('TRUSTED_PROXY_CIDRS');
    }
    trustedProxies = cidrs;
  }
  // The current server is HTTP behind a TLS-terminating, explicitly trusted proxy.
  // No provider, public address, hop count or external CORS origin is assumed.
  if (production && (!trustedProxies || required(raw, 'HTTPS_TERMINATION') !== 'trusted-proxy')) return invalid('HTTPS_TERMINATION/TRUSTED_PROXY_CIDRS');
  if (raw.HTTPS_TERMINATION !== undefined && raw.HTTPS_TERMINATION !== 'trusted-proxy') return invalid('HTTPS_TERMINATION');
  const store = raw.AUTH_RATE_STORE ?? (production ? required(raw, 'AUTH_RATE_STORE') : 'memory');
  if (store !== 'memory') return invalid('AUTH_RATE_STORE (solo memory disponible)');
  const instances = integer(raw, 'API_PROCESS_COUNT', production ? undefined : 1, 1024);
  if (instances !== 1) return invalid('API_PROCESS_COUNT (memory requiere un único proceso)');
  return {
    mode: mode as NodeMode, publicOrigin, trustedProxies, requireHttps: production,
    rate: {
      loginLimit: integer(raw, 'AUTH_LOGIN_LIMIT', production ? undefined : 20, 1000000),
      loginWindowMs: integer(raw, 'AUTH_LOGIN_WINDOW_MS', production ? undefined : 900000, 2147483647),
      registerLimit: integer(raw, 'AUTH_REGISTER_LIMIT', production ? undefined : 10, 1000000),
      registerWindowMs: integer(raw, 'AUTH_REGISTER_WINDOW_MS', production ? undefined : 3600000, 2147483647),
    },
  };
}
export function validateJwtSecret(value: string, mode: NodeMode): string {
  if (mode === 'production' && (Buffer.byteLength(value, 'utf8') < 32 || value.trim() !== value ||
    /^(.)\1+$/u.test(value))) return invalid('JWT_SECRET');
  // Length cannot certify entropy: production keys must be randomly generated and
  // supplied by deployment. Never trim, generate a fallback, or print the value.
  return value;
}
