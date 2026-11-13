import type { RequestHandler } from 'express';
import multer, { MulterError } from 'multer';
import { productImageMaxBytes } from '../services/productImage.service';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: productImageMaxBytes + 1, files: 1, fields: 1, fieldSize: 420 * 1024, parts: 3 },
}).single('imagen');

export const uploadProductImage: RequestHandler = (req, res, next) => {
    if (!req.is('multipart/form-data')) {
        res.status(415).json({ message: 'Enviá la foto en formato multipart/form-data.' });
        return;
    }
    upload(req, res, (error: unknown) => {
        if ((error instanceof MulterError && ['LIMIT_FILE_SIZE', 'LIMIT_FIELD_VALUE'].includes(error.code)) ||
            (req.file && req.file.size > productImageMaxBytes)) {
            res.status(413).json({ message: 'La foto no puede superar los 5 MiB y los datos del producto deben ser válidos.' });
            return;
        }
        if (error || !req.file?.size || typeof req.body?.producto !== 'string') {
            res.status(400).json({ message: 'Adjuntá una foto y los datos del producto.' });
            return;
        }
        try {
            req.body = JSON.parse(req.body.producto);
        } catch {
            res.status(400).json({ message: 'Los datos del producto deben estar en formato JSON.' });
            return;
        }
        if (req.body && Object.hasOwn(req.body, 'imagen')) {
            res.status(400).json({ message: 'Enviá la foto como archivo, sin incluir una URL en los datos del producto.' });
            return;
        }
        next();
    });
};
