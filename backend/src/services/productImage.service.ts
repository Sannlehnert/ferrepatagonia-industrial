import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import sharp from 'sharp';
import { DatabaseOutcomeUnknownError } from '../config/database-policy';
import { readStorageDir } from '../config/storage-env.config';
import { isProductImageName, productImageName, productImagePrefix } from '../utils/product-image';

export const productImageMaxBytes = 5 * 1024 * 1024;
const maxDimension = 4096;
const maxPixels = 12_000_000;

export class ProductImageError extends Error {
    readonly code = 'PRODUCT_IMAGE_REJECTED';

    constructor(readonly statusCode: number, message: string) { super(message); }
}

function contains(parent: string, child: string): boolean {
    const path = relative(parent, child);
    return !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep);
}

export async function productImageDirectory(): Promise<string> {
    try {
        const configured = readStorageDir('PRODUCT_IMAGE_STORAGE_DIR', process.env);
        if (!configured) throw new Error();
        const root = await realpath(configured);
        if (!(await lstat(root)).isDirectory()) throw new Error();
        const privateDir = readStorageDir('RECEIPT_STORAGE_DIR', process.env);
        if (privateDir) {
            const receipts = await realpath(privateDir);
            if (contains(root, receipts) || contains(receipts, root)) throw new Error();
        }
        return root;
    } catch {
        throw new ProductImageError(503, 'El almacenamiento de fotos no está disponible.');
    }
}

export async function normalizeProductImage(file: Express.Multer.File): Promise<Buffer> {
    const { buffer, mimetype } = file;
    const signature = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff ? 'jpeg'
        : buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'png'
        : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' ? 'webp'
        : null;
    if (!signature || mimetype !== 'image/' + signature) {
        throw new ProductImageError(415, 'La foto debe ser JPEG, PNG o WebP y coincidir con su formato.');
    }

    const image = sharp(buffer, { failOn: 'warning', limitInputPixels: maxPixels });
    try {
        const { format, width, height, pages } = await image.metadata();
        if (format !== signature || !width || !height || width > maxDimension ||
            height > maxDimension || (pages ?? 1) !== 1) throw new Error();
        // A full decode and re-encode publishes only pixels, stripping input metadata.
        const normalized = await image.timeout({ seconds: 5 }).rotate().webp({ quality: 85 }).toBuffer();
        if (normalized.length > productImageMaxBytes) throw new Error();
        return normalized;
    } catch {
        throw new ProductImageError(422, 'La foto está dañada, es animada o supera los límites de dimensiones.');
    }
}

async function removeFile(root: string, name: string): Promise<void> {
    try {
        await unlink(join(root, name));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('product-image.cleanup.failed');
    }
}

export async function removeReplacedProductImage(url: string | null): Promise<void> {
    const name = productImageName(url);
    if (!name) return;
    try {
        await removeFile(await productImageDirectory(), name);
    } catch {
        console.error('product-image.cleanup.failed');
    }
}

export async function withProductImage<T>(
    file: Express.Multer.File | undefined,
    save: (url?: string) => Promise<T>,
): Promise<T> {
    if (!file) return save();
    const root = await productImageDirectory();
    const bytes = await normalizeProductImage(file);
    const name = randomUUID() + '.webp';
    try {
        const handle = await open(join(root, name), 'wx', 0o600);
        try {
            try {
                await handle.writeFile(bytes);
                await handle.sync();
            } finally {
                await handle.close();
            }
            if (process.platform !== 'win32') {
                const directory = await open(root, 'r');
                try { await directory.sync(); }
                finally { await directory.close(); }
            }
        } catch (error) {
            await removeFile(root, name);
            throw error;
        }
    } catch {
        throw new ProductImageError(503, 'No se pudo guardar la foto. Volvé a intentarlo.');
    }
    try {
        return await save(productImagePrefix + name);
    } catch (error) {
        if (!(error instanceof DatabaseOutcomeUnknownError)) await removeFile(root, name);
        throw error;
    }
}

export async function openProductImage(name: string) {
    if (!isProductImageName(name)) return null;
    const root = await productImageDirectory();
    const path = join(root, name);
    const entry = await lstat(path);
    if (!entry.isFile()) return null;
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        const info = await handle.stat();
        if (info.isFile() && info.ino === entry.ino && info.dev === entry.dev) return { handle, info };
    } catch (error) {
        await handle.close();
        throw error;
    }
    await handle.close();
    return null;
}
