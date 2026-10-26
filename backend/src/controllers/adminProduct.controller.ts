import { mutationErrorMessage } from '../config/database-policy';
import { Request, Response } from 'express';
import {
    listAdminProducts,
    getAdminProductById,
    createAdminProduct,
    updateAdminProduct,
    ValidationError,
    deactivateAdminProduct,
    updateAdminProductStock
} from '../services/adminProduct.service';

export const getProducts = async (_req: Request, res: Response) => {
    try {
        const products = await listAdminProducts();
        return res.status(200).json(products);
    } catch (error) {
        console.error('Error al listar productos:');
        return res.status(500).json({ message: mutationErrorMessage(error) });
    }
};

export const getProductById = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ message: 'ID inválido' });
        }
        const product = await getAdminProductById(id);
        return res.status(200).json(product);
    } catch (error) {
        if (error instanceof ValidationError) return res.status(error.statusCode).json({ message: error.message });
        return res.status(500).json({ message: mutationErrorMessage(error) });
    }
};

export const createProduct = async (req: Request, res: Response) => {
    try {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).json({ message: 'El cuerpo de la solicitud es requerido y debe ser un objeto válido.' });
        }

        const newProduct = await createAdminProduct(req.body);
        return res.status(201).json(newProduct);
    } catch (error: any) {
        if (error instanceof ValidationError) return res.status(error.statusCode).json({ message: error.message });
        if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'El código SKU ya está registrado.' });
        if (error?.code === 'ER_DATA_TOO_LONG' || error?.code === 'ER_WARN_DATA_OUT_OF_RANGE') {
            return res.status(400).json({ message: 'Uno o más campos superan el límite permitido.' });
        }
        console.error('Error al crear producto:');
        return res.status(500).json({ message: mutationErrorMessage(error) });
    }
};

export const updateProduct = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ message: 'ID inválido' });
        }

        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).json({ message: 'El cuerpo de la solicitud es requerido y debe ser un objeto válido.' });
        }

        const updatedProduct = await updateAdminProduct(id, req.body);
        return res.status(200).json(updatedProduct);
    } catch (error: any) {
        if (error instanceof ValidationError) return res.status(error.statusCode).json({ message: error.message });
        if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'El código SKU ya está registrado.' });
        if (error?.code === 'ER_DATA_TOO_LONG' || error?.code === 'ER_WARN_DATA_OUT_OF_RANGE') {
            return res.status(400).json({ message: 'Uno o más campos superan el límite permitido.' });
        }
        return res.status(500).json({ message: mutationErrorMessage(error) });
    }
};

export const deactivateProduct = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ message: 'ID inválido' });
        }
        const product = await deactivateAdminProduct(id);
        return res.status(200).json({ message: 'Producto desactivado exitosamente', product });
    } catch (error) {
        if (error instanceof ValidationError) return res.status(error.statusCode).json({ message: error.message });
        console.error('Error al desactivar producto:');
        return res.status(500).json({ message: mutationErrorMessage(error) });
    }
};

export const updateProductStock = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ message: 'ID inválido' });
        }

        if (!req.body || typeof req.body !== 'object' || !('stock' in req.body)) {
            return res.status(400).json({ message: 'El campo stock es requerido' });
        }

        const product = await updateAdminProductStock(id, req.body.stock);
        return res.status(200).json({ message: 'Stock actualizado exitosamente', product });
    } catch (error: any) {
        if (error instanceof ValidationError) return res.status(error.statusCode).json({ message: error.message });
        console.error('Error al actualizar stock:');
        return res.status(500).json({ message: mutationErrorMessage(error) });
    }
};