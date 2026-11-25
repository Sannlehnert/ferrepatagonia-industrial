const DECIMAL_AMOUNT_PATTERN = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

function toCents(value: string): bigint {
  const trimmed = value.trim();
  const match = DECIMAL_AMOUNT_PATTERN.exec(trimmed);
  if (!match) {
    throw new Error(`Importe decimal inválido: ${value}`);
  }
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -cents : cents;
}

function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

export type OrderDocumentState =
  | 'SIN_COMPROBANTE'
  | 'PENDIENTE'
  | 'APROBADO'
  | 'RECHAZADO';

export type TransferOrderFinancialState =
  | 'SIN_PAGO_ACREDITADO'
  | 'PAGO_PARCIAL'
  | 'ACREDITADO'
  | 'NO_DETERMINABLE';

export type AccountOrderFinancialState =
  | 'CARGO_PENDIENTE'
  | 'IMPUTADO_PARCIAL'
  | 'CANCELADO_EN_CC'
  | 'CARGO_ANULADO'
  | 'NO_DETERMINABLE';

export type OrderFinancialState =
  | TransferOrderFinancialState
  | AccountOrderFinancialState;

export interface OrderDocumentCounts {
  total: number;
  aprobados: number;
  pendientes: number;
  rechazados: number;
}

export interface OrderFinancialProjectionInput {
  modalidadPago: string;
  monedaTotal: string | null;
  total: string | number;
  pagosAcreditadosSinUsd?: number;
  totalAcreditadoUsd?: string | number | null;
  cuentaCobertura?: string | null;
  cargoEstado?: string | null;
  cargoMonto?: string | number | null;
  montoImputadoVigente?: string | number | null;
}

export interface OrderStateProjection {
  estadoPedido: string;
  estadoDocumental: OrderDocumentState;
  estadoFinanciero: OrderFinancialState;
  montoAcreditadoUSD: string | null;
}

function safeCents(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  try {
    return toCents(String(value));
  } catch {
    return null;
  }
}

export function deriveOrderDocumentState(counts: OrderDocumentCounts): OrderDocumentState {
  if (counts.aprobados > 0) return 'APROBADO';
  if (counts.pendientes > 0) return 'PENDIENTE';
  if (counts.total > 0) return 'RECHAZADO';
  return 'SIN_COMPROBANTE';
}

export function deriveOrderFinancialState(
  input: OrderFinancialProjectionInput,
): { estadoFinanciero: OrderFinancialState; montoAcreditadoUSD: string | null } {
  if (input.modalidadPago === 'TRANSFERENCIA') {
    if (input.monedaTotal !== 'USD' || Number(input.pagosAcreditadosSinUsd ?? 0) > 0) {
      return { estadoFinanciero: 'NO_DETERMINABLE', montoAcreditadoUSD: null };
    }

    const orderTotal = safeCents(input.total);
    const accredited = safeCents(input.totalAcreditadoUsd ?? '0.00');
    if (orderTotal === null || orderTotal < 0n || accredited === null || accredited < 0n) {
      return { estadoFinanciero: 'NO_DETERMINABLE', montoAcreditadoUSD: null };
    }

    if (accredited === 0n) {
      return { estadoFinanciero: 'SIN_PAGO_ACREDITADO', montoAcreditadoUSD: '0.00' };
    }
    if (accredited < orderTotal) {
      return { estadoFinanciero: 'PAGO_PARCIAL', montoAcreditadoUSD: fromCents(accredited) };
    }
    return { estadoFinanciero: 'ACREDITADO', montoAcreditadoUSD: fromCents(accredited) };
  }

  if (input.modalidadPago === 'CUENTA_CORRIENTE') {
    if (input.cuentaCobertura !== 'COMPLETA' || !input.cargoEstado) {
      return { estadoFinanciero: 'NO_DETERMINABLE', montoAcreditadoUSD: null };
    }

    if (input.cargoEstado === 'ANULADO') {
      return { estadoFinanciero: 'CARGO_ANULADO', montoAcreditadoUSD: '0.00' };
    }

    if (input.cargoEstado !== 'ACREDITADO') {
      return { estadoFinanciero: 'NO_DETERMINABLE', montoAcreditadoUSD: null };
    }

    const cargoTotal = safeCents(input.cargoMonto);
    const allocated = safeCents(input.montoImputadoVigente ?? '0.00');
    if (cargoTotal === null || cargoTotal <= 0n || allocated === null || allocated < 0n) {
      return { estadoFinanciero: 'NO_DETERMINABLE', montoAcreditadoUSD: null };
    }

    if (allocated === 0n) {
      return { estadoFinanciero: 'CARGO_PENDIENTE', montoAcreditadoUSD: '0.00' };
    }
    if (allocated < cargoTotal) {
      return { estadoFinanciero: 'IMPUTADO_PARCIAL', montoAcreditadoUSD: fromCents(allocated) };
    }
    return { estadoFinanciero: 'CANCELADO_EN_CC', montoAcreditadoUSD: fromCents(allocated) };
  }

  return { estadoFinanciero: 'NO_DETERMINABLE', montoAcreditadoUSD: null };
}

export function projectOrderStates(
  estadoPedido: string,
  documents: OrderDocumentCounts,
  financial: OrderFinancialProjectionInput,
): OrderStateProjection {
  const estadoDocumental = deriveOrderDocumentState(documents);
  const { estadoFinanciero, montoAcreditadoUSD } = deriveOrderFinancialState(financial);
  return {
    estadoPedido,
    estadoDocumental,
    estadoFinanciero,
    montoAcreditadoUSD,
  };
}
