export class CartError extends Error {
    constructor(readonly code: string, readonly status: number, message: string) {
        super(message);
    }
}

export function cartConflict(): CartError {
    return new CartError('CONFLICTO_CARRITO', 409, 'Consultá el carrito y volvé a intentar.');
}

// ER_STATEMENT_TIMEOUT is ambiguous on general SQL. Only point locking reads
// may tag it as contention, and the caller still has to confirm rollback.
export class CartLockStatementTimeout extends Error {
    constructor(cause: unknown) {
        super('Tiempo de espera de lectura bloqueante del carrito.', { cause });
    }
}

export function hasDatabaseError(error: unknown, code: string, errno: number): boolean {
    const pending = [error];
    const seen = new Set<object>();
    while (pending.length) {
        const next = pending.pop();
        if (!next || typeof next !== 'object' || seen.has(next)) continue;
        seen.add(next);
        const current = next as { code?: unknown; errno?: unknown; driverError?: unknown; cause?: unknown };
        if (current.code === code || current.errno === errno) return true;
        pending.push(current.driverError, current.cause);
    }
    return false;
}
