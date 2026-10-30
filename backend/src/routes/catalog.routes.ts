import { Router } from 'express';
import { getCatalog } from '../controllers/catalog.controller';
import { validateDto } from '../middlewares/validate-dto.middleware';
import { catalogPolicy } from '../dtos/policies';

export const catalogRouter = Router();
// Público: no aplica autenticación ni condiciones comerciales del cliente.
catalogRouter.get('/catalogo', validateDto('query', catalogPolicy), getCatalog);
