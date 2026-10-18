import { Request, Response } from 'express';
import { listAdminProducts, getAdminProductById, createAdminProduct, updateAdminProduct, ValidationError } from '../services/adminProduct.service';

export const getProducts = async (_req: Request, res: Response) => {
    try {
        const products = await listAdminProducts();
        return res.status(200).json(products);
    } catch (error) {
        console.error('Error al listar productos:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
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
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

export const createProduct = async (req: Request, res: Response) => {
    try {
        const newProduct = await createAdminProduct(req.body);
        return res.status(201).json(newProduct);
    } catch (error) {
        if (error instanceof ValidationError) return res.status(error.statusCode).json({ message: error.message });
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

export const updateProduct = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ message: 'ID inválido' });
        }
        const updatedProduct = await updateAdminProduct(id, req.body);
        return res.status(200).json(updatedProduct);
    } catch (error) {
        if (error instanceof ValidationError) return res.status(error.statusCode).json({ message: error.message });
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};