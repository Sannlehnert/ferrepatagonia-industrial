<script setup lang="ts">
import { ref, watch } from 'vue'
import ClientOrderDetail from '@/components/ClientOrderDetail.vue'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import { listClientOrders } from '@/services/clientOrderService'
import { onRealtime } from '@/services/realtime'
import { useAuthStore } from '@/stores/auth'
import type { ClientOrderSummary } from '@/types/clientOrder'

const auth = useAuthStore()
const identity = () => `${auth.user?.id}:${auth.rol}:${auth.sessionVersion}`
const allowed = () => auth.rol === 'CLIENTE' && !auth.loggingIn && !auth.loggingOut

const { data: orders, loading, error, load } = usePrivateAccountRead<ClientOrderSummary[]>(
  identity,
  allowed,
)

const dateFormat = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium',
  timeZone: 'America/Argentina/Buenos_Aires',
})

function loadOrders() {
  return load(listClientOrders)
}

const expandedOrderId = ref<number | null>(null)

function toggleOrder(orderId: number) {
  expandedOrderId.value = expandedOrderId.value === orderId ? null : orderId
}

watch([identity, allowed], () => {
  expandedOrderId.value = null
  void loadOrders()
}, { immediate: true })

onRealtime(change => {
  if (change.reconnect || change.orders.size > 0) {
    // Keep the selected detail mounted while replacing the list from REST.
    void load(listClientOrders, { keepData: true })
  }
})
</script>

<template>
  <h3 class="m-0 mb-4 text-lg font-semibold text-[#0b2438]">Mis pedidos</h3>

  <p v-if="loading && !orders" role="status">Cargando tus pedidos…</p>

  <div v-else-if="error" class="space-y-3">
    <p role="alert">No se pudieron cargar tus pedidos.</p>
    <button
      type="button"
      class="min-h-11 rounded-md border border-[#103a5c] bg-white px-4 text-[#103a5c]"
      @click="loadOrders()"
    >
      Reintentar
    </button>
  </div>

  <p v-else-if="orders?.length === 0" role="status">Todavía no tenés pedidos.</p>

  <ul v-else-if="orders" class="m-0 list-none space-y-3 p-0">
    <li
      v-for="order in orders"
      :key="order.pedidoId"
      class="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h4 class="m-0 mb-3 font-semibold text-[#0b2438]">{{ order.numero }}</h4>
      <p v-if="order.simulado" class="mt-0 text-sm font-semibold">Pedido simulado académico</p>

      <dl class="m-0 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt class="text-slate-600">Fecha</dt>
          <dd class="m-0">
            <time :datetime="order.fecha">{{ dateFormat.format(new Date(order.fecha)) }}</time>
          </dd>
        </div>
        <div>
          <dt class="text-slate-600">Estado</dt>
          <dd class="m-0 break-words">{{ order.estado.replaceAll('_', ' ') }}</dd>
        </div>
        <div>
          <dt class="text-slate-600">Modalidad</dt>
          <dd class="m-0 break-words">{{ order.modalidadPago.replaceAll('_', ' ') }}</dd>
        </div>
        <div>
          <dt class="text-slate-600">Importe histórico</dt>
          <dd class="m-0">
            {{ order.total }} {{ order.moneda ?? '' }}
            <span v-if="!order.moneda" class="block text-slate-600">Moneda no registrada</span>
          </dd>
        </div>
      </dl>
        <button
          type="button"
          class="mt-3 min-h-11 rounded-md border border-[#103a5c] px-4 text-[#103a5c]"
          :aria-expanded="expandedOrderId === order.pedidoId"
          :aria-label="`${expandedOrderId === order.pedidoId ? 'Ocultar' : 'Ver'} detalle de ${order.numero}`"
          @click="toggleOrder(order.pedidoId)"
        >
          {{ expandedOrderId === order.pedidoId ? 'Ocultar detalle' : 'Ver detalle' }}
        </button>

        <ClientOrderDetail
          v-if="expandedOrderId === order.pedidoId"
          :order-id="order.pedidoId"
        />
    </li>
  </ul>
</template>
