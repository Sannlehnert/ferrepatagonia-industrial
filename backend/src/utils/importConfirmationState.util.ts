import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

// TTL de 30 minutos exclusivo para iniciar la confirmación de la previsualización
export const PREVIEW_TTL_MS = 30 * 60 * 1000;
// Retención de 24 horas para reportes iniciados o completados
export const REPORT_RETENTION_MS = 24 * 60 * 60 * 1000;

const getStorageDir = (): string => {
    const dir = process.env.IMPORT_STORAGE_DIR || path.join(os.tmpdir(), 'ferrepatagonia-import-storage');
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    } catch {
        return os.tmpdir();
    }
};

const getRecordFilePath = (token: string): string => {
    const safeToken = token.replace(/[^a-zA-Z0-9_-]/g, '');
    return path.join(getStorageDir(), `${safeToken}.json`);
};

export const persistRecordToDisk = (record: ConfirmationTokenRecord): void => {
    try {
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
        fs.writeFileSync(getRecordFilePath(record.token), JSON.stringify(serializable), 'utf8');
    } catch {
        // Fallback en entornos de solo lectura
    }
};

const loadRecordFromDisk = (token: string): ConfirmationTokenRecord | undefined => {
    try {
        const filePath = getRecordFilePath(token);
        if (!fs.existsSync(filePath)) return undefined;
        const raw = fs.readFileSync(filePath, 'utf8');
        const data: SerializableConfirmationTokenRecord = JSON.parse(raw);
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
    } catch {
        return undefined;
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
    confirmationTokens.set(token, record);
    persistRecordToDisk(record);
    return record;
};

export const getConfirmationTokenRecordRaw = (token: string): ConfirmationTokenRecord | undefined => {
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
        record.status = status;
        persistRecordToDisk(record);
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
        record.batchLinkedProducts.set(norm, idProducto);
        record.importedProductIds.add(idProducto);
        persistRecordToDisk(record);
    }
};

export const recordImportedProductLink = (
    token: string,
    idProducto: number
): void => {
    const record = getConfirmationTokenRecordRaw(token);
    if (record && idProducto > 0) {
        record.importedProductIds.add(idProducto);
        persistRecordToDisk(record);
    }
};

export const saveConfirmationRecord = (record: ConfirmationTokenRecord): void => {
    confirmationTokens.set(record.token, record);
    persistRecordToDisk(record);
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