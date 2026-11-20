import { Router, type RequestHandler } from 'express';
import { activateCategory, createCategory, deactivateCategory, updateCategory, getAdminCategories } from '../controllers/adminCategory.controller';
import { categoryIdPolicy, createCategoryPolicy, updateCategoryPolicy } from '../dtos/policies';
import { validateDto } from '../middlewares/validate-dto.middleware';

export const adminCategoryRouter = Router();

function rejectRequestBody(message: string): RequestHandler {
  return (req, res, next) => {
    const hasBodyContent = req.body !== undefined
      && (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body) || Object.keys(req.body).length > 0);
    if (Number(req.get('content-length')) > 0 || Boolean(req.get('transfer-encoding')) || hasBodyContent) {
      res.status(400).json({ message });
      return;
    }
    next();
  };
}

adminCategoryRouter.get('/', getAdminCategories);

adminCategoryRouter.post('/', validateDto('body', createCategoryPolicy), createCategory);
adminCategoryRouter.put('/:id', validateDto('params', categoryIdPolicy), validateDto('body', updateCategoryPolicy), updateCategory);
adminCategoryRouter.patch(
  '/:id/desactivar',
  validateDto('params', categoryIdPolicy),
  rejectRequestBody('La desactivación no admite un cuerpo de solicitud.'),
  deactivateCategory,
);
adminCategoryRouter.patch(
  '/:id/activar',
  validateDto('params', categoryIdPolicy),
  rejectRequestBody('La activación no admite un cuerpo de solicitud.'),
  activateCategory,
);
