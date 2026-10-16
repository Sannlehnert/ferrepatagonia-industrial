import { Router } from 'express';
import { getCatalog } from '../controllers/catalog.controller';

export const catalogRouter = Router();
// Público: no aplica autenticación ni condiciones comerciales del cliente.
catalogRouter.get('/catalogo', getCatalog);
