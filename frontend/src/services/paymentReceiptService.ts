import api from './api'

export interface PaymentReceipt {
  id: string
  clienteId?: number
  cliente?: string
  pedidoId: number | null
  cuentaCorrienteId: number | null
  tipoMime: 'application/pdf' | 'image/jpeg' | 'image/png'
  bytes: number
  fecha: string
  estadoRevision: 'PENDIENTE' | 'REVISADO'
  revisadoEn: string | null
}

export interface ReceiptPage {
  items: PaymentReceipt[]
  paginaSiguiente: number | null
}

export const accountReceiptsPath = '/cuenta-corriente/comprobantes'
export const adminReceiptsPath = '/admin/comprobantes'
export const orderReceiptsPath = (orderId: number) => '/pedidos/' + orderId + '/comprobantes'

export async function listPaymentReceipts(path: string, pagina: number, signal: AbortSignal) {
  return (await api.get<{ data: ReceiptPage }>(path, { params: { pagina }, signal })).data.data
}

export async function uploadPaymentReceipt(path: string, file: File, signal: AbortSignal) {
  const response = await api.post(path, file, { headers: { 'Content-Type': file.type }, signal })
  return response.status === 201
}

export async function markPaymentReceiptReviewed(path: string, id: string, signal: AbortSignal) {
  await api.patch(path + '/' + id + '/revision', undefined, { signal })
}
