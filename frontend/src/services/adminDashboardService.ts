import api from './api'
import type { AdminDashboardMetrics } from '@/types/adminDashboard'

export async function getAdminDashboardMetrics(
  signal?: AbortSignal,
): Promise<AdminDashboardMetrics> {
  const response = await api.get<{ data: AdminDashboardMetrics }>(
    '/admin/dashboard/metricas',
    { signal },
  )
  return response.data.data
}