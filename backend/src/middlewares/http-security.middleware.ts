import type { RequestHandler } from 'express';
import type { HttpSecurityConfig } from '../config/http-security.config';
import { isIP } from 'node:net';

function parseOrigin(value: string, referer: boolean): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (!referer && value !== url.origin)) return null;
    return url.origin;
  } catch { return null; }
}
export function isAllowedOrigin(
  config: HttpSecurityConfig,
  source: string | undefined,
  referer: string | undefined,
  metadata: string | undefined,
  host: string | undefined,
  protocol: string,
  requireEvidence: boolean,
): boolean {
  const origin = new URL(config.publicOrigin);
  if (metadata !== undefined && metadata !== 'same-origin') return false;
  if (referer !== undefined && parseOrigin(referer, true) !== origin.origin) return false;
  if (source !== undefined) return parseOrigin(source, false) === origin.origin;
  if (referer !== undefined || !requireEvidence) return true;
  return metadata === 'same-origin' && host === origin.host &&
    protocol === origin.protocol.slice(0, -1);
}

export function httpSecurity(config: HttpSecurityConfig): RequestHandler {
  return (req, res, next) => {
    if (!req.ip || !isIP(req.ip)) {
      res.status(400).json({ message: 'Información de red inválida.' }); return;
    }
    if (config.requireHttps && !req.secure) {
      res.status(426).json({ message: 'Se requiere HTTPS.' }); return;
    }
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    // Same-origin deployment: no Access-Control-Allow-* reflection or external CORS.
    // Reject foreign preflights too, without turning OPTIONS into a CSRF bypass.
    if (mutating || req.method === 'OPTIONS') {
      // Missing Origin can use a valid Referer, or same-origin Fetch Metadata plus
      // the configured canonical Host. Never derive the allowed origin from XFH.
      if (!isAllowedOrigin(config, req.get('Origin'), req.get('Referer'),
        req.get('Sec-Fetch-Site'), req.get('Host'), req.protocol, mutating)) {
        res.status(403).json({ message: 'Origen de solicitud no permitido.' }); return;
      }
    }
    next();
  };
}
