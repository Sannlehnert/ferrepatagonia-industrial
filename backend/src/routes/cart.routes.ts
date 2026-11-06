import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { getMyCart } from '../controllers/cart.controller';

export const cartRouter = Router();

// Endpoint de consulta del carrito del cliente autenticado
cartRouter.get('/', authenticate, getMyCart);