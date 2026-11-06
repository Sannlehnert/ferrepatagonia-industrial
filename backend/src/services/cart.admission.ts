import { cartConflict } from './cart.errors';

type Pending = { userId: number; grant: () => void };

export class CartAdmission {
    private readonly active = new Set<number>();
    private readonly pending: Pending[] = [];

    constructor(private readonly limits: {
        active: number; pending: number; pendingPerUser: number; waitMs: number;
    }) {}

    async run<T>(userId: number, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
        await this.acquire(userId, signal);
        try {
            signal.throwIfAborted();
            return await work();
        } finally {
            // An active operation retains its permit through rollback/commit and connection release,
            // even if the HTTP client disconnects.
            this.active.delete(userId);
            this.drain();
        }
    }

    private acquire(userId: number, signal: AbortSignal): Promise<void> {
        signal.throwIfAborted();
        if (this.active.size < this.limits.active && !this.active.has(userId)) {
            this.active.add(userId);
            return Promise.resolve();
        }
        if (this.pending.length >= this.limits.pending
            || this.pending.filter(entry => entry.userId === userId).length >= this.limits.pendingPerUser) {
            return Promise.reject(cartConflict());
        }
        return new Promise<void>((resolve, reject) => {
            const deadline = performance.now() + this.limits.waitMs;
            const cleanup = () => {
                this.pending.splice(this.pending.indexOf(entry), 1);
                clearTimeout(timer);
                signal.removeEventListener('abort', abort);
            };
            const cancel = (error: unknown) => {
                cleanup();
                reject(error);
            };
            const abort = () => cancel(signal.reason);
            const entry: Pending = { userId, grant: () => {
                if (performance.now() >= deadline) {
                    cancel(cartConflict());
                    return;
                }
                cleanup();
                this.active.add(userId);
                resolve();
            } };
            const timer = setTimeout(() => cancel(cartConflict()), this.limits.waitMs);
            signal.addEventListener('abort', abort, { once: true });
            this.pending.push(entry);
        });
    }

    private drain(): void {
        while (this.active.size < this.limits.active) {
            const next = this.pending.find(entry => !this.active.has(entry.userId));
            if (!next) return;
            next.grant();
        }
    }
}

// Each process has its own five-connection TypeORM pool. Leave two connections
// outside cart transactions for Passport and other endpoints.
export const cartAdmission = new CartAdmission({ active: 3, pending: 12, pendingPerUser: 2, waitMs: 750 });
