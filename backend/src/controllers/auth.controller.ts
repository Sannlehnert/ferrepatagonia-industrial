import { Request, Response } from 'express';
import { loginUsuario, restoreUsuario } from '../services/auth.services';

export const me = async (req: Request, res: Response) => {
    try {
        const user = req.auth ? await restoreUsuario(req.auth) : null;
        if (!user) {
            return res.status(401).json({ message: 'No autenticado.' });
        }
        return res.status(200).json({ user });
    } catch {
        return res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "Email y contraseña son obligatorios" });
        }

        // Llamamos al servicio
        const result = await loginUsuario(email, password);

        // Si el servicio devolvió un error
        if (result.error) {
            return res.status(result.status || 401).json({ message: result.error });
        }

        // Inyectamos la cookie HttpOnly
        res.cookie('jwt_token', result.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 2 * 60 * 60 * 1000 // 2 horas
        });

        // Devolvemos la respuesta exitosa para Pinia
        return res.status(200).json({
            message: "Login exitoso",
            user: result.user
        });

    } catch (error) {
        console.error("Error en login:");
        return res.status(500).json({ message: "Error interno del servidor" });
    }
};

export const logout = (req: Request, res: Response) => {
    try {
        // Destruimos la cookie del JWT
        res.clearCookie('jwt_token', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });

        // Devolvemos la estructura de respuesta estandarizada
        return res.status(200).json({ 
            message: "Sesión cerrada correctamente" 
        });

    } catch (error) {
        console.error("Error en logout:");
        return res.status(500).json({ message: "Error interno del servidor" });
    }
};
