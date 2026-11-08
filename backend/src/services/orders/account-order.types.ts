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

export interface AccountOrderFailure {
  code: string;
  message: string;
}

export type AccountOrderResponse =
  | { data: ConfirmedAccountOrder }
  | { data: PendingAccountOrder }
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