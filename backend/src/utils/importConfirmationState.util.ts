import { ProductImportRowDto, RowFieldIssue } from '../dtos/products/productImport.dto';

export type ImportBatchGlobalState = 'pendiente' | 'procesando' | 'por_verificar' | 'completado';
export type ImportBatchRowState = 'importado' | 'omitido' | 'rechazado' | 'pendiente';

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
    adminId: string | null;
    createdAtMs: number;
    expiresAtMs: number;
    status: ImportBatchGlobalState;
    rows: PreviewBatchRowEntry[];
    attemptedSkus: Set<string>;
}

const confirmationTokens = new Map<string, ConfirmationTokenRecord>();
const activeImportSkuLocks = new Set<string>();
export const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutos

export const normalizeSkuKey = (sku: string): string => {
    return sku
        .trim()
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ß/gi, 'ss')
        .replace(/œ/gi, 'oe')
        .replace(/ª/gi, 'a')
        .replace(/º/gi, 'o')
        .toLowerCase();
};

export const registerConfirmationToken = (
    token: string,
    rows: PreviewBatchRowEntry[] = [],
    adminId?: number | string | null,
    ttlMs: number = TOKEN_TTL_MS
): ConfirmationTokenRecord => {
    const now = Date.now();
    const record: ConfirmationTokenRecord = {
        token,
        adminId: adminId !== undefined && adminId !== null ? String(adminId) : null,
        createdAtMs: now,
        expiresAtMs: now + ttlMs,
        status: 'pendiente',
        rows: rows.map((r) => ({
            ...r,
            motivos: [...r.motivos]
        })),
        attemptedSkus: new Set<string>()
    };
    confirmationTokens.set(token, record);
    return record;
};

export const getConfirmationTokenRecordRaw = (token: string): ConfirmationTokenRecord | undefined => {
    return confirmationTokens.get(token);
};

export const isConfirmationTokenExpired = (record: ConfirmationTokenRecord): boolean => {
    return record.status === 'pendiente' && Date.now() > record.expiresAtMs;
};

export const setConfirmationTokenStatus = (
    token: string,
    status: ImportBatchGlobalState
): void => {
    const record = confirmationTokens.get(token);
    if (record) {
        record.status = status;
    }
};

export const tryAcquireSkuLocks = (skus: string[]): boolean => {
    const normalized = Array.from(
        new Set(skus.map((s) => normalizeSkuKey(s)).filter((s) => s.length > 0))
    );
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
    const normalized = Array.from(
        new Set(skus.map((s) => normalizeSkuKey(s)).filter((s) => s.length > 0))
    );
    for (const sku of normalized) {
        activeImportSkuLocks.delete(sku);
    }
};

export const clearConfirmationTokensForTesting = (): void => {
    confirmationTokens.clear();
    activeImportSkuLocks.clear();
};

export const getConfirmationTokenRecord = getConfirmationTokenRecordRaw;

export const markConfirmationTokenProcessing = (token: string): void => {
    setConfirmationTokenStatus(token, 'procesando');
};

export const markConfirmationTokenCompleted = (token: string, _result?: unknown): void => {
    setConfirmationTokenStatus(token, 'completado');
};