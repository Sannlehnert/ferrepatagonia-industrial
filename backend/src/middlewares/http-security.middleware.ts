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
      const source = req.get('Origin'), referer = req.get('Referer');
      const metadata = req.get('Sec-Fetch-Site');
      const badMetadata = metadata !== undefined && metadata !== 'same-origin';
      const conflictingReferer = referer !== undefined && parseOrigin(referer, true) !== config.publicOrigin;
      const knownOrigin = source !== undefined
        ? parseOrigin(source, false) === config.publicOrigin
        : referer !== undefined ? parseOrigin(referer, true) === config.publicOrigin : false;
      // Missing Origin can use a valid Referer, or same-origin Fetch Metadata plus
      // the configured canonical Host. Never derive the allowed origin from XFH.
      const metadataFallback = source === undefined && referer === undefined && metadata === 'same-origin' &&
        req.get('Host') === new URL(config.publicOrigin).host && req.protocol === new URL(config.publicOrigin).protocol.slice(0, -1);
      if ((mutating && (!knownOrigin && !metadataFallback)) || badMetadata || conflictingReferer ||
        (source !== undefined && !knownOrigin) || (referer !== undefined && !knownOrigin)) {
        res.status(403).json({ message: 'Origen de solicitud no permitido.' }); return;
      }
    }
    next();
  };
}
