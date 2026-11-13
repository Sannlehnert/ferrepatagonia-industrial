import { Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import path from 'node:path';

export const MAX_UPLOAD_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB

const ALLOWED_EXTENSIONS = new Set(['.csv', '.xlsx']);

const CSV_MIME_TYPES = new Set([
    'text/csv',
    'application/csv',
    'text/plain',
    'application/vnd.ms-excel',
    'application/octet-stream'
]);

const XLSX_MIME_TYPES = new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
]);

const XLSX_ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
        files: 1,
        fields: 5,
        parts: 10
    },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const mime = (file.mimetype || '').toLowerCase();

        if (!ALLOWED_EXTENSIONS.has(ext)) {
            return cb(new Error('Formato de archivo no permitido. Solo se aceptan archivos .csv o .xlsx.'));
        }

        if (ext === '.csv' && !CSV_MIME_TYPES.has(mime)) {
            return cb(new Error('El tipo MIME del archivo no coincide con un archivo CSV válido.'));
        }

        if (ext === '.xlsx' && !XLSX_MIME_TYPES.has(mime)) {
            return cb(new Error('El tipo MIME del archivo no coincide con un archivo Excel (.xlsx) válido.'));
        }

        cb(null, true);
    }
}).single('file');

const hasValidFileSignature = (buffer: Buffer, ext: string): boolean => {
    if (ext === '.xlsx') {
        if (buffer.length < 4) {
            return false;
        }
        return buffer.subarray(0, 4).equals(XLSX_ZIP_SIGNATURE);
    }

    if (ext === '.csv') {
        if (buffer.length >= 4 && buffer.subarray(0, 4).equals(XLSX_ZIP_SIGNATURE)) {
            return false;
        }
        const sampleLength = Math.min(buffer.length, 4096);
        for (let i = 0; i < sampleLength; i++) {
            if (buffer[i] === 0x00) {
                return false;
            }
        }
        return true;
    }

    return false;
};

export const uploadCatalogFile = (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (err: unknown) => {
        if (err instanceof MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                res.status(413).json({
                    message: 'El archivo supera el tamaño máximo permitido de 5 MiB.'
                });
                return;
            }
            if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
                res.status(400).json({
                    message: 'Debe enviar exactamente un archivo en el campo "file".'
                });
                return;
            }
            res.status(400).json({
                message: 'Error al procesar la carga del archivo.'
            });
            return;
        }

        if (err instanceof Error) {
            res.status(400).json({
                message: err.message
            });
            return;
        }

        if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
            res.status(400).json({
                message: 'Debe adjuntar un archivo CSV o XLSX válido y no vacío.'
            });
            return;
        }

        const ext = path.extname(req.file.originalname || '').toLowerCase();
        if (!hasValidFileSignature(req.file.buffer, ext)) {
            res.status(400).json({
                message: 'El contenido del archivo está corrupto o no corresponde a su extensión.'
            });
            return;
        }

        next();
    });
};