import { findAllAdmin, findById, findByCodigo, categoryExists, create, update, CreateProductDTO, UpdateProductDTO, deactivate } from '../repositories/adminProduct.repository';

export class ValidationError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

// Validación magra e independiente
const validateProductFields = async (data: any, isUpdate = false, productId?: number) => {
    if (!isUpdate || data.nombre !== undefined) {
        if (!data.nombre || String(data.nombre).trim() === '') {
            throw new ValidationError('El nombre del producto es obligatorio.');
        }
    }
    if (!isUpdate || data.codigo !== undefined) {
        if (!data.codigo || String(data.codigo).trim() === '') {
            throw new ValidationError('El código SKU es obligatorio.');
        }
        const existingSku = await findByCodigo(String(data.codigo).trim(), productId);
        if (existingSku) {
            throw new ValidationError('El código SKU ya está registrado.', 409);
        }
    }
    if (!isUpdate || data.id_categoria !== undefined) {
        const exists = await categoryExists(Number(data.id_categoria));
        if (!exists) throw new ValidationError('La categoría no existe.', 404);
    }
    if (data.precio !== undefined && Number(data.precio) < 0) {
        throw new ValidationError('El precio no puede ser negativo.');
    }
    if (data.stock !== undefined && Number(data.stock) < 0) {
        throw new ValidationError('El stock no puede ser negativo.');
    }
};

export const listAdminProducts = async () => {
    return await findAllAdmin();
};

export const getAdminProductById = async (id: number) => {
    const product = await findById(id);
    if (!product) throw new ValidationError('Producto no encontrado.', 404);
    return product;
};

export const createAdminProduct = async (payload: CreateProductDTO) => {
    await validateProductFields(payload, false);
    const insertId = await create(payload);
    return await findById(insertId);
};

export const updateAdminProduct = async (id: number, payload: UpdateProductDTO) => {
    const existing = await findById(id);
    if (!existing) throw new ValidationError('Producto no encontrado.', 404);
    
    await validateProductFields(payload, true, id);
    await update(id, payload);
    return await findById(id);
};

export const deactivateAdminProduct = async (id: number) => {
    const existing = await findById(id);
    if (!existing) throw new ValidationError('Producto no encontrado.', 404);
    
    // Comportamiento idempotente: si ya está inactivo, retornamos sin hacer nada
    if (existing.activo === 0 || existing.activo === false) {
        return existing;
    }
    
    await deactivate(id);
    return await findById(id);
};