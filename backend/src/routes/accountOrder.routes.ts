import { Router } from 'express';
import {
  handleAccountOrder,
} from '../controllers/accountOrder.controller';

export const accountOrderRouter = Router();

accountOrderRouter.post('/', handleAccountOrder('confirm'));

accountOrderRouter.get(
  '/eligibilidad',
  handleAccountOrder('eligibility'),
);

accountOrderRouter.get(
  '/:clave',
  handleAccountOrder('recover'),
);