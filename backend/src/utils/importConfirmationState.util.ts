import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readStorageDir } from '../config/storage-env.config';
import { FileImportValidationError } from './import.utils';
import { ProductImportRowDto, RowFieldIssue } from '../dtos/products/productImport.dto';

export type ImportBatchGlobalState = 'pendiente' | 'procesando' | 'por_verificar' | 'completado';
export type ImportBatchRowState = 'pendiente' | 'importado' | 'omitido' | 'rechazado';

export interface PreviewBatchRowEntry {
    row: number;
    codigo: string;
    dto: ProductImportRowDto;
    estado: ImportBatchRowState;
    id_producto?: number;
    motivos: RowFieldIssue[];
}

export interface ConfirmationTokenRecord {
    token: string;
    createdAtMs: number;
    expiresAtMs: number;
    adminId: string | number | null;
    status: ImportBatchGlobalState;
    rows: PreviewBatchRowEntry[];
    attemptedSkus: Set<string>;
    importedProductIds: Set<number>;
    batchLinkedProducts: Map<string, number>;
}

interface SerializableConfirmationTokenRecord {
    token: string;
    createdAtMs: number;
    expiresAtMs: number;
    adminId: string | number | null;
    status: ImportBatchGlobalState;
    rows: PreviewBatchRowEntry[];
    attemptedSkus: string[];
    importedProductIds: number[];
    batchLinkedProducts: Array<[string, number]>;
}

const confirmationTokens = new Map<string, ConfirmationTokenRecord>();
const activeImportSkuLocks = new Set<string>();
const activeExecutionTokens = new Set<string>();
const PREVIEW_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const PREVIEW_TTL_MS = 30 * 60 * 1000;
export const REPORT_RETENTION_MS = 24 * 60 * 60 * 1000;

export const markTokenActiveExecution = (token: string): void => {
    activeExecutionTokens.add(token);
};

export const clearTokenActiveExecution = (token: string): void => {
    activeExecutionTokens.delete(token);
};

export const isTokenActivelyExecuting = (token: string): boolean => {
    return activeExecutionTokens.has(token);
};

const IMPORT_STORAGE_UNAVAILABLE_MESSAGE =
    'El almacenamiento de confirmaciones de importación no está disponible.';

const createStorageUnavailableError = (): FileImportValidationError =>
    new FileImportValidationError(IMPORT_STORAGE_UNAVAILABLE_MESSAGE, 503);

const verifyWritableDirectory = (dirPath: string): string => {
    const root = fs.realpathSync(dirPath);
    const stats = fs.lstatSync(root);
    if (!stats.isDirectory()) {
        throw createStorageUnavailableError();
    }
    fs.accessSync(root, fs.constants.R_OK | fs.constants.W_OK);
    return root;
};

const getStorageDir = (): string => {
    let configured: string | undefined;
    try {
        configured = readStorageDir('IMPORT_STORAGE_DIR', process.env);
    } catch {
        throw createStorageUnavailableError();
    }

    if (configured !== undefined) {
        try {
            return verifyWritableDirectory(configured);
        } catch (error) {
            if (error instanceof FileImportValidationError) throw error;
            throw createStorageUnavailableError();
        }
    }

    // Without explicit IMPORT_STORAGE_DIR, keep a controlled temp dir for dev/tests.
    // Persistence is ephemeral across OS temp cleanups or process restarts without shared volume.
    const fallbackDir = path.join(os.tmpdir(), 'ferrepatagonia-import-storage');
    try {
        if (!fs.existsSync(fallbackDir)) {
            fs.mkdirSync(fallbackDir, { recursive: true });
        }
        return verifyWritableDirectory(fallbackDir);
    } catch (error) {
        if (error instanceof FileImportValidationError) throw error;
        throw createStorageUnavailableError();
    }
};

const getRecordFilePath = (token: string): string => {
    const safeToken = token.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeToken) {
        throw createStorageUnavailableError();
    }
    return path.join(getStorageDir(), `${safeToken}.json`);
};

const cloneRowEntry = (entry: PreviewBatchRowEntry): PreviewBatchRowEntry => ({
    ...entry,
    dto: { ...entry.dto },
    motivos: entry.motivos.map((m) => ({ ...m }))
});

export const snapshotConfirmationRecord = (
    record: ConfirmationTokenRecord
): ConfirmationTokenRecord => ({
    token: record.token,
    createdAtMs: record.createdAtMs,
    expiresAtMs: record.expiresAtMs,
    adminId: record.adminId,
    status: record.status,
    rows: record.rows.map(cloneRowEntry),
    attemptedSkus: new Set(record.attemptedSkus),
    importedProductIds: new Set(record.importedProductIds),
    batchLinkedProducts: new Map(record.batchLinkedProducts)
});

export const restoreConfirmationRecord = (
    target: ConfirmationTokenRecord,
    snapshot: ConfirmationTokenRecord
): void => {
    target.status = snapshot.status;
    target.rows = snapshot.rows.map(cloneRowEntry);
    target.attemptedSkus = new Set(snapshot.attemptedSkus);
    target.importedProductIds = new Set(snapshot.importedProductIds);
    target.batchLinkedProducts = new Map(snapshot.batchLinkedProducts);
};

export const persistRecordToDisk = (record: ConfirmationTokenRecord): void => {
    const filePath = getRecordFilePath(record.token);
    const serializable: SerializableConfirmationTokenRecord = {
        token: record.token,
        createdAtMs: record.createdAtMs,
        expiresAtMs: record.expiresAtMs,
        adminId: record.adminId,
        status: record.status,
        rows: record.rows,
        attemptedSkus: Array.from(record.attemptedSkus),
        importedProductIds: Array.from(record.importedProductIds),
        batchLinkedProducts: Array.from(record.batchLinkedProducts.entries())
    };
    const payload = JSON.stringify(serializable);
    const tmpPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;

    try {
        fs.writeFileSync(tmpPath, payload, 'utf8');
        fs.renameSync(tmpPath, filePath);
    } catch (error) {
        try {
            if (fs.existsSync(tmpPath)) {
                fs.unlinkSync(tmpPath);
            }
        } catch {
            // Ignore temp cleanup failure
        }
        if (error instanceof FileImportValidationError) throw error;
        throw createStorageUnavailableError();
    }
};

const loadRecordFromDisk = (token: string): ConfirmationTokenRecord | undefined => {
    const filePath = getRecordFilePath(token);
    if (!fs.existsSync(filePath)) return undefined;

    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data: SerializableConfirmationTokenRecord = JSON.parse(raw);
        if (data.token !== token) return undefined;
        const record: ConfirmationTokenRecord = {
            token: data.token,
            createdAtMs: data.createdAtMs,
            expiresAtMs: data.expiresAtMs,
            adminId: data.adminId,
            status: data.status,
            rows: data.rows,
            attemptedSkus: new Set(data.attemptedSkus || []),
            importedProductIds: new Set(data.importedProductIds || []),
            batchLinkedProducts: new Map(data.batchLinkedProducts || [])
        };
        confirmationTokens.set(token, record);
        return record;
    } catch (error) {
        if (error instanceof SyntaxError) {
            return undefined;
        }
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
            return undefined;
        }
        if (error instanceof FileImportValidationError) throw error;
        throw createStorageUnavailableError();
    }
};

export const normalizeSkuKey = (sku: string): string => {
    return sku
        .trim()
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ß/gi, 'SS')
        .toUpperCase();
};

export const cleanExpiredConfirmationTokens = (): void => {
    const now = Date.now();
    for (const [token, record] of confirmationTokens.entries()) {
        const isPendingExpired = record.status === 'pendiente' && now > record.expiresAtMs;
        const isRetentionExpired = now > record.createdAtMs + REPORT_RETENTION_MS;

        if (isPendingExpired || isRetentionExpired) {
            confirmationTokens.delete(token);
            try {
                const p = getRecordFilePath(token);
                if (fs.existsSync(p)) fs.unlinkSync(p);
            } catch {
                // Ignore cleanup errors
            }
        }
    }
};

