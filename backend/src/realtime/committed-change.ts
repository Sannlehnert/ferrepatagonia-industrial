import type { IncomingMessage } from 'node:http';
import type { ConfirmedAccountOrder } from '../services/orders/account-order.types';

export type CommittedChange =
  | { kind: 'cart'; clientId: number }
  | { kind: 'stock'; productIds: readonly number[] }
  | {
    kind: 'order';
    clientId: number;
    order: Pick<ConfirmedAccountOrder, 'pedidoId' | 'estado'> & {
      modalidadPago?: 'CUENTA_CORRIENTE' | 'TRANSFERENCIA';
    };
    productIds: readonly number[];
  }
  | {
    kind: 'orderStatus';
    clientId: number;
    order: {
      pedidoId: number;
      estadoAnterior: string;
      estadoNuevo: string;
      actualizadoEn: string;
    };
  }
  | {
    kind: 'receipt';
    clientId: number;
    receipt: {
      comprobanteId: string;
      pedidoId: number | null;
      cuentaCorrienteId: number | null;
      estadoDocumental: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';
      actualizadoEn: string;
    };
  }
  | {
    kind: 'payment';
    clientId: number;
    payment: {
      pagoId: number;
      pedidoId: number | null;
      cuentaCorrienteId: number | null;
      estadoPago: 'ACREDITADO' | 'ANULADO';
      montoUSD: string;
      revisionCuenta: string | null;
      actualizadoEn: string;
    };
  };

export type NotifyCommittedChange = (change: CommittedChange) => void;

export interface RealtimeRequest extends IncomingMessage {
  notifyCommittedChange?: NotifyCommittedChange;
}

export function notifyAfterCommit(notify: NotifyCommittedChange | undefined, change: CommittedChange) {
  try { notify?.(change); }
  catch { console.error('No se pudo programar una notificación de cambio confirmado.'); }
}
