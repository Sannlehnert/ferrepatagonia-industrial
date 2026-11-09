import { Router } from 'express';
import {
    consultarMovimientosCliente,
    consultarResumenCliente,
    consultarVencimientosCliente
} from '../controllers/cuentaCorriente.controller';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';

export const cuentaCorrienteRouter = Router();

cuentaCorrienteRouter.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Cookie');
    next();
});

cuentaCorrienteRouter.use(authenticate, authorizeRoles('CLIENTE'));

cuentaCorrienteRouter.get('/', consultarResumenCliente);
cuentaCorrienteRouter.get('/movimientos', consultarMovimientosCliente);
cuentaCorrienteRouter.get('/vencimientos', consultarVencimientosCliente);