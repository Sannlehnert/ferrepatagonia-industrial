import { pool } from '../config/database';

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