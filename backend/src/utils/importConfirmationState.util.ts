export interface ConfirmationTokenRecord {
    token: string;
    createdAt: number;
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED';
    result?: unknown;
}

const confirmationTokens = new Map<string, ConfirmationTokenRecord>();
const activeImportSkuLocks = new Set<string>();
const TOKEN_TTL_MS = 30 * 60 * 1000;

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

const cleanExpiredTokens = (): void => {
    const now = Date.now();
    for (const [token, record] of confirmationTokens.entries()) {
        if (now - record.createdAt > TOKEN_TTL_MS) {
            confirmationTokens.delete(token);
        }
    }
};

export const registerConfirmationToken = (token: string): void => {
    cleanExpiredTokens();
    confirmationTokens.set(token, {
        token,
        createdAt: Date.now(),
        status: 'PENDING'
    });
};

export const getConfirmationTokenRecord = (token: string): ConfirmationTokenRecord | undefined => {
    cleanExpiredTokens();
    return confirmationTokens.get(token);
};

export const markConfirmationTokenProcessing = (token: string): void => {
    const record = confirmationTokens.get(token);
    if (record) {
        record.status = 'PROCESSING';
    }
};

export const markConfirmationTokenCompleted = (token: string, result: unknown): void => {
    const record = confirmationTokens.get(token);
    if (record) {
        record.status = 'COMPLETED';
        record.result = result;
    }
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