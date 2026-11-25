import api from './api'
import {
  decodeAdminCreditCompany,
  decodeAdminCreditCompanyPage,
  decodeAdminCreditEventPage,
} from './adminCreditCompanyDto'
import type {
  AdminCreditCompany,
  AdminCreditCompanyFilters,
  AdminCreditCompanyPage,
  AdminCreditEventPage,
} from '@/types/adminCreditCompany'

export async function listAdminCreditCompanies(
  filters: AdminCreditCompanyFilters = {},
  signal?: AbortSignal,
): Promise<AdminCreditCompanyPage> {
  const params: Record<string, string | number> = {
    page: filters.page ?? 1,
    limit: filters.limit ?? 20,
  }
  if (filters.busqueda) params.busqueda = filters.busqueda
  if (filters.estadoEmpresa) params.estadoEmpresa = filters.estadoEmpresa
  if (filters.estadoSolicitud) params.estadoSolicitud = filters.estadoSolicitud
  if (filters.cuenta) params.cuenta = filters.cuenta

  const response = await api.get('/admin/credito/empresas', { params, signal })
  return decodeAdminCreditCompanyPage(response.data)
}

export async function getAdminCreditCompany(
  clienteId: number,
  signal?: AbortSignal,
): Promise<AdminCreditCompany> {
  const response = await api.get(`/admin/credito/empresas/${clienteId}`, { signal })
  return decodeAdminCreditCompany(response.data)
}

export async function listAdminCreditEvents(
  params: { clienteId?: number; solicitudId?: number; tipo?: string; limite?: number; antesDeId?: number } = {},
  signal?: AbortSignal,
): Promise<AdminCreditEventPage> {
  const response = await api.get('/admin/credito/eventos', { params, signal })
  return decodeAdminCreditEventPage(response.data)
}
