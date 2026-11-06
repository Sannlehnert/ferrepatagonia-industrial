import { Request, Response } from 'express';
import { getAuthenticatedClientCart } from '../services/cart.service';

export const getMyCart = async (req: Request, res: Response) => {
    try {
        const auth = req.auth;

        if (!auth) {
            return res.status(401).json({ message: 'No autenticado.' });
        }

        if (auth.rol !== 'CLIENTE') {
            return res.status(403).json({ message: 'Acceso no permitido.' });
        }

        const cart = await getAuthenticatedClientCart(auth.id);

        if (!cart) {
            return res.status(403).json({ message: 'El usuario no tiene una cuenta de cliente asociada.' });
        }

        return res.status(200).json(cart);
    } catch (error) {
        console.error('Error al obtener carrito:');
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};