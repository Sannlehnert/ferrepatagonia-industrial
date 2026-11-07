import { Router } from 'express';
import { handleCart } from '../controllers/cart.controller';

export const cartRouter = Router();

cartRouter.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('Cookie');
    next();
});

cartRouter.get('/', handleCart());
cartRouter.post('/items', handleCart('add'));
cartRouter.patch('/items/:productoId', handleCart('update'));
cartRouter.delete('/items/:productoId', handleCart('remove'));
