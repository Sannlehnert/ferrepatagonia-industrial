import {findAllAdmin,findById,categoryExists,create,update,updateStock,CreateProductDTO,UpdateProductDTO} from '../repositories/adminProduct.repository';

import { validateDtoInput } from '../dtos/validation';
import { createProductPolicy, updateProductPolicy, updateProductWithImagePolicy, stockPolicy } from '../dtos/policies';
import { roundSqlDecimal2 } from '../dtos/rules';
import type { NotifyCommittedChange } from '../realtime/committed-change';
import { env } from '../config/env.config';
import { usesProductImageNamespace } from '../utils/product-image';
import { removeReplacedProductImage, withProductImage } from './productImage.service';

export class ValidationError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

// Candado en memoria complementario al UNIQUE de MariaDB
const activeSkuLocks = new Set<string>();

const validateProductFields = async (data: unknown, policy: typeof updateProductPolicy) => {
    const result = await validateDtoInput(policy, data);
    if (!result.valid) throw new ValidationError(result.message);
    if (result.data.id_categoria !== undefined && !await categoryExists(result.data.id_categoria)) {
        throw new ValidationError('La categoría no existe.', 404);
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

function validateImageUrl(value: string | null | undefined, current?: string | null) {
    if (value && value !== current && usesProductImageNamespace(value, env.httpSecurity.publicOrigin)) {
        throw new ValidationError('Seleccioná un archivo para asociar una foto del catálogo.');
    }
}

export const createAdminProduct = async (payload: CreateProductDTO, file?: Express.Multer.File) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new ValidationError('El cuerpo de la solicitud es obligatorio y debe ser un objeto JSON válido.');
    }

    const sku = typeof payload.codigo === 'string' ? payload.codigo.trim() : '';

    if (sku && activeSkuLocks.has(sku)) {
        throw new ValidationError('Procesando solicitud. Por favor, evite hacer doble clic.', 409);
    }

    if (sku) activeSkuLocks.add(sku);

    try {
        await validateProductFields(payload, createProductPolicy);
        validateImageUrl(payload.imagen);

        const normalizedPrice = roundSqlDecimal2(payload.precio);
        const normalizedPayload: CreateProductDTO = {
            ...payload,
            codigo: payload.codigo.trim(),
            nombre: payload.nombre.trim(),
            precio: normalizedPrice
        };

        const insertId = await withProductImage(file, imagen => {
            if (imagen) normalizedPayload.imagen = imagen;
            return create(normalizedPayload);
        });

        // Si el INSERT fue exitoso pero falla el SELECT posterior, devolvemos un fallback consistente con MariaDB
        try {
            const createdProduct = await findById(insertId);
            if (createdProduct) return createdProduct;
        } catch (readError) {
            console.error('Error al leer el producto tras el INSERT, devolviendo datos persistidos:');
        }

        return {
            id_producto: insertId,
            id_categoria: normalizedPayload.id_categoria,
            codigo: normalizedPayload.codigo,
            nombre: normalizedPayload.nombre,
            descripcion: normalizedPayload.descripcion ?? null,
            precio: normalizedPrice.toFixed(2) as unknown as number,
            stock: normalizedPayload.stock,
            imagen: normalizedPayload.imagen ?? null,
            activo: normalizedPayload.activo !== undefined ? (normalizedPayload.activo ? 1 : 0) : 1
        };
    } finally {
        if (sku) activeSkuLocks.delete(sku);
    }
};

export const updateAdminProduct = async (
    id: number, payload: UpdateProductDTO, notify?: NotifyCommittedChange, file?: Express.Multer.File,
) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new ValidationError('El cuerpo de la solicitud es obligatorio y debe ser un objeto JSON válido.');
    }

    const existing = await findById(id);
    if (!existing) throw new ValidationError('Producto no encontrado.', 404);

    await validateProductFields(payload, file ? updateProductWithImagePolicy : updateProductPolicy);
    validateImageUrl(payload.imagen, existing.imagen);

    const normalizedPayload: UpdateProductDTO = {
        ...payload,
        ...(payload.codigo !== undefined ? { codigo: payload.codigo.trim() } : {}),
        ...(payload.nombre !== undefined ? { nombre: payload.nombre.trim() } : {}),
        ...(payload.precio !== undefined && payload.precio !== null ? { precio: roundSqlDecimal2(payload.precio) } : {})
    };

    // Avoid reassigning an unchanged URL if another writer replaces it before our update.
    if (normalizedPayload.imagen === existing.imagen) delete normalizedPayload.imagen;
    const result = await withProductImage(file, async imagen => {
        if (imagen) normalizedPayload.imagen = imagen;
        const result = await update(id, normalizedPayload, notify);
        if (imagen && !result.updated) throw new ValidationError('Producto no encontrado.', 404);
        return result;
    });
    await removeReplacedProductImage(result.replacedImage);
    return await findById(id);
};

export const deactivateAdminProduct = async (id: number) => {
    const existing = await findById(id);
    if (!existing) throw new ValidationError('Producto no encontrado.', 404);

    if (existing.activo === 0 || existing.activo === false) return existing;

    await update(id, { activo: false });
    return await findById(id);
};

export const updateAdminProductStock = async (id: number, stock: unknown, notify?: NotifyCommittedChange) => {
    const existing = await findById(id);
    if (!existing) throw new ValidationError('Producto no encontrado.', 404);

    const result = await validateDtoInput(stockPolicy, { stock });
    if (!result.valid) throw new ValidationError(result.message);
    await updateStock(id, result.data.stock, notify);
    return await findById(id);
};
