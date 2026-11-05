import { Request, Response } from 'express';
import {
    FileImportValidationError,
    confirmProductImport,
    validateProductImportFile
} from '../services/productImport.service';

export const validateProductFile = async (req: Request, res: Response) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                message: 'Debe adjuntar un archivo CSV o XLSX válido.'
            });
        }

        const report = await validateProductImportFile(
            req.file.buffer,
            req.file.originalname
        );

        return res.status(200).json(report);
    } catch (error: unknown) {
        if (error instanceof FileImportValidationError) {
            return res.status(error.statusCode).json({
                message: error.message
            });
        }
        console.error('Error al previsualizar/validar archivo de importación:');
        return res.status(500).json({
            message: 'Error interno del servidor'
        });
    }
};

export const confirmProductImportController = async (req: Request, res: Response) => {
    try {
        const result = await confirmProductImport(req.body);
        return res.status(200).json(result);
    } catch (error: unknown) {
        if (error instanceof FileImportValidationError) {
            return res.status(error.statusCode).json({
                message: error.message
            });
        }
        console.error('Error al confirmar importación de productos:');
        return res.status(500).json({
            message: 'Error interno del servidor al confirmar la importación.'
        });
    }
};