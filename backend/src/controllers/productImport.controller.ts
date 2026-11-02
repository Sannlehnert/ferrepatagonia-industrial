import { Request, Response } from 'express';
import {FileImportValidationError,validateProductImportFile} from '../services/productImport.service';

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
        console.error('Error al validar archivo de importación de productos:');
        return res.status(500).json({
            message: 'Error interno del servidor'
        });
    }
};