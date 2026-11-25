import type { RequestHandler } from 'express';

export const adminAccountPrivacy: RequestHandler = (req, res, next) => {
  if (/^\/api\/admin\/(?:cuentas-corrientes(?:\/|$)|solicitudes-credito(?:\/|$)|credito\/(?:eventos|empresas)(?:\/|$)|clientes\/[^/]+\/cuenta-corriente(?:\/|$)|pagos(?:\/|$))/i.test(req.path)) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('Cookie');
  }
  next();
};
