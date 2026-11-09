import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import type { TLSSocket } from 'node:tls';
import type { HttpSecurityConfig } from '../config/http-security.config';
import { isAllowedOrigin } from '../middlewares/http-security.middleware';

export type TrustProxy = (address: string, index: number) => boolean;

export function allowsSocketTransport(
  req: IncomingMessage, config: HttpSecurityConfig, trustProxy: TrustProxy,
): boolean {
  const peer = req.socket.remoteAddress;
  if (!peer || !isIP(peer)) return false;
  const forwarded = trustProxy(peer, 0) && req.headers['x-forwarded-proto'];
  const protocol = (req.socket as TLSSocket).encrypted
    ? 'https'
    : (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : 'http');
  if (config.requireHttps && protocol !== 'https') return false;

  const { origin, referer, referrer, host } = req.headers;
  const metadata = req.headers['sec-fetch-site'];
  if (Array.isArray(referrer) || Array.isArray(metadata)) return false;
  return isAllowedOrigin(config, origin, referrer || referer, metadata, host, protocol, true);
}
