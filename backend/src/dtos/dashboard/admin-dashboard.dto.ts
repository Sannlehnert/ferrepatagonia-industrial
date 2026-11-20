import type { AdminOrderOperationalStatus } from '../orders/admin-order.dto';

export const LOW_STOCK_THRESHOLD = 5;

export interface AdminDashboardOrdersByStatus {
  CONFIRMADO: number;
  EN_PREPARACION: number;
  ENVIADO: number;
  ENTREGADO: number;
  totalOperativos: number;
}

export interface AdminDashboardMetricsResponse {
  corte: string;
  origenDatos: 'REAL';
  umbralStockBajo: number;
  pedidosPorEstado: AdminDashboardOrdersByStatus;
  indicadores: {
    pedidosNuevos: number;
    pedidosEnCurso: number;
    pedidosCuentaCorriente: number;
    comprobantesTotales: number;
    comprobantesSinRevisar: number;
    alertasStockBajo: number;
    productosSinStock: number;
    empresasFieles: number;
  };
}

export class AdminDashboardError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'AdminDashboardError';
    this.code = code;
    this.status = status;
  }
}

export function assertEmptyDashboardQuery(query: Record<string, unknown>): void {
  const keys = Object.keys(query);
  if (keys.length > 0) {
    throw new AdminDashboardError(
      'PARAMETRO_NO_PERMITIDO',
      400,
      'El endpoint de métricas del dashboard no admite parámetros de consulta.',
    );
  }
}

export type DashboardOperationalState = AdminOrderOperationalStatus;