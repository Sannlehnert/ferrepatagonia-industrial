import { Router } from 'express';
import { handleTransferOrder } from '../controllers/transferOrder.controller';

export const transferOrderRouter = Router();

transferOrderRouter.post('/', handleTransferOrder('confirm'));

transferOrderRouter.get(
  '/eligibilidad',
  handleTransferOrder('eligibility'),
);

transferOrderRouter.get(
  '/:clave',
  handleTransferOrder('recover'),
);
