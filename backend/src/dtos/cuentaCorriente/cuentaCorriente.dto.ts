export type Decimal = string;
export type InstanteUTC = string;
export type FechaCivil = string;
export type Moneda = 'USD';
export type Cobertura = 'COMPLETA' | 'PARCIAL' | 'NO_ACREDITADA';

export interface Contexto {
    corte: InstanteUTC;
    revision: string;
}

export interface SinCuenta {
    estado: 'SIN_CUENTA';
}

export interface Resumen {
    estado: 'HABILITADA' | 'INHABILITADA';
    cuentaId: number;
    origen: 'REAL' | 'DEMO';
    moneda: Moneda;
    plazoDias: 30 | 60 | null;
    saldo: Decimal | null;
    limite: Decimal | null;
    utilizado: Decimal | null;
    disponible: Decimal | null;
    deudaVencidaTotal: Decimal | null;
    deudaVencida30Dias: Decimal | null;
    deudaVencida60Dias: Decimal | null;
    deudaPorVencerTotal: Decimal | null;
    cobertura: Cobertura;
    estadoCredito: 'BLOQUEADO' | 'DISPONIBLE' | 'NO_DETERMINABLE';
}

export type Consulta = Contexto & (SinCuenta | Resumen);

export type Movimiento = {
    id: string;
    fechaOperacion: InstanteUTC;
    concepto: string;
    importe: Decimal;
    saldoResultante: Decimal | null;
    moneda: Moneda;
    estado: 'VIGENTE' | 'ANULADO';
    venceEl: FechaCivil | null;
    origen: 'REAL' | 'DEMO';
} & (
    | { tipo: 'CARGO'; referencia: { pedidoId: number }; plazoDias: 30 | 60 | null }
    | { tipo: 'ABONO'; referencia: { pagoId: number }; venceEl: null; plazoDias: null }
);

export interface Vencimiento {
    movimientoId: string;
    venceEl: FechaCivil;
    plazoDias: 30 | 60 | null;
    moneda: Moneda;
    pendiente: Decimal | null;
    estado: 'POR_VENCER' | 'VENCIDO' | 'NO_DETERMINABLE';
    origen: 'REAL' | 'DEMO';
}

export type Pagina<T> = Contexto & { items: T[]; siguienteCursor: string | null };

export type ResumenAdmin = Resumen & { clienteId: number };
export type ListadoAdmin = Pagina<ResumenAdmin>;

export interface AdminCursorPayload extends Contexto {
    version: 1;
    userId: number;
    rol: 'ADMIN';
    scope: 'listado' | 'movimientos' | 'vencimientos';
    filtros: { clienteId?: number; habilitada?: boolean };
    cuentaId: number | null;
    exp: number;
    ultimaClave: { id: number; fecha?: string };
}

export type Detalle<T> = Contexto & (
    | SinCuenta
    | {
        estado: 'HABILITADA' | 'INHABILITADA';
        cobertura: Cobertura;
        items: T[];
        siguienteCursor: string | null;
    }
);

export interface CursorClaveMovimiento {
    fechaEfectiva: InstanteUTC;
    fechaOperacion: InstanteUTC;
    id: number;
}

export interface CursorClaveVencimiento {
    fechaCivil: FechaCivil;
    venceEl: FechaCivil;
    id: number;
    movimientoId: number;
}

export interface CursorPayload {
    userId: number;
    rol: 'CLIENTE';
    cuentaId: number;
    scope: 'movimientos' | 'vencimientos';
    filtros: Record<string, never>;
    corte: InstanteUTC;
    revision: string;
    exp: number;
    ultimaClave: CursorClaveMovimiento | CursorClaveVencimiento;
}