export const registerConfirmationToken = (
    token: string,
    rows: PreviewBatchRowEntry[],
    adminId?: number | string | null
): ConfirmationTokenRecord => {
    getStorageDir();
    cleanExpiredConfirmationTokens();
    const now = Date.now();
    const record: ConfirmationTokenRecord = {
        token,
        createdAtMs: now,
        expiresAtMs: now + PREVIEW_TTL_MS,
        adminId: adminId !== undefined && adminId !== null ? adminId : null,
        status: 'pendiente',
        rows,
        attemptedSkus: new Set<string>(),
        importedProductIds: new Set<number>(),
        batchLinkedProducts: new Map<string, number>()
    };
    persistRecordToDisk(record);
    confirmationTokens.set(token, record);
    return record;
};

export const getConfirmationTokenRecordRaw = (token: string): ConfirmationTokenRecord | undefined => {
    if (!PREVIEW_TOKEN_PATTERN.test(token)) return undefined;

    getStorageDir();
    cleanExpiredConfirmationTokens();
    let record = confirmationTokens.get(token);
    if (!record) {
        record = loadRecordFromDisk(token);
    }
    return record;
};

export const isConfirmationTokenExpired = (record: ConfirmationTokenRecord): boolean => {
    if (record.status !== 'pendiente') {
        return Date.now() > record.createdAtMs + REPORT_RETENTION_MS;
    }
    return Date.now() > record.expiresAtMs;
};

export const setConfirmationTokenStatus = (
    token: string,
    status: ImportBatchGlobalState
): void => {
    const record = getConfirmationTokenRecordRaw(token);
    if (record) {
        const previousStatus = record.status;
        record.status = status;
        try {
            persistRecordToDisk(record);
        } catch (error) {
            record.status = previousStatus;
            throw error;
        }
    }
};

export const recordBatchProvisionalProductLink = (
    token: string,
    sku: string,
    idProducto: number
): void => {
    const record = getConfirmationTokenRecordRaw(token);
    if (record && idProducto > 0) {
        const norm = normalizeSkuKey(sku);
        const hadBatchLink = record.batchLinkedProducts.has(norm);
        const prevBatchLink = record.batchLinkedProducts.get(norm);
        const hadImportedId = record.importedProductIds.has(idProducto);
        const matchingRow = record.rows.find(
            (r) => normalizeSkuKey(r.codigo) === norm && r.estado === 'pendiente'
        );
        const prevRowId = matchingRow?.id_producto;

        record.batchLinkedProducts.set(norm, idProducto);
        record.importedProductIds.add(idProducto);
        if (matchingRow) {
            matchingRow.id_producto = idProducto;
        }

        try {
            persistRecordToDisk(record);
        } catch (error) {
            if (hadBatchLink && prevBatchLink !== undefined) {
                record.batchLinkedProducts.set(norm, prevBatchLink);
            } else {
                record.batchLinkedProducts.delete(norm);
            }
            if (!hadImportedId) {
                record.importedProductIds.delete(idProducto);
            }
            if (matchingRow) {
                matchingRow.id_producto = prevRowId;
            }
            throw error;
        }
    }
};

export const recordImportedProductLink = (
    token: string,
    idProducto: number
): void => {
    const record = getConfirmationTokenRecordRaw(token);
    if (record && idProducto > 0) {
        const hadImportedId = record.importedProductIds.has(idProducto);
        record.importedProductIds.add(idProducto);
        try {
            persistRecordToDisk(record);
        } catch (error) {
            if (!hadImportedId) {
                record.importedProductIds.delete(idProducto);
            }
            throw error;
        }
    }
};

export const saveConfirmationRecord = (record: ConfirmationTokenRecord): void => {
    persistRecordToDisk(record);
    confirmationTokens.set(record.token, record);
};

export const tryAcquireSkuLocks = (skus: string[]): boolean => {
    const normalized = skus.map((s) => normalizeSkuKey(s));
    for (const sku of normalized) {
        if (activeImportSkuLocks.has(sku)) {
            return false;
        }
    }
    for (const sku of normalized) {
        activeImportSkuLocks.add(sku);
    }
    return true;
};

export const releaseSkuLocks = (skus: string[]): void => {
    const normalized = skus.map((s) => normalizeSkuKey(s));
    for (const sku of normalized) {
        activeImportSkuLocks.delete(sku);
    }
};