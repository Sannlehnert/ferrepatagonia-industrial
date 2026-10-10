import { Router } from 'express';
import { getClientes } from '../controllers/clientes.controller';

export const adminRouter = Router();

// #177: acceso sin autenticación temporal; #178 incorporará la restricción ADMIN.
adminRouter.get('/clientes', getClientes);
