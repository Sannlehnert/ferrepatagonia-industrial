import api from '@/services/api'
import type { Cliente, Pedido } from '@/types/cuenta'
import { clienteMock, pedidosMock } from '@/mocks/cuenta'

const USE_MOCKS = false

const delay = (ms = 300) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function getCliente(): Promise<Cliente> {
  if (USE_MOCKS) {
    await delay()
    return clienteMock
  }
  const { data } = await api.get<Cliente>('/cliente/me')
  return data
}

export async function getPedidos(): Promise<Pedido[]> {
  if (USE_MOCKS) {
    await delay()
    return pedidosMock
  }
  const { data } = await api.get<Pedido[]>('/pedidos')
  return data
}