import { cartConflict } from './cart.errors';

type Pending = {
  userId: number;
  grant: () => void;
};

export class CartAdmission {
  private occupied = 0;
  private readonly activeUsers = new Set<number>();
  private readonly pending: Pending[] = [];

  constructor(private readonly limits: {
    active: number;
    pending: number;
    pendingPerUser: number;
    waitMs: number;
  }) {}

  async run<A extends { id: number }, T>(
    signal: AbortSignal,
    identify: () => Promise<A | undefined>,
    work: (identity: A) => Promise<T>,
    options: { serializePerUser?: boolean } = {},
  ): Promise<T | undefined> {
    signal.throwIfAborted();

    if (this.occupied >= this.limits.active) {
      throw cartConflict();
    }

    this.occupied++;
    let ownsSlot = true;

    try {
      const identity = await identify();
      signal.throwIfAborted();

      if (!identity) return;

      // Las consultas comparten el límite global, pero pueden leer
      // mientras una operación del mismo usuario sigue en curso.
      if (options.serializePerUser === false) {
        return await work(identity);
      }

      const userId = identity.id;

      if (this.activeUsers.has(userId)) {
        // Passport ya liberó su conexión. Esperamos sin ocupar un cupo SQL.
        const waiting = this.enqueue(userId, signal);
        ownsSlot = false;
        this.release();

        await waiting;
        ownsSlot = true;
      } else {
        this.activeUsers.add(userId);
      }

      try {
        signal.throwIfAborted();
        return await work(identity);
      } finally {
        this.activeUsers.delete(userId);
      }
    } finally {
      // Conservamos el cupo hasta terminar y liberar las conexiones,
      // aunque el navegador se haya desconectado.
      if (ownsSlot) {
        this.release();
      }
    }
  }

  private enqueue(
    userId: number,
    signal: AbortSignal,
  ): Promise<void> {
    const pendingForUser = this.pending.filter(
      entry => entry.userId === userId,
    ).length;

    if (this.pending.length >= this.limits.pending ||
      pendingForUser >= this.limits.pendingPerUser) {
      throw cartConflict();
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

      const entry: Pending = {
        userId,
        grant: () => {
          if (performance.now() >= deadline) {
            cancel(cartConflict());
            return;
          }

          cleanup();
          this.occupied++;
          this.activeUsers.add(userId);
          resolve();
        },
      };

      const timer = setTimeout(
        () => cancel(cartConflict()),
        this.limits.waitMs,
      );

      signal.addEventListener('abort', abort, { once: true });
      this.pending.push(entry);
    });
  }

  private release(): void {
    this.occupied--;

    while (this.occupied < this.limits.active) {
      const next = this.pending.find(
        entry => !this.activeUsers.has(entry.userId),
      );

      if (!next) return;

      next.grant();
    }
  }
}

// Passport y las operaciones comparten tres conexiones del pool de cinco.
export const cartAdmission = new CartAdmission({
  active: 3,
  pending: 12,
  pendingPerUser: 2,
  waitMs: 750,
});