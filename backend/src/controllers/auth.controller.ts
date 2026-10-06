import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../config/database'; // Ajustá la ruta a donde esté tu database.ts

export const login = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "Email y contraseña son obligatorios" });
        }

        // Buscamos al usuario en MariaDB
        const sql = `
            SELECT u.id_usuario, u.email, u.password_hash, u.rol, u.activo, 
                c.nombre_razon_social, c.tipo_cliente
            FROM USUARIO u
            LEFT JOIN CLIENTE c ON u.id_cliente = c.id_cliente
            WHERE u.email = ?
        `;
        const rows = await pool.query(sql, [email]);
        
        // MariaDB devuelve un array de resultados
        const user = rows[0]; 

        // Validamos si existe y está activo
        if (!user || !user.activo) {
            return res.status(401).json({ message: "Credenciales inválidas" }); 
        }

        // Comparamos la contraseña contra el hash de la base de datos
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
            return res.status(401).json({ message: "Credenciales inválidas" });
        }

        // Firmamos el JWT
        const token = jwt.sign(
            { id: user.id_usuario, rol: user.rol },
            process.env.JWT_SECRET || 'secreto_desarrollo_ferrepatagonia',
            { expiresIn: '2h' }
        );

        // Inyectamos la cookie HttpOnly
        res.cookie('jwt_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 2 * 60 * 60 * 1000 // 2 horas
        });

        // Respuesta pública para Pinia (frontend)
        return res.status(200).json({
            message: "Login exitoso",
            user: {
                id: user.id_usuario,
                email: user.email,
                rol: user.rol,                      // Devolvera "Cliente" o "ADMIN"
                tipo_cliente: user.tipo_cliente,   // Devolvera "PARTICULAR", "EMPRESA" o null
                nombre: user.nombre_razon_social || "Administrador"
            }
        });

    } catch (error) {
        console.error("Error en login:", error);
        return res.status(500).json({ message: "Error interno del servidor" });
    }
};