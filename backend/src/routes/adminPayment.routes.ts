import { Router } from 'express';
import {
  getAdminPaymentById,
  getAdminPayments,
  postAccreditAdminPayment,
  postAdminPayment,
  postAnnulAdminPayment,
  postRejectAdminPayment,
} from '../controllers/adminPayment.controller';
import {
  accreditAdminPaymentPolicy,
  adminPaymentIdPolicy,
  closeAdminPaymentPolicy,
  createAdminPaymentPolicy,
} from '../dtos/payments/admin-payment.dto';
import { validateDto } from '../middlewares/validate-dto.middleware';

export const adminPaymentRouter = Router();

adminPaymentRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
  res.vary('Cookie');
  next();
});

adminPaymentRouter.get('/', getAdminPayments);
adminPaymentRouter.get(
  '/:pagoId',
  validateDto('params', adminPaymentIdPolicy),
  getAdminPaymentById,
);
adminPaymentRouter.post(
  '/',
  validateDto('body', createAdminPaymentPolicy),
  postAdminPayment,
);
adminPaymentRouter.post(
  '/:pagoId/acreditar',
  validateDto('params', adminPaymentIdPolicy),
  validateDto('body', accreditAdminPaymentPolicy),
  postAccreditAdminPayment,
);
adminPaymentRouter.post(
  '/:pagoId/rechazar',
  validateDto('params', adminPaymentIdPolicy),
  validateDto('body', closeAdminPaymentPolicy),
  postRejectAdminPayment,
);
adminPaymentRouter.post(
  '/:pagoId/anular',
  validateDto('params', adminPaymentIdPolicy),
  validateDto('body', closeAdminPaymentPolicy),
  postAnnulAdminPayment,
);
