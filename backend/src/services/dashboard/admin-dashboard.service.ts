import { inTransaction } from '../../config/database.config';
import {
  AdminDashboardError,
  LOW_STOCK_THRESHOLD,
  type AdminDashboardMetricsResponse,
} from '../../dtos/dashboard/admin-dashboard.dto';
import { findAccountReader } from '../../repositories/adminAccount.repository';
import { queryAdminDashboardAggregates } from '../../repositories/adminDashboard.repository';

export async function getAdminDashboardMetricsService(
  userId: number,
): Promise<AdminDashboardMetricsResponse> {
  return inTransaction(
    async manager => {
      const reader = await findAccountReader(manager, userId);
      if (!reader?.activo) {
        throw new AdminDashboardError('NO_AUTENTICADO', 401, 'No autenticado.');
      }
      if (reader.rol !== 'ADMIN') {
        throw new AdminDashboardError(
          'SIN_PERMISO',
          403,
          'No tenés permiso para consultar las métricas operativas.',
        );
      }

      const corte = new Date().toISOString();
      const aggregates = await queryAdminDashboardAggregates(manager, LOW_STOCK_THRESHOLD);

      return {
        corte,
        origenDatos: 'REAL',
        umbralStockBajo: LOW_STOCK_THRESHOLD,
        pedidosPorEstado: aggregates.pedidosPorEstado,
        indicadores: {
          pedidosNuevos: aggregates.pedidosPorEstado.CONFIRMADO,
          pedidosEnCurso:
            aggregates.pedidosPorEstado.EN_PREPARACION + aggregates.pedidosPorEstado.ENVIADO,
          pedidosCuentaCorriente: aggregates.pedidosCuentaCorriente,
          comprobantesTotales: aggregates.comprobantesTotales,
          comprobantesSinRevisar: aggregates.comprobantesSinRevisar,
          alertasStockBajo: aggregates.alertasStockBajo,
          productosSinStock: aggregates.productosSinStock,
          empresasFieles: aggregates.empresasFieles,
        },
      };
    },
    { isolation: 'REPEATABLE READ' },
  );
}