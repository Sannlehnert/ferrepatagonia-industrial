import { Router } from 'express';
import { getProducts, getProductById, createProduct, updateProduct, deactivateProduct, updateProductStock } from '../controllers/adminProduct.controller';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';

export const adminProductRouter = Router();

adminProductRouter.use(authenticate, authorizeRoles('ADMIN'));

adminProductRouter.get('/', getProducts);
adminProductRouter.get('/:id', getProductById);
adminProductRouter.post('/', createProduct);
adminProductRouter.put('/:id', updateProduct);
adminProductRouter.patch('/:id/desactivar', deactivateProduct);
adminProductRouter.patch('/:id/stock', updateProductStock);