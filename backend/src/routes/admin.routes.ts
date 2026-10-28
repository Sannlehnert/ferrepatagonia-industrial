import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';
import { getClientes } from '../controllers/clientes.controller';
import { adminProductRouter } from './adminProduct.routes';

export const adminRouter = Router();

adminRouter.use(authenticate, authorizeRoles('ADMIN'));

adminRouter.get('/clientes', getClientes);
adminRouter.use('/productos', adminProductRouter);
