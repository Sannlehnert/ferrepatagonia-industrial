import { Router } from 'express';
import { getProducts, getProductById, createProduct, updateProduct, deactivateProduct, updateProductStock } from '../controllers/adminProduct.controller';
import { validateDto } from '../middlewares/validate-dto.middleware';
import { productIdPolicy, createProductPolicy, updateProductPolicy, updateProductWithImagePolicy, stockPolicy } from '../dtos/policies';
import { uploadProductImage } from '../middlewares/productImageUpload.middleware';

export const adminProductRouter = Router();

// Mounted only beneath adminRouter's authentication and ADMIN guard.

adminProductRouter.get('/', getProducts);
adminProductRouter.get('/:id', validateDto('params', productIdPolicy), getProductById);
adminProductRouter.post('/', validateDto('body', createProductPolicy), createProduct);
adminProductRouter.post('/con-imagen', uploadProductImage, validateDto('body', createProductPolicy), createProduct);
adminProductRouter.put('/:id/con-imagen', validateDto('params', productIdPolicy), uploadProductImage,
    validateDto('body', updateProductWithImagePolicy), updateProduct);
adminProductRouter.put('/:id', validateDto('params', productIdPolicy), validateDto('body', updateProductPolicy), updateProduct);
adminProductRouter.patch('/:id/desactivar', validateDto('params', productIdPolicy), deactivateProduct);
adminProductRouter.patch('/:id/stock', validateDto('params', productIdPolicy), validateDto('body', stockPolicy), updateProductStock);
