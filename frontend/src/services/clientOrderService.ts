import api from '@/services/api'
import type { ClientOrderDetail, ClientOrderSummary } from '@/types/clientOrder'

export async function listClientOrders(signal?: AbortSignal): Promise<ClientOrderSummary[]> {
  const response = await api.get<{ data: { items: ClientOrderSummary[] } }>(
    '/pedidos',
    { signal },
  )

  return response.data.data.items
}

export async function getClientOrderDetail(
  orderId: number,
  signal?: AbortSignal,
): Promise<ClientOrderDetail> {
  const response = await api.get<{ data: ClientOrderDetail }>(
    `/pedidos/${orderId}`,
    { signal },
  )

  return response.data.data
}