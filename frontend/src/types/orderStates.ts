export type OrderCommercialState =
  | 'CONFIRMADO'
  | 'EN_PREPARACION'
  | 'ENVIADO'
  | 'ENTREGADO'
  | 'DEMO_REGISTRADO'

export type OrderDocumentState =
  | 'SIN_COMPROBANTE'
  | 'PENDIENTE'
  | 'APROBADO'
  | 'RECHAZADO'

export type TransferOrderFinancialState =
  | 'SIN_PAGO_ACREDITADO'
  | 'PAGO_PARCIAL'
  | 'ACREDITADO'
  | 'NO_DETERMINABLE'

export type AccountOrderFinancialState =
  | 'CARGO_PENDIENTE'
  | 'IMPUTADO_PARCIAL'
  | 'CANCELADO_EN_CC'
  | 'CARGO_ANULADO'
  | 'NO_DETERMINABLE'

export type OrderFinancialState =
  | TransferOrderFinancialState
  | AccountOrderFinancialState

export interface OrderStateBadgeMeta {
  label: string
  badgeClasses: string
  dotClasses: string
}
