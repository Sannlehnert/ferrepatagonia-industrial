import {
    findAllAdmin,
    findById,
    categoryExists,
    create,
    update,
    updateStock,
    CreateProductDTO,
    UpdateProductDTO
} from '../repositories/adminProduct.repository';

export class ValidationError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

// Candado en memoria complementario al UNIQUE de MariaDB
const activeSkuLocks = new Set<string>();

const validateProductFields = async (data: any, isUpdate = false) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new ValidationError('El cuerpo de la solicitud es obligatorio y debe ser un objeto JSON válido.');
    }

    if (isUpdate) {
        const updatableKeys = ['id_categoria', 'codigo', 'nombre', 'descripcion', 'precio', 'stock', 'imagen', 'activo'];
        const hasAtLeastOneField = updatableKeys.some((key) => data[key] !== undefined);
        if (!hasAtLeastOneField) {
            throw new ValidationError('Debe proporcionar al menos un campo válido para actualizar.');
        }
    }

    // Nombre: VARCHAR(200) NOT NULL
    if (!isUpdate || data.nombre !== undefined) {
        if (typeof data.nombre !== 'string') {
            throw new ValidationError('El nombre del producto es obligatorio y debe ser texto.');
        }
        const trimmedNombre = data.nombre.trim();
        if (trimmedNombre.length === 0 || trimmedNombre.length > 200) {
            throw new ValidationError('El nombre del producto es obligatorio y no debe superar los 200 caracteres.');
        }
    }

    // Código SKU: VARCHAR(100) NOT NULL
    if (!isUpdate || data.codigo !== undefined) {
        if (typeof data.codigo !== 'string') {
            throw new ValidationError('El código SKU es obligatorio y debe ser texto.');
        }
        const trimmedCodigo = data.codigo.trim();
        if (trimmedCodigo.length === 0 || trimmedCodigo.length > 100) {
            throw new ValidationError('El código SKU es obligatorio y no debe superar los 100 caracteres.');
        }
    }

    // Descripción: TEXT NULL (máx 65535 bytes en MariaDB)
    if (data.descripcion !== undefined && data.descripcion !== null) {
        if (typeof data.descripcion !== 'string') {
            throw new ValidationError('La descripción debe ser texto.');
        }
        if (Buffer.byteLength(data.descripcion, 'utf8') > 65535) {
            throw new ValidationError('La descripción supera la longitud máxima permitida (65535 bytes).');
        }
    }

    // Imagen: VARCHAR(2048) NULL
    if (data.imagen !== undefined && data.imagen !== null) {
        if (typeof data.imagen !== 'string') {
            throw new ValidationError('La URL de la imagen debe ser texto.');
        }
        if (data.imagen.length > 2048) {
            throw new ValidationError('La URL de la imagen no debe superar los 2048 caracteres.');
        }
    }

    // Categoría: INT NOT NULL
    if (!isUpdate || data.id_categoria !== undefined) {
        if (
            typeof data.id_categoria !== 'number' ||
            !Number.isInteger(data.id_categoria) ||
            data.id_categoria <= 0 ||
            data.id_categoria > 2147483647
        ) {
            throw new ValidationError('La categoría debe ser un número entero válido mayor a 0.');
        }
        const exists = await categoryExists(data.id_categoria);
        if (!exists) throw new ValidationError('La categoría no existe.', 404);
    }

    // Precio: DECIMAL(12,2) NOT NULL
    if (!isUpdate || data.precio !== undefined) {
        if (
            typeof data.precio !== 'number' ||
            !Number.isFinite(data.precio) ||
            data.precio < 0 ||
            data.precio > 9999999999.99
        ) {
            throw new ValidationError('El precio debe ser un valor numérico válido entre 0 y 9999999999.99.');
        }
    }

    // Stock: INT NOT NULL
    if (!isUpdate || data.stock !== undefined) {
        if (
            typeof data.stock !== 'number' ||
            !Number.isInteger(data.stock) ||
            data.stock < 0 ||
            data.stock > 2147483647
        ) {
            throw new ValidationError('El stock debe ser un número entero estricto entre 0 y 2147483647.');
        }
    }

    // Activo: BOOLEAN NOT NULL
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
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new ValidationError('El cuerpo de la solicitud es obligatorio y debe ser un objeto JSON válido.');
    }

    const sku = typeof payload.codigo === 'string' ? payload.codigo.trim() : '';

    if (sku && activeSkuLocks.has(sku)) {
        throw new ValidationError('Procesando solicitud. Por favor, evite hacer doble clic.', 409);
    }

    if (sku) activeSkuLocks.add(sku);

    try {
        await validateProductFields(payload, false);
        const insertId = await create(payload);

        // Si el INSERT fue exitoso pero falla el SELECT posterior, devolvemos un fallback controlado (evita 500)
        try {
            const createdProduct = await findById(insertId);
            if (createdProduct) return createdProduct;
        } catch (readError) {
            console.error('Error al leer el producto tras el INSERT, devolviendo datos persistidos:', readError);
        }

        return {
            id_producto: insertId,
            id_categoria: payload.id_categoria,
            codigo: payload.codigo.trim(),
            nombre: payload.nombre.trim(),
            descripcion: payload.descripcion ?? null,
            precio: payload.precio,
            stock: payload.stock,
            imagen: payload.imagen ?? null,
            activo: payload.activo !== undefined ? (payload.activo ? 1 : 0) : 1
        };
    } finally {
        if (sku) activeSkuLocks.delete(sku);
    }
};

export const updateAdminProduct = async (id: number, payload: UpdateProductDTO) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new ValidationError('El cuerpo de la solicitud es obligatorio y debe ser un objeto JSON válido.');
    }

    const existing = await findById(id);
    if (!existing) throw new ValidationError('Producto no encontrado.', 404);

    await validateProductFields(payload, true);
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

    if (typeof stock !== 'number') {
        throw new ValidationError('El stock debe ser un valor numérico estricto.');
    }

    if (!Number.isInteger(stock) || stock < 0 || stock > 2147483647) {
        throw new ValidationError('El stock debe ser un número entero válido entre 0 y 2147483647.');
    }

    await updateStock(id, stock);
    return await findById(id);
};