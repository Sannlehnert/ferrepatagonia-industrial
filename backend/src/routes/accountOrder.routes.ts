import { Router } from 'express';
import {
  handleAccountOrder,
} from '../controllers/accountOrder.controller';

export const accountOrderRouter = Router();

accountOrderRouter.post('/', handleAccountOrder('confirm'));

accountOrderRouter.get(
  '/:clave',
  handleAccountOrder('recover'),
);

export const clientOrderRouter = Router();

clientOrderRouter.use((req, _res, next) => {
  if (req.path === '/cuenta-corriente' || req.path.startsWith('/cuenta-corriente/')) {
    next('router');
    return;
  }
  next();
});

clientOrderRouter.get('/', handleAccountOrder('list'));

clientOrderRouter.get(
  '/:id',
  handleAccountOrder('detail'),
);