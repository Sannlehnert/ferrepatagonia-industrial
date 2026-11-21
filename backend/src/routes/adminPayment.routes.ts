import { Router } from 'express';
import {
  getAdminPayment,
  getAdminPayments,
  patchReviewPayment,
  postAccreditPayment,
} from '../controllers/payment.controller';
import {
  accreditPaymentPolicy,
  paymentIdPolicy,
  reviewPaymentPolicy,
} from '../dtos/payments/payment.dto';
import { validateDto } from '../middlewares/validate-dto.middleware';

// Router único para /api/admin/pagos. #158 publica create/rechazar/anular en
// este mismo punto de montaje; #333 agrega revisión documental y acreditación
// de declaraciones. Cualquier integración debe fusionar ambos contratos en este
// archivo, nunca montar dos routers sobre la misma ruta.
export const adminPaymentRouter = Router();

adminPaymentRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
  res.vary('Cookie');
  next();
});

adminPaymentRouter.get('/', getAdminPayments);
adminPaymentRouter.get(
  '/:id',
  validateDto('params', paymentIdPolicy),
  getAdminPayment,
);
adminPaymentRouter.patch(
  '/:id/revision',
  validateDto('params', paymentIdPolicy),
  validateDto('body', reviewPaymentPolicy),
  patchReviewPayment,
);
adminPaymentRouter.post(
  '/:id/acreditar',
  validateDto('params', paymentIdPolicy),
  validateDto('body', accreditPaymentPolicy),
  postAccreditPayment,
);
