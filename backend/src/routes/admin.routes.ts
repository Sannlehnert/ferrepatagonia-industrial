import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';
import { getClientes } from '../controllers/clientes.controller';
import { adminProductRouter } from './adminProduct.routes';
import { productImportRouter } from './productImport.routes';

export const adminRouter = Router();

adminRouter.use(authenticate, authorizeRoles('ADMIN'));

adminRouter.get('/clientes', getClientes);
adminRouter.use('/productos/importar', productImportRouter);
adminRouter.use('/productos', adminProductRouter);
