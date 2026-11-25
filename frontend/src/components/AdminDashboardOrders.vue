<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import { formatAdminOrderDate, formatAdminOrderMoney, getAdminOrders } from '@/services/adminOrderService'
import { onRealtime } from '@/services/realtime'
import type { AdminOrderListResponse } from '@/types/adminOrder'
import { resolveOrderCommercialState } from '@/utils/payment'
import AdminOrderStatusBadge from './AdminOrderStatusBadge.vue'
import AdminOrderReceiptSummary from './AdminOrderReceiptSummary.vue'
import AdminDashboardMetrics from './AdminDashboardMetrics.vue'
import OrderFinancialStatusBadge from './OrderFinancialStatusBadge.vue'

const auth = useAuthStore()
const allowed = () => auth.rol === 'ADMIN' && !auth.loggingIn && !auth.loggingOut
const identity = () => `${auth.user?.id}:${auth.rol}:${auth.sessionVersion}`
const orders = usePrivateAccountRead<AdminOrderListResponse>(identity, allowed)
const data = computed(() => orders.data.value)
const metricsPanel = ref<InstanceType<typeof AdminDashboardMetrics> | null>(null)
const loadRecent = (keepData = false) =>
  orders.load(signal => getAdminOrders({ page: 1, limit: 5 }, signal), { keepData })
function reload() {
  void metricsPanel.value?.reload()
  return loadRecent()
}
watch(() => [identity(), auth.loggingIn, auth.loggingOut], () => {
  orders.reset()
  if (allowed()) void loadRecent()
}, { flush: 'sync' })
onMounted(() => { if (allowed()) void loadRecent() })
onRealtime(change => {
  if (!allowed()) return
  if (change.reconnect || change.orders.size > 0 || change.receipts || change.payments) {
    void metricsPanel.value?.reload()
    void loadRecent(true)
  }
})
</script>

<template>
  <section v-if="allowed()" aria-labelledby="dashboard-orders-title" :aria-busy="orders.loading.value || metricsPanel?.loading" class="min-w-0">
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h2 id="dashboard-orders-title" class="m-0 text-xl font-semibold text-[#0b2438]">Resumen</h2>
      <button type="button" class="box-border min-h-11 cursor-pointer rounded-lg border border-slate-300 bg-white px-4 font-[inherit] text-sm font-semibold text-[#103a5c] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]" :disabled="orders.loading.value || metricsPanel?.loading" @click="reload">
        {{ (orders.loading.value || metricsPanel?.loading) ? 'Consultando…' : 'Actualizar pedidos' }}
      </button>
    </div>
    <AdminDashboardMetrics ref="metricsPanel" />
    <p v-if="orders.loading.value && !data" role="status" class="rounded-xl border border-slate-200 bg-white p-5 text-slate-600">Consultando pedidos…</p>
    <div v-else-if="orders.error.value" class="rounded-xl border border-red-200 bg-red-50 p-5">
      <p role="alert" class="m-0 text-red-800">No pudimos consultar los pedidos recientes. Reintentá con Actualizar pedidos.</p>
    </div>
    <div v-else-if="data" class="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <h3 class="m-0 border-b border-slate-200 bg-slate-50 px-4 py-3 text-base font-semibold text-[#0b2438]">Pedidos recientes</h3>
      <p v-if="!data.items.length" role="status" class="m-0 p-5 text-slate-600">Todavía no hay pedidos registrados.</p>
      <div v-else role="region" aria-label="Pedidos recientes" tabindex="0" class="overflow-x-auto focus-visible:outline-2 focus-visible:outline-[#145a8d]">
        <table class="w-full min-w-[900px] border-collapse text-left text-sm">
          <caption class="sr-only">Últimos cinco pedidos registrados con estado comercial, documental y financiero por separado</caption>
          <thead class="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th scope="col" class="px-4 py-3">Pedido</th>
              <th scope="col" class="px-4 py-3">Cliente</th>
              <th scope="col" class="px-4 py-3">Fecha</th>
              <th scope="col" class="px-4 py-3 text-right">Total</th>
              <th scope="col" class="px-4 py-3">Estado</th>
              <th scope="col" class="px-4 py-3">Comprobantes</th>
              <th scope="col" class="px-4 py-3">Estado financiero</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="order in data.items" :key="order.idPedido" class="border-t border-slate-200 hover:bg-slate-50">
              <td class="whitespace-nowrap px-4 py-2">
                <RouterLink :aria-label="`Ver pedido #${order.idPedido}`" class="inline-flex min-h-11 items-center font-semibold text-[#103a5c] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]" :to="{ name: 'admin-orders', query: { q: String(order.idPedido) } }">#{{ order.idPedido }}</RouterLink>
                <span v-if="order.origen === 'DEMO'" class="ml-1 text-xs text-slate-500">DEMO</span>
              </td>
              <td class="max-w-64 px-4 py-2"><span class="block truncate" :title="order.cliente.nombreRazonSocial">{{ order.cliente.nombreRazonSocial }}</span></td>
              <td class="whitespace-nowrap px-4 py-2 text-slate-600">{{ formatAdminOrderDate(order.fecha) }}</td>
              <td class="whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums">{{ formatAdminOrderMoney(order.total, order.moneda) }}</td>
              <td class="whitespace-nowrap px-4 py-2"><AdminOrderStatusBadge :status="resolveOrderCommercialState(order)" /></td>
              <td class="px-4 py-2"><AdminOrderReceiptSummary :estado-documental="order.estadoDocumental" :summary="order.comprobantes" /></td>
              <td class="max-w-[220px] px-4 py-2"><OrderFinancialStatusBadge :status="order.estadoFinanciero" :monto-acreditado-usd="order.montoAcreditadoUSD" compact /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
