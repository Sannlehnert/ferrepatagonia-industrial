import { Router } from 'express';
import {
  getAdminOrderById,
  getAdminOrders,
  updateAdminOrderStatus,
} from '../controllers/adminOrder.controller';

export const adminOrderRouter = Router();

adminOrderRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

adminOrderRouter.get('/', getAdminOrders);
adminOrderRouter.get('/:id', getAdminOrderById);
adminOrderRouter.patch('/:id/estado', updateAdminOrderStatus);
adminOrderRouter.put('/:id/estado', updateAdminOrderStatus);