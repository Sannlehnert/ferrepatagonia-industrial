import { Router } from 'express';
import { pipeline } from 'node:stream/promises';
import { openProductImage, ProductImageError } from '../services/productImage.service';

export const productImageRouter = Router();

productImageRouter.get('/product-images/:name', async (req, res, next) => {
    try {
        const image = await openProductImage(req.params.name);
        if (!image) return next();
        res.set({
            'Content-Type': 'image/webp',
            'Content-Length': String(image.info.size),
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'public, max-age=86400, immutable',
        });
        if (req.method === 'HEAD') {
            await image.handle.close();
            return res.end();
        }
        await pipeline(image.handle.createReadStream(), res);
    } catch (error) {
        if (res.destroyed) return;
        if (res.headersSent) {
            next(error);
            return;
        }
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return next();
        if (error instanceof ProductImageError) {
            if (error.statusCode >= 500) {
                res.setHeader('Cache-Control', 'no-store');
            }
            res.status(error.statusCode).json({ message: error.message, code: error.code });
            return;
        }
        next(error);
    }
});
