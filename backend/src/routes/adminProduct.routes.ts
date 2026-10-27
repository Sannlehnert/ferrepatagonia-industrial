import { Router } from 'express';
import { getProducts, getProductById, createProduct, updateProduct, deactivateProduct, updateProductStock } from '../controllers/adminProduct.controller';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';
import { validateDto } from '../middlewares/validate-dto.middleware';
import { productIdPolicy, createProductPolicy, updateProductPolicy, stockPolicy } from '../dtos/policies';

export const adminProductRouter = Router();

adminProductRouter.use(authenticate, authorizeRoles('ADMIN'));

adminProductRouter.get('/', getProducts);
adminProductRouter.get('/:id', validateDto('params', productIdPolicy), getProductById);
adminProductRouter.post('/', validateDto('body', createProductPolicy), createProduct);
adminProductRouter.put('/:id', validateDto('params', productIdPolicy), validateDto('body', updateProductPolicy), updateProduct);
adminProductRouter.patch('/:id/desactivar', validateDto('params', productIdPolicy), deactivateProduct);
adminProductRouter.patch('/:id/stock', validateDto('params', productIdPolicy), validateDto('body', stockPolicy), updateProductStock);
