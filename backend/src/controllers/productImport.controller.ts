import { Request, Response } from 'express';
import {
    FileImportValidationError,
    confirmProductImport,
    getImportConfirmationStatus,
    validateProductImportFile
} from '../services/productImport.service';

const extractAuthenticatedAdminId = (req: Request, res: Response): string | number | null => {
    const anyReq = req as any;
    const candidates = [
        anyReq.user?.id,
        anyReq.user?.id_usuario,
        anyReq.user?.userId,
        anyReq.user?.sub,
        anyReq.auth?.id,
        anyReq.auth?.id_usuario,
        anyReq.auth?.sub,
        anyReq.authUser?.id,
        anyReq.authUser?.id_usuario,
        res.locals?.user?.id,
        res.locals?.user?.id_usuario,
        res.locals?.auth?.id
    ];

    for (const candidate of candidates) {
        if (candidate !== undefined && candidate !== null && String(candidate).trim() !== '') {
            return candidate;
        }
    }

    // Fallback: extraer del payload del JWT en Cookie o Authorization si el middleware no pobló req.user.id
    const cookieHeader = typeof req.headers?.cookie === 'string' ? req.headers.cookie : '';
    const cookieMatch = /(?:^|;\s*)jwt_token=([^;]+)/.exec(cookieHeader);
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(String(req.headers?.authorization ?? ''));
    const rawJwt = cookieMatch?.[1] || bearerMatch?.[1];

    if (rawJwt) {
        try {
            const parts = decodeURIComponent(rawJwt).split('.');
            if (parts.length === 3) {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
                const jwtId = payload.id ?? payload.id_usuario ?? payload.userId ?? payload.sub ?? payload.email;
                if (jwtId !== undefined && jwtId !== null) {
                    return jwtId;
                }
            }
        } catch {
            // Ignorar si no es decodificable
        }
    }

    return null;
};

export const validateProductFile = async (req: Request, res: Response) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                message: 'Debe adjuntar un archivo CSV o XLSX válido.'
            });
        }

        const adminId = extractAuthenticatedAdminId(req, res);
        const report = await validateProductImportFile(
            req.file.buffer,
            req.file.originalname,
            adminId
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
        const adminId = extractAuthenticatedAdminId(req, res);
        const result = await confirmProductImport(req.body, adminId);
        const httpStatus =
            result.estado === 'procesando' || result.estado === 'por_verificar' ? 202 : 200;
        return res.status(httpStatus).json(result);
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

export const getImportConfirmationStatusController = async (req: Request, res: Response) => {
    try {
        const adminId = extractAuthenticatedAdminId(req, res);
        const previewToken = String(req.params.previewToken ?? '');
        const result = await getImportConfirmationStatus(previewToken, adminId);
        return res.status(200).json(result);
    } catch (error: unknown) {
        if (error instanceof FileImportValidationError) {
            return res.status(error.statusCode).json({
                message: error.message
            });
        }
        console.error('Error al consultar estado de confirmación de importación:');
        return res.status(500).json({
            message: 'Error interno del servidor al consultar la confirmación.'
        });
    }
};