import type {
  OrderDocumentState,
  OrderFinancialState,
} from './order-state-projection';

export interface ConfirmedAccountOrder {
  simulado?: true;
  pedidoId: number;
  estado: 'CONFIRMADO';
  modalidadPago: 'CUENTA_CORRIENTE';
  moneda: 'USD';
  totalUSD: string;
  cargoId: string;
  venceEl: string;
}

export interface ConfirmedTransferOrder {
  simulado?: true;
  pedidoId: number;
  estado: 'CONFIRMADO';
  modalidadPago: 'TRANSFERENCIA';
  moneda: 'USD';
  totalUSD: string;
}

export interface PendingAccountOrder {
  estado: 'PENDIENTE';
  code: 'CONFIRMACION_PENDIENTE';
  message: string;
}

export type PendingTransferOrder = PendingAccountOrder;

export interface ClientOrderSummary {
  simulado?: true;
  pedidoId: number;
  numero: string;
  fecha: string;
  estado: string;
  estadoPedido: string;
  estadoDocumental: OrderDocumentState;
  estadoFinanciero: OrderFinancialState;
  montoAcreditadoUSD: string | null;
  modalidadPago: string;
  moneda: string | null;
  subtotal: string;
  descuento: string;
  total: string;
  totalUSD: string | null;
  observaciones: string | null;
  cantidadLineas: number;
  cantidadUnidades: number;
  cargoId: string | null;
  venceEl: string | null;
}

export interface ClientOrderLine {
  detalleId: number;
  productoId: number;
  codigo: string;
  nombre: string;
  cantidad: number;
  precioUnitario: string;
  descuento: string;
  subtotal: string;
}

export interface ClientOrderDetail extends ClientOrderSummary {
  items: ClientOrderLine[];
}

export interface AccountOrderFailure {
  code: string;
  message: string;
  estado?: 'RECHAZADO';
}

export type TransferOrderFailure = AccountOrderFailure;

export type AccountOrderResponse =
  | { data: ConfirmedAccountOrder }
  | { data: ConfirmedTransferOrder }
  | { data: PendingAccountOrder }
  | { data: { items: ClientOrderSummary[] } }
  | { data: ClientOrderDetail }
  | AccountOrderFailure;

export type TransferOrderResponse =
  | { data: ConfirmedTransferOrder }
  | { data: PendingTransferOrder }
  | TransferOrderFailure;

export type AccountOrderHttpStatus =
  | 200
  | 201
  | 202
  | 400
  | 401
  | 403
  | 404
  | 409
  | 422
  | 503;

export interface AccountOrderResult {
  status: AccountOrderHttpStatus;
  body: AccountOrderResponse;
}

export interface TransferOrderResult {
  status: AccountOrderHttpStatus;
  body: TransferOrderResponse;
}

export interface AccountOrderEligibility {
  simulado?: true;
  elegible: boolean;
  moneda: 'USD';
  totalUSD: string | null;
  creditoDisponibleUSD: string | null;
  codigo: string | null;
  mensaje: string | null;
  cotizacion: string | null;
}

export interface AccountOrderEligibilityResult {
  status: 200;
  body: { data: AccountOrderEligibility };
}

export interface TransferOrderEligibility {
  simulado?: true;
  elegible: boolean;
  modalidadPago: 'TRANSFERENCIA';
  moneda: 'USD';
  totalUSD: string | null;
  codigo: string | null;
  mensaje: string | null;
  cotizacion: string | null;
}

export interface TransferOrderEligibilityResult {
  status: 200;
  body: { data: TransferOrderEligibility };
}
