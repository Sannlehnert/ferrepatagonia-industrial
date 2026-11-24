import { DatabaseOutcomeUnknownError, mutationErrorMessage } from '../config/database-policy';
import { Request, Response } from 'express';
import { getPriceVerificationDataSource } from '../config/price-verification.config';
import { hasDatabaseError } from '../services/cart.errors';
import {
    PriceVerificationError,
    verifyProductPrice,
} from '../services/pricing/price-verification';
import type { RealtimeRequest } from '../realtime/committed-change';
import { ProductImageError } from '../services/productImage.service';
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
        const products = await listAdminProducts(res.locals.dto.query);
        return res.status(200).json(products);
    } catch (error) {
        console.error('Error al listar productos:');
        return res.status(500).json({ message: mutationErrorMessage(error) });
    }
};

export const getProductById = async (req: Request, res: Response) => {
    try {
        const { id } = res.locals.dto.params;
        const product = await getAdminProductById(id);
        return res.status(200).json(product);
    } catch (error) {
        if (error instanceof ValidationError) return res.status(error.statusCode).json({ message: error.message });
        return res.status(500).json({ message: mutationErrorMessage(error) });
    }
};

export const createProduct = async (req: Request, res: Response) => {
    try {
        const newProduct = await createAdminProduct(res.locals.dto.body, req.file, req.auth?.id);
        return res.status(201).json(newProduct);
    } catch (error: any) {
        if (error instanceof ProductImageError) return res.status(error.statusCode).json({ message: error.message, code: error.code });
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
        const { id } = res.locals.dto.params;

        const updatedProduct = await updateAdminProduct(id, res.locals.dto.body, (req as RealtimeRequest).notifyCommittedChange, req.file, req.auth?.id);
        return res.status(200).json(updatedProduct);
    } catch (error: any) {
        if (error instanceof ProductImageError) return res.status(error.statusCode).json({ message: error.message, code: error.code });
        if (error instanceof ValidationError) return res.status(error.statusCode).json({ message: error.message });
        if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'El código SKU ya está registrado.' });
        if (error?.code === 'ER_DATA_TOO_LONG' || error?.code === 'ER_WARN_DATA_OUT_OF_RANGE') {
            return res.status(400).json({ message: 'Uno o más campos superan el límite permitido.' });
        }
        return res.status(500).json({ message: mutationErrorMessage(error) });
    }
};


export const verifyProductPriceHandler = async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('Cookie');
    const source = await getPriceVerificationDataSource();
    if (!source) {
        return res.status(503).json({
            code: 'VERIFICACION_NO_CONFIGURADA',
            message: 'La verificación administrativa de precios no está configurada en este entorno.',
        });
    }
    try {
        const { id } = res.locals.dto.params as { id: number };
        const body = res.locals.dto.body as { importe: string; evidencia: string; confirmar: true };
        if (!req.auth?.id) {
            return res.status(401).json({ message: 'No autenticado.' });
        }
        const result = await verifyProductPrice({
            productId: id,
            expectedPrice: body.importe,
            evidence: body.evidencia,
            adminId: req.auth.id,
            confirmed: true,
        }, { dataSource: source });
        if (!result.ok) {
            return res.status(409).json({
                code: result.code,
                message: result.message,
                ...(result.eventId ? { eventId: result.eventId } : {}),
            });
        }
        return res.status(200).json({
            data: {
                productoId: result.productId,
                precio: result.price,
                evidencia: result.evidence,
                verificadoEn: result.verifiedAt,
                estadoFer17: result.estadoFer17,
                publicado: result.publicado,
                eventoId: result.eventId,
                replay: result.replay,
            },
        });
    } catch (error) {
        if (error instanceof PriceVerificationError) {
            return res.status(error.status).json({ code: error.code, message: error.message });
        }
        if (error instanceof DatabaseOutcomeUnknownError) {
            return res.status(503).json({
                code: 'RESULTADO_DESCONOCIDO',
                message: 'No se pudo confirmar el resultado. Reintentá la misma verificación.',
            });
        }
        if (hasDatabaseError(error, 'ER_LOCK_WAIT_TIMEOUT', 1205)
            || hasDatabaseError(error, 'ER_LOCK_DEADLOCK', 1213)
            || hasDatabaseError(error, 'ER_STATEMENT_TIMEOUT', 1969)) {
            return res.status(409).json({
                code: 'CONFLICTO_CONCURRENCIA',
                message: 'La verificación encontró un conflicto concurrente. Reintentá.',
            });
        }
        console.error('Error al verificar precio administrativo.');
        return res.status(503).json({
            code: 'VERIFICACION_NO_DISPONIBLE',
            message: 'No se pudo verificar el precio en este momento. Reintentá en unos instantes.',
        });
    }
};

export const deactivateProduct = async (req: Request, res: Response) => {
    try {
        const { id } = res.locals.dto.params;
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
        const { id } = res.locals.dto.params;

        const product = await updateAdminProductStock(id, res.locals.dto.body.stock, (req as RealtimeRequest).notifyCommittedChange);
        return res.status(200).json({ message: 'Stock actualizado exitosamente', product });
    } catch (error: any) {
        if (error instanceof ValidationError) return res.status(error.statusCode).json({ message: error.message });
        console.error('Error al actualizar stock:');
        return res.status(500).json({ message: mutationErrorMessage(error) });
    }
};
