import { Router, type RequestHandler } from 'express';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';
import { PricingError } from '../services/pricing/money';
import type { PricingService } from '../services/pricing/pricing.service';

// Composition is deliberately not mounted in app.ts until #240 is approved,
// a real snapshot adapter exists, and MariaDB integration has been verified.
export function createPricingRouter(service: PricingService): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('Cookie');
    next();
  });
  const handler = (channel: 'PUBLICO' | 'CLIENTE'): RequestHandler => async (req, res) => {
    try {
      if (Object.keys(req.query).length) throw new PricingError('SOLICITUD_INVALIDA', 400);
      res.json({ data: await service.resolve(req.body, channel, req.auth) });
    } catch (error) {
      if (error instanceof PricingError) res.status(error.status).json({ code: error.code, message: 'No se pudo resolver el precio.' });
      else res.status(500).json({ message: 'Error interno del servidor.' });
    }
  };
  router.post('/precios', handler('PUBLICO'));
  router.post('/precios/mios', authenticate, authorizeRoles('CLIENTE'), handler('CLIENTE'));
  return router;
}
