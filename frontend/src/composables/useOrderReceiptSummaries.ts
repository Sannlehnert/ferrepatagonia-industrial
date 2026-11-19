import { watch } from 'vue'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import {
  listPaymentReceipts, orderReceiptsPath, supportsOrderReceipts,
} from '@/services/paymentReceiptService'
import { useAuthStore } from '@/stores/auth'
import type { ClientOrderSummary } from '@/types/clientOrder'

export type OrderReceiptStatus =
  | 'NO_ADJUNTO' | 'PENDIENTE' | 'REVISADO' | 'NO_DISPONIBLE' | 'CARGANDO' | 'ERROR'

async function readSummary(orderId: number, signal: AbortSignal): Promise<OrderReceiptStatus> {
  let page: number | null = 1
  let hasReceipts = false

  while (page !== null) {
    signal.throwIfAborted()
    const result = await listPaymentReceipts(orderReceiptsPath(orderId), page, signal)
    if (result.items.some(receipt => receipt.estadoRevision === 'PENDIENTE')) return 'PENDIENTE'
    hasReceipts ||= result.items.length > 0
    if (result.paginaSiguiente !== null && result.paginaSiguiente <= page) {
      throw new Error('La paginación de comprobantes no avanzó.')
    }
    page = result.paginaSiguiente
  }

  return hasReceipts ? 'REVISADO' : 'NO_ADJUNTO'
}

export function useOrderReceiptSummaries(orders: () => ClientOrderSummary[] | null) {
  const auth = useAuthStore()
  const identity = () => `${auth.user?.id}:${auth.rol}:${auth.sessionVersion}`
  const allowed = () => auth.rol === 'CLIENTE' && !auth.loggingIn && !auth.loggingOut
  const query = usePrivateAccountRead<Record<number, OrderReceiptStatus>>(identity, allowed)

  function available(order: ClientOrderSummary) {
    return supportsOrderReceipts(auth.user?.tipo_cliente, order.modalidadPago)
  }

  function refresh() {
    const currentOrders = orders()
    if (!currentOrders) {
      query.reset()
      return
    }
    const eligible = currentOrders.filter(available)

    return query.load(async signal => {
      const result: Record<number, OrderReceiptStatus> = {}
      let nextIndex = 0

      // Dos lecturas como máximo para conservar conexiones para las operaciones de compra.
      async function readNext() {
        while (nextIndex < eligible.length) {
          const order = eligible[nextIndex++]!
          signal.throwIfAborted()
          try {
            result[order.pedidoId] = await readSummary(order.pedidoId, signal)
          } catch (cause) {
            if (signal.aborted) throw cause
            result[order.pedidoId] = 'ERROR'
          }
        }
      }

      await Promise.all([readNext(), readNext()])
      return result
    })
  }

  function status(order: ClientOrderSummary): OrderReceiptStatus {
    if (!available(order)) return 'NO_DISPONIBLE'
    if (query.error.value) return 'ERROR'
    if (query.loading.value || !query.data.value) return 'CARGANDO'
    return query.data.value[order.pedidoId] ?? 'ERROR'
  }

  watch([identity, allowed, orders], () => { void refresh() }, { immediate: true, flush: 'sync' })

  return { status, refresh, loading: query.loading, available }
}
