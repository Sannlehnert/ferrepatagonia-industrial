import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';
import { getClientes } from '../controllers/clientes.controller';

export const adminRouter = Router();

adminRouter.get('/clientes', authenticate, authorizeRoles('ADMIN'), getClientes);
