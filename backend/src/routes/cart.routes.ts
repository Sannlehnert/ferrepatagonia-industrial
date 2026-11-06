import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';
import { handleCart } from '../controllers/cart.controller';

export const cartRouter = Router();

cartRouter.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('Cookie');
    next();
}, authenticate, authorizeRoles('CLIENTE'));

cartRouter.get('/', handleCart());
cartRouter.post('/items', handleCart('add'));
cartRouter.patch('/items/:productoId', handleCart('update'));
cartRouter.delete('/items/:productoId', handleCart('remove'));
