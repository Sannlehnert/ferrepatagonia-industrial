export type DecimalUSD = string
export type CuentaCorrienteCoverage = 'COMPLETA' | 'PARCIAL' | 'NO_ACREDITADA'
export type CuentaCorrienteOrigin = 'REAL' | 'DEMO'

export interface CuentaCorrienteContext {
    corte: string
    revision: string
}

export interface CuentaCorrienteNoExiste {
    estado: 'SIN_CUENTA'
}

export interface CuentaCorrienteResumen {
    estado: 'HABILITADA' | 'INHABILITADA'
    cuentaId: number
    origen: CuentaCorrienteOrigin
    moneda: 'USD'
    plazoDias: 30 | 60 | null
    saldo: DecimalUSD | null
    limite: DecimalUSD | null
    utilizado: DecimalUSD | null
    disponible: DecimalUSD | null
    deudaVencidaTotal: DecimalUSD | null
    deudaVencida30Dias: DecimalUSD | null
    deudaVencida60Dias: DecimalUSD | null
    deudaPorVencerTotal: DecimalUSD | null
    cobertura: CuentaCorrienteCoverage
    estadoCredito: 'BLOQUEADO' | 'DISPONIBLE' | 'NO_DETERMINABLE'
}

export type CuentaCorrienteConsulta = CuentaCorrienteContext &
    (CuentaCorrienteNoExiste | CuentaCorrienteResumen)

export interface CuentaCorrienteMovimiento {
    id: string
    fechaOperacion: string
    concepto: string
    importe: DecimalUSD
    saldoResultante: DecimalUSD | null
    moneda: 'USD'
    tipo: 'CARGO' | 'ABONO'
    estado: 'VIGENTE' | 'ANULADO'
    venceEl: string | null
    plazoDias: 30 | 60 | null
    origen: CuentaCorrienteOrigin
    referencia: { pedidoId: number } | { pagoId: number }
}

export interface CuentaCorrienteVencimiento {
    movimientoId: string
    venceEl: string
    plazoDias: 30 | 60 | null
    moneda: 'USD'
    pendiente: DecimalUSD | null
    estado: 'POR_VENCER' | 'VENCIDO' | 'NO_DETERMINABLE'
    origen: CuentaCorrienteOrigin
}

export type CuentaCorrienteDetalle<T> = CuentaCorrienteContext & (
    | CuentaCorrienteNoExiste
    | {
        estado: 'HABILITADA' | 'INHABILITADA'
        cobertura: CuentaCorrienteCoverage
        items: T[]
        siguienteCursor: string | null
    }
)

export type CuentaCorrientePaginaMovimientos = CuentaCorrienteDetalle<CuentaCorrienteMovimiento>
export type CuentaCorrientePaginaVencimientos = CuentaCorrienteDetalle<CuentaCorrienteVencimiento>
