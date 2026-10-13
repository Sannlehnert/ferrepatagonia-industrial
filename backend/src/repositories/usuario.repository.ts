import { pool } from '../config/database.config';
import type { Role } from '../types/auth';

interface UsuarioSessionRow {
    id_usuario: number;
    email: string;
    rol: Role;
    activo: number;
    nombre_razon_social: string | null;
    tipo_cliente: 'PARTICULAR' | 'EMPRESA' | null;
}

export const findUsuarioById = async (id: number): Promise<UsuarioSessionRow | null> => {
    const rows = await pool.query<UsuarioSessionRow[]>(`
        SELECT u.id_usuario, u.email, u.rol, u.activo,
            c.nombre_razon_social, c.tipo_cliente
        FROM USUARIO u
        LEFT JOIN CLIENTE c ON u.id_cliente = c.id_cliente
        WHERE u.id_usuario = ?
    `, [id]);
    return rows[0] ?? null;
};

export const findUsuarioByEmail = async (email: string) => {
    const sql = `
        SELECT u.id_usuario, u.email, u.password_hash, u.rol, u.activo, 
            c.nombre_razon_social, c.tipo_cliente
        FROM USUARIO u
        LEFT JOIN CLIENTE c ON u.id_cliente = c.id_cliente
        WHERE u.email = ?
    `;
    
    const rows: any = await pool.query(sql, [email]);
    
    return rows[0]; 
};
