import { AccountOrderError } from './account-order.errors';

type Waiter = () => void;

export class OrderHistoryAdmission {
  private active = 0;
  private readonly queue: Waiter[] = [];

  constructor(private readonly limit: number, private readonly queued: number, private readonly waitMs: number) {}

  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (this.active < this.limit) {
      this.active++;
    } else {
      await this.wait(signal);
    }

    try {
      signal.throwIfAborted();
      return await work();
    } finally {
      const next = this.queue[0];
      if (next) next();
      else this.active--;
    }
  }

  private wait(signal: AbortSignal): Promise<void> {
    const busy = () => new AccountOrderError(
      'CONSULTA_PEDIDOS_OCUPADA', 503, 'El historial está ocupado. Reintentá en unos instantes.',
    );
    if (this.queue.length >= this.queued) throw busy();

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.queue.splice(this.queue.indexOf(grant), 1);
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
      };
      const grant = () => { cleanup(); resolve(); };
      const cancel = () => { cleanup(); reject(signal.reason); };
      const timer = setTimeout(() => { cleanup(); reject(busy()); }, this.waitMs);
      signal.addEventListener('abort', cancel, { once: true });
      this.queue.push(grant);
    });
  }
}

// Cada lectura usa una conexión a la vez, incluida la autenticación.
export const orderHistoryAdmission = new OrderHistoryAdmission(2, 8, 750);
