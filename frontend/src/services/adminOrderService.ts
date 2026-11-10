import api from './api'
import type {
  AdminOrderDetail,
  AdminOrderListResponse,
  AdminOrderOperationalStatus,
  AdminOrderQueryFilters,
} from '@/types/adminOrder'

const STATUS_LABELS: Readonly<Record<string, string>> = {
  CONFIRMADO: 'Confirmado',
  EN_PREPARACION: 'En preparación',
  ENVIADO: 'Enviado',
  ENTREGADO: 'Entregado',
  DEMO_REGISTRADO: 'Registrado (DEMO)',
}

const PAYMENT_MODE_LABELS: Readonly<Record<string, string>> = {
  CUENTA_CORRIENTE: 'Cuenta corriente',
  DEMO_DIRECTO: 'Pago directo (DEMO)',
  DEMO_CUENTA_CORRIENTE: 'Cuenta corriente (DEMO)',
}

export function formatAdminOrderStatus(status: string): string {
  return STATUS_LABELS[status] ?? status
}

export function formatAdminOrderPaymentMode(mode: string): string {
  return PAYMENT_MODE_LABELS[mode] ?? mode
}

export function formatAdminOrderMoney(amount: string, currency = 'USD'): string {
  return `${currency} ${amount}`
}

export async function getAdminOrders(
  filters: AdminOrderQueryFilters = {},
  signal?: AbortSignal,
): Promise<AdminOrderListResponse> {
  const params: Record<string, string | number> = {}

  if (filters.page !== undefined) params.page = filters.page
  if (filters.limit !== undefined) params.limit = filters.limit
  if (filters.estado) params.estado = filters.estado
  if (filters.modalidadPago) params.modalidadPago = filters.modalidadPago
  if (filters.clienteId !== undefined) params.clienteId = filters.clienteId
  if (filters.q) params.q = filters.q

  const response = await api.get<{ data: AdminOrderListResponse }>(
    '/admin/pedidos',
    { params, signal },
  )
  return response.data.data
}

export async function getAdminOrderDetail(
  orderId: number,
  signal?: AbortSignal,
): Promise<AdminOrderDetail> {
  const response = await api.get<{ data: AdminOrderDetail }>(
    `/admin/pedidos/${orderId}`,
    { signal },
  )
  return response.data.data
}

export async function updateAdminOrderStatus(
  orderId: number,
  estado: AdminOrderOperationalStatus,
): Promise<AdminOrderDetail> {
  const response = await api.patch<{ message: string; data: AdminOrderDetail }>(
    `/admin/pedidos/${orderId}/estado`,
    { estado },
  )
  return response.data.data
}