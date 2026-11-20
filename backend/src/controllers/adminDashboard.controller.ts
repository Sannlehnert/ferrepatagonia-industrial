import type { Request, Response } from 'express';
import {
  AdminDashboardError,
  assertEmptyDashboardQuery,
} from '../dtos/dashboard/admin-dashboard.dto';
import { getAdminDashboardMetricsService } from '../services/dashboard/admin-dashboard.service';

export async function getAdminDashboardMetrics(req: Request, res: Response) {
  try {
    assertEmptyDashboardQuery(req.query as Record<string, unknown>);

    const userId = req.auth?.id;
    if (!userId || !Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({
        message: 'No autenticado.',
        code: 'NO_AUTENTICADO',
      });
    }

    const data = await getAdminDashboardMetricsService(userId);
    return res.status(200).json({ data });
  } catch (error) {
    if (error instanceof AdminDashboardError) {
      return res.status(error.status).json({
        message: error.message,
        code: error.code,
      });
    }
    return res.status(500).json({
      message: 'No se pudieron calcular las métricas operativas del dashboard.',
    });
  }
}