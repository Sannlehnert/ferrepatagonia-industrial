import { Router } from 'express';
import { getCategories } from '../controllers/category.controller';

export const categoryRouter = Router();
// Público e independiente de productos, paginación y condiciones comerciales.
categoryRouter.get('/categorias', getCategories);
