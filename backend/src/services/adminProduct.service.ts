import { findAllAdmin, findById, findByCodigo, categoryExists, create, update, updateStock,CreateProductDTO, UpdateProductDTO } from '../repositories/adminProduct.repository';

export class ValidationError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

// Candado en memoria para bloquear altas simultáneas (Race Conditions)
const activeSkuLocks = new Set<string>();

const validateProductFields = async (data: any, isUpdate = false, productId?: number) => {
    // Nombre
    if (!isUpdate || data.nombre !== undefined) {
        if (typeof data.nombre !== 'string' || data.nombre.trim() === '') {
            throw new ValidationError('El nombre del producto es obligatorio y debe ser texto.');
        }
    }
    // SKU
    if (!isUpdate || data.codigo !== undefined) {
        if (typeof data.codigo !== 'string' || data.codigo.trim() === '') {
            throw new ValidationError('El código SKU es obligatorio y debe ser texto.');
        }
        const sku = data.codigo.trim();
        const existingSku = await findByCodigo(sku, productId);
        if (existingSku) {
            throw new ValidationError('El código SKU ya está registrado.', 409);
        }
    }
    // Categoría
    if (!isUpdate || data.id_categoria !== undefined) {
        const catId = Number(data.id_categoria);
        if (!Number.isInteger(catId) || catId <= 0) {
            throw new ValidationError('La categoría debe ser un número entero válido.');
        }
        const exists = await categoryExists(catId);
        if (!exists) throw new ValidationError('La categoría no existe.', 404);
    }
    // Precio
    if (!isUpdate || data.precio !== undefined) {
        const precio = Number(data.precio);
        if (isNaN(precio) || precio < 0) {
            throw new ValidationError('El precio debe ser un número mayor o igual a 0.');
        }
    }
    // Stock (Bloqueo explícito de decimales)
    if (!isUpdate || data.stock !== undefined) {
        const stock = Number(data.stock);
        if (!Number.isInteger(stock) || stock < 0) {
            throw new ValidationError('El stock debe ser un número entero mayor o igual a 0 (no se permiten decimales).');
        }
    }
    // Activo (Bloqueo de formatos raros)
    if (data.activo !== undefined) {
        if (typeof data.activo !== 'boolean' && data.activo !== 1 && data.activo !== 0) {
            throw new ValidationError('El campo activo debe ser explícitamente booleano (true/false).');
        }
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
    const sku = typeof payload.codigo === 'string' ? payload.codigo.trim() : '';

    // Si el SKU está siendo procesado en este milisegundo por otro clic, lo rebotamos (Evita duplicados)
    if (sku && activeSkuLocks.has(sku)) {
        throw new ValidationError('Procesando solicitud. Por favor, evite hacer doble clic.', 409);
    }
    
    // Bloqueamos el SKU
    if (sku) activeSkuLocks.add(sku);

    try {
        await validateProductFields(payload, false);
        const insertId = await create(payload);
        return await findById(insertId);
    } finally {
        // Liberamos el SKU sin importar si falló o fue exitoso
        if (sku) activeSkuLocks.delete(sku);
    }
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
    
    if (existing.activo === 0 || existing.activo === false) return existing;
    
    await update(id, { activo: false });
    return await findById(id);
};

export const updateAdminProductStock = async (id: number, stock: any) => {
    const existing = await findById(id);
    if (!existing) throw new ValidationError('Producto no encontrado.', 404);

    const numStock = Number(stock);
    if (!Number.isInteger(numStock) || numStock < 0) {
        throw new ValidationError('El stock debe ser un número entero mayor o igual a 0.');
    }

    await updateStock(id, numStock);
    return await findById(id);
};