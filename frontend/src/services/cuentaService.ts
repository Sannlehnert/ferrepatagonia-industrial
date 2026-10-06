import type { Cliente } from '@/types/cuenta'
import { clienteMock } from '@/mocks/cuenta'

const USE_MOCKS = true // pasar a false cuando el backend esté listo
const delay = (ms = 300) => new Promise<void>((r) => setTimeout(r, ms))

export async function getCliente(): Promise<Cliente> {
  if (USE_MOCKS) {
    await delay()
    return clienteMock
  }
  // Cuando exista el backend:
  // const { data } = await api.get<Cliente>('/cliente/me')
  // return data
  throw new Error('Backend no conectado todavía')
}