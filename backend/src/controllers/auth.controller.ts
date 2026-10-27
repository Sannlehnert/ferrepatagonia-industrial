import { Request, Response } from 'express';
import { loginUsuario } from '../services/auth.services';
import { authCookieName, issueAuthCookieOptions, clearAuthCookieOptions } from '../config/auth-cookie.config';

export const me = async (req: Request, res: Response) => {
    try {
        const user = req.authUser;
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
        const { email, password } = res.locals.dto.body;

        // Llamamos al servicio
        const result = await loginUsuario(email, password);

        // Si el servicio devolvió un error
        if (result.error) {
            return res.status(result.status || 401).json({ message: result.error });
        }

        // Inyectamos la cookie HttpOnly
        res.cookie(authCookieName, result.token, issueAuthCookieOptions);

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
        res.clearCookie(authCookieName, clearAuthCookieOptions);

        // Devolvemos la estructura de respuesta estandarizada
        return res.status(200).json({ 
            message: "Sesión cerrada correctamente" 
        });

    } catch (error) {
        console.error("Error en logout:");
        return res.status(500).json({ message: "Error interno del servidor" });
    }
};
