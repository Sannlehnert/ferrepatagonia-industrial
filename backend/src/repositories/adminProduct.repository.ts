import { pool } from '../config/database.config';

export interface ProductRecord {
    id_producto: number;
    id_categoria: number;
    codigo: string;
    nombre: string;
    descripcion: string | null;
    precio: number;
    stock: number;
    imagen: string | null;
    activo: number | boolean;
    fecha_actualizacion: Date;
}

export interface CreateProductDTO {
    id_categoria: number;
    codigo: string;
    nombre: string;
    descripcion?: string | null;
    precio: number;
    stock: number;
    imagen?: string | null;
    activo?: boolean;
}

export interface UpdateProductDTO {
    id_categoria?: number;
    codigo?: string;
    nombre?: string;
    descripcion?: string | null;
    precio?: number;
    stock?: number;
    imagen?: string | null;
    activo?: boolean;
}

export const findAllAdmin = async (): Promise<ProductRecord[]> => {
    const query = `
        SELECT p.id_producto, p.id_categoria, c.nombre AS categoria_nombre,
            p.codigo, p.nombre, p.descripcion, p.precio, p.stock,
            p.imagen, p.activo, p.fecha_actualizacion
        FROM PRODUCTO p
        INNER JOIN CATEGORIA c ON c.id_categoria = p.id_categoria
        ORDER BY p.id_producto DESC
        `;
    const rows = await pool.query(query);
    return rows;
};

export const findById = async (id: number): Promise<ProductRecord | null> => {
    const rows = await pool.query(
        'SELECT * FROM PRODUCTO WHERE id_producto = ?',
        [id]
    );
    return rows.length > 0 ? rows[0] : null;
};

export const findByCodigo = async (codigo: string, excludeId?: number): Promise<ProductRecord | null> => {
    let query = 'SELECT * FROM PRODUCTO WHERE codigo = ?';
    const params: any[] = [codigo];

    if (excludeId !== undefined) {
        query += ' AND id_producto <> ?';
        params.push(excludeId);
    }

    const rows = await pool.query(query, params);
    return rows.length > 0 ? rows[0] : null;
};

export const categoryExists = async (idCategoria: number): Promise<boolean> => {
    const rows = await pool.query(
        'SELECT 1 FROM CATEGORIA WHERE id_categoria = ?',
        [idCategoria]
    );
    return rows.length > 0;
};

export const create = async (data: CreateProductDTO): Promise<number> => {
    const result = await pool.query(
        `INSERT INTO PRODUCTO (id_categoria, codigo, nombre, descripcion, precio, stock, imagen, activo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            data.id_categoria,
            data.codigo.trim(),
            data.nombre.trim(),
            data.descripcion ?? null,
            data.precio,
            data.stock,
            data.imagen ?? null,
            data.activo !== undefined ? (data.activo ? 1 : 0) : 1
        ]
    );
    return Number(result.insertId);
};

export const update = async (id: number, data: UpdateProductDTO): Promise<boolean> => {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.id_categoria !== undefined) { fields.push('id_categoria = ?'); values.push(data.id_categoria); }
    if (data.codigo !== undefined) { fields.push('codigo = ?'); values.push(data.codigo.trim()); }
    if (data.nombre !== undefined) { fields.push('nombre = ?'); values.push(data.nombre.trim()); }
    if (data.descripcion !== undefined) { fields.push('descripcion = ?'); values.push(data.descripcion); }
    if (data.precio !== undefined) { fields.push('precio = ?'); values.push(data.precio); }
    if (data.stock !== undefined) { fields.push('stock = ?'); values.push(data.stock); }
    if (data.imagen !== undefined) { fields.push('imagen = ?'); values.push(data.imagen); }
    if (data.activo !== undefined) { fields.push('activo = ?'); values.push(data.activo ? 1 : 0); }

    if (fields.length === 0) return false;

    values.push(id);
        const result = await pool.query(
        `UPDATE PRODUCTO SET ${fields.join(', ')} WHERE id_producto = ?`,
        values
    );
    return result.affectedRows > 0;
};

export const deactivate = async (id: number): Promise<boolean> => {
    const result = await pool.query(
        'UPDATE PRODUCTO SET activo = 0 WHERE id_producto = ?',
        [id]
    );
    return result.affectedRows > 0;
};