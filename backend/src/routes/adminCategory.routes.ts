import { Router, type RequestHandler } from 'express';
import { createCategory, deactivateCategory, updateCategory, getAdminCategories } from '../controllers/adminCategory.controller';
import { categoryIdPolicy, createCategoryPolicy, updateCategoryPolicy } from '../dtos/policies';
import { validateDto } from '../middlewares/validate-dto.middleware';

export const adminCategoryRouter = Router();

const withoutBody: RequestHandler = (req, res, next) => {
  if (Number(req.get('content-length')) > 0 || req.get('transfer-encoding')) {
    res.status(400).json({ message: 'La desactivación no admite un cuerpo de solicitud.' });
    return;
  }
  next();
};

adminCategoryRouter.get('/', getAdminCategories);

adminCategoryRouter.post('/', validateDto('body', createCategoryPolicy), createCategory);
adminCategoryRouter.put('/:id', validateDto('params', categoryIdPolicy), validateDto('body', updateCategoryPolicy), updateCategory);
adminCategoryRouter.patch('/:id/desactivar', validateDto('params', categoryIdPolicy), withoutBody, deactivateCategory);
