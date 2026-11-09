export type Coverage = 'COMPLETA' | 'PARCIAL' | 'NO_ACREDITADA'
export type Context = { corte: string; revision: string }
export type AccountState = 'HABILITADA' | 'INHABILITADA'
export type AccountSummary = {
  estado: AccountState; cuentaId: number; origen: 'REAL' | 'DEMO'; moneda: 'USD'
  plazoDias: 30 | 60 | null; saldo: string | null; limite: string | null
  utilizado: string | null; disponible: string | null
  deudaVencidaTotal: string | null; deudaVencida30Dias: string | null
  deudaVencida60Dias: string | null; deudaPorVencerTotal: string | null
  cobertura: Coverage; estadoCredito: 'BLOQUEADO' | 'DISPONIBLE' | 'NO_DETERMINABLE'
}
export type AdminAccount = AccountSummary & { clienteId: number }
export type AccountQuery = Context & ({ estado: 'SIN_CUENTA' } | AccountSummary)
export type AccountList = Context & { items: AdminAccount[]; siguienteCursor: string | null }
export type Movement = {
  id: string; fechaOperacion: string; concepto: string; importe: string
  saldoResultante: string | null; moneda: 'USD'; estado: 'VIGENTE' | 'ANULADO'
  origen: 'REAL' | 'DEMO'
} & (
  | { tipo: 'CARGO'; referencia: { pedidoId: number }; venceEl: string | null; plazoDias: 30 | 60 | null }
  | { tipo: 'ABONO'; referencia: { pagoId: number }; venceEl: null; plazoDias: null }
)
export type Due = {
  movimientoId: string; venceEl: string; plazoDias: 30 | 60 | null; moneda: 'USD'
  pendiente: string | null; estado: 'POR_VENCER' | 'VENCIDO' | 'NO_DETERMINABLE'; origen: 'REAL' | 'DEMO'
}
export type AccountDetail<T> = Context & ({ estado: 'SIN_CUENTA' } | {
  estado: AccountState; cobertura: Coverage; items: T[]; siguienteCursor: string | null
})
export type AccountFilters = { clienteId?: number; habilitada?: boolean; limite?: number; cursor?: string }
