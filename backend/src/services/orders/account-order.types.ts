export interface ConfirmedAccountOrder {
  pedidoId: number;
  estado: 'CONFIRMADO';
  modalidadPago: 'CUENTA_CORRIENTE';
  moneda: 'USD';
  totalUSD: string;
  cargoId: string;
  venceEl: string;
}

export interface PendingAccountOrder {
  estado: 'PENDIENTE';
  code: 'CONFIRMACION_PENDIENTE';
  message: string;
}

export interface ClientOrderSummary {
  pedidoId: number;
  numero: string;
  fecha: string;
  estado: string;
  modalidadPago: string;
  moneda: string;
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

export type AccountOrderResponse =
  | { data: ConfirmedAccountOrder }
  | { data: PendingAccountOrder }
  | { data: { items: ClientOrderSummary[] } }
  | { data: ClientOrderDetail }
  | AccountOrderFailure;

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

export interface AccountOrderEligibility {
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
