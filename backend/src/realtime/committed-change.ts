import type { IncomingMessage } from 'node:http';
import type { ConfirmedAccountOrder } from '../services/orders/account-order.types';

export type CommittedChange =
  | { kind: 'cart'; clientId: number }
  | { kind: 'stock'; productIds: readonly number[] }
  | {
    kind: 'order';
    clientId: number;
    order: Pick<ConfirmedAccountOrder, 'pedidoId' | 'estado'>;
    productIds: readonly number[];
  };

export type NotifyCommittedChange = (change: CommittedChange) => void;

export interface RealtimeRequest extends IncomingMessage {
  notifyCommittedChange?: NotifyCommittedChange;
}

export function notifyAfterCommit(notify: NotifyCommittedChange | undefined, change: CommittedChange) {
  try { notify?.(change); }
  catch { console.error('No se pudo programar una notificación de cambio confirmado.'); }
}
