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
    if (!isUpdate || data.nombre !== undefined) {
        if (typeof data.nombre !== 'string' || data.nombre.trim() === '') {
            throw new ValidationError('El nombre del producto es obligatorio y debe ser texto.');
        }
    }

    if (!isUpdate || data.codigo !== undefined) {
        if (typeof data.codigo !== 'string' || data.codigo.trim() === '') {
            throw new ValidationError('El código SKU es obligatorio y debe ser texto.');
        }
    }

    if (!isUpdate || data.id_categoria !== undefined) {
        if (typeof data.id_categoria !== 'number' || !Number.isInteger(data.id_categoria) || data.id_categoria <= 0) {
            throw new ValidationError('La categoría debe ser un número entero válido mayor a 0.');
        }
        const exists = await categoryExists(data.id_categoria);
        if (!exists) throw new ValidationError('La categoría no existe.', 404);
    }

    if (!isUpdate || data.precio !== undefined) {
        if (typeof data.precio !== 'number' || data.precio < 0 || data.precio > 9999999999.99) {
            throw new ValidationError('El precio debe ser un valor numérico válido mayor o igual a 0.');
        }
    }

    if (!isUpdate || data.stock !== undefined) {
        if (typeof data.stock !== 'number' || !Number.isInteger(data.stock) || data.stock < 0 || data.stock > 2147483647) {
            throw new ValidationError('El stock debe ser un número entero estricto entre 0 y 2147483647.');
        }
    }

    if (data.activo !== undefined) {
        if (typeof data.activo !== 'boolean') {
            throw new ValidationError('El campo activo debe ser estrictamente booleano (true/false).');
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

    // Rechaza booleanos, nulos, arrays y strings
    if (typeof stock !== 'number') {
        throw new ValidationError('El stock debe ser un valor numérico estricto.');
    }

    // Bloqueo de decimales, negativos y desbordamiento SQL (Max INT en MariaDB)
    if (!Number.isInteger(stock) || stock < 0 || stock > 2147483647) {
        throw new ValidationError('El stock debe ser un número entero válido entre 0 y 2147483647.');
    }

    await updateStock(id, stock);
    return await findById(id);
};