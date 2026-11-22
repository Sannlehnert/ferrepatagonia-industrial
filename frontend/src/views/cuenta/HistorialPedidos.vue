<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ClientOrderDetail from '@/components/ClientOrderDetail.vue'
import OrderReceiptActions from '@/components/OrderReceiptActions.vue'
import OrderReceiptDialog from '@/components/OrderReceiptDialog.vue'
import { useOrderReceiptSummaries } from '@/composables/useOrderReceiptSummaries'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import { listClientOrders } from '@/services/clientOrderService'
import { onRealtime } from '@/services/realtime'
import { normalizeOrderFilter } from '@/utils/accountFilters'
import { useAuthStore } from '@/stores/auth'
import type { ClientOrderSummary } from '@/types/clientOrder'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
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
const receiptOrder = ref<ClientOrderSummary | null>(null)
const receipts = useOrderReceiptSummaries(() => orders.value)

function closeReceiptDialog() {
  receiptOrder.value = null
  void receipts.refresh()
}

function toggleOrder(orderId: number) {
  expandedOrderId.value = expandedOrderId.value === orderId ? null : orderId
}

const isMobile = ref(typeof window !== 'undefined' ? window.innerWidth < 1280 : false)

function updateIsMobile() {
  if (typeof window !== 'undefined') {
    isMobile.value = window.innerWidth < 1280
  }
}

onMounted(() => {
  updateIsMobile()
  window.addEventListener('resize', updateIsMobile)
  const mql = window.matchMedia('(max-width: 1279px)')
  const handler = (e: MediaQueryListEvent) => {
    isMobile.value = e.matches
  }
  mql.addEventListener('change', handler)
  onUnmounted(() => {
    window.removeEventListener('resize', updateIsMobile)
    mql.removeEventListener('change', handler)
  })
})

watch([identity, allowed], () => {
  expandedOrderId.value = null
  receiptOrder.value = null
  void loadOrders()
}, { immediate: true })

onRealtime(change => {
  if (change.reconnect || change.orders.size > 0) {
    void load(listClientOrders, { keepData: true })
  }
})

// Filters
const filtroFecha = ref('')
const filtroComprobante = ref('')
const filtroEstado = ref('')
const filtroModalidad = ref('')

watch(
  () => normalizeOrderFilter(route.query.filtro),
  filtro => {
    if (filtro === 'sin-comprobante') {
      filtroComprobante.value = 'NO_ADJUNTO'
      filtroModalidad.value = ''
    } else if (filtro === 'cuenta-corriente') {
      filtroModalidad.value = 'CUENTA_CORRIENTE'
      filtroComprobante.value = ''
    } else {
      filtroComprobante.value = ''
      filtroModalidad.value = ''
    }
  },
  { immediate: true },
)

function limpiarFiltros() {
  filtroFecha.value = ''
  filtroComprobante.value = ''
  filtroEstado.value = ''
  filtroModalidad.value = ''
  if (route.query.filtro !== undefined) {
    void router.replace({ query: {} })
  }
}

const filteredOrders = computed(() => {
  if (!orders.value) return []
  return orders.value.filter(order => {
    if (filtroFecha.value) {
      const orderDateIso = new Date(order.fecha).toISOString().slice(0, 10)
      if (orderDateIso !== filtroFecha.value) return false
    }
    if (filtroEstado.value && order.estado !== filtroEstado.value) {
      return false
    }
    if (filtroModalidad.value && order.modalidadPago !== filtroModalidad.value) {
      return false
    }
    if (filtroComprobante.value && receipts.status(order) !== filtroComprobante.value) return false
    return true
  })
})

function getOrderStatusBadgeClasses(status: string) {
  const s = status.toUpperCase().replaceAll(' ', '_')
  if (s === 'PENDIENTE') return 'bg-amber-100 text-amber-900'
  if (s === 'ENVIADO') return 'bg-emerald-50 text-emerald-700'
  if (s === 'ENTREGADO') return 'bg-green-100 text-green-800'
  if (s === 'CONFIRMADO') return 'bg-sky-50 text-sky-800'
  if (s === 'CANCELADO' || s === 'RECHAZADO') return 'bg-red-100 text-red-800'
  return 'bg-slate-100 text-slate-700'
}

</script>

<template>
  <div class="space-y-6">
    <!-- Section Heading -->
    <h3 class="m-0 mb-4 text-xl font-bold text-[#0B2438]">Mis pedidos</h3>

    <!-- Filter Bar -->
    <div class="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3 flex flex-wrap gap-4 items-center justify-between shadow-sm mb-6">
      <div class="flex flex-wrap items-center gap-3 min-w-0">
        <div class="flex w-full min-w-0 flex-col items-stretch gap-1 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
          <label for="filtro-fecha" class="text-xs font-semibold text-slate-600">Fecha:</label>
          <input
            id="filtro-fecha"
            v-model="filtroFecha"
            type="date"
            aria-label="Filtrar por fecha"
            class="box-border min-h-[44px] w-full min-w-0 rounded-lg border border-solid border-[#CBD5E1] bg-white px-3 py-1.5 font-[inherit] text-sm text-slate-700 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] sm:w-auto"
          />
        </div>

        <div class="flex w-full min-w-0 flex-col items-stretch gap-1 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
          <label for="filtro-comprobante" class="text-xs font-semibold text-slate-600">Comprobante:</label>
          <select
            id="filtro-comprobante"
            v-model="filtroComprobante"
            aria-label="Estado del Comprobante"
            class="box-border min-h-[44px] w-full min-w-0 max-w-full rounded-lg border border-solid border-[#CBD5E1] bg-white px-3 py-1.5 font-[inherit] text-sm text-slate-700 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] sm:w-auto"
          >
            <option value="">Estado del Comprobante (Todos)</option>
            <option value="PENDIENTE">Pendiente de revisión</option>
            <option value="NO_ADJUNTO">No adjunto</option>
            <option value="APROBADO">Aprobado</option>
            <option value="RECHAZADO">Rechazado</option>
          </select>
        </div>

        <div class="flex w-full min-w-0 flex-col items-stretch gap-1 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
          <label for="filtro-estado" class="text-xs font-semibold text-slate-600">Estado:</label>
          <select
            id="filtro-estado"
            v-model="filtroEstado"
            aria-label="Estado del Pedido"
            class="box-border min-h-[44px] w-full min-w-0 max-w-full rounded-lg border border-solid border-[#CBD5E1] bg-white px-3 py-1.5 font-[inherit] text-sm text-slate-700 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] sm:w-auto"
          >
            <option value="">Estado del Pedido (Todos)</option>
            <option value="PENDIENTE">Pendiente</option>
            <option value="CONFIRMADO">Confirmado</option>
            <option value="ENVIADO">Enviado</option>
            <option value="ENTREGADO">Entregado</option>
            <option value="CANCELADO">Cancelado</option>
          </select>
        </div>
      </div>

      <button
        v-if="filtroFecha || filtroComprobante || filtroEstado || filtroModalidad"
        type="button"
        class="box-border min-h-[44px] min-w-[44px] cursor-pointer border-0 bg-transparent px-2 py-1 font-[inherit] text-xs font-semibold text-[#145A8D] hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
        @click="limpiarFiltros"
      >
        Limpiar filtros
      </button>
    </div>

    <p v-if="receipts.loading.value" role="status" class="text-sm text-slate-500">
      Consultando estados de comprobantes…
    </p>
    <div v-else-if="orders?.some(order => receipts.status(order) === 'ERROR')" class="space-y-2">
      <p role="alert" class="text-sm text-red-700">No se pudieron consultar todos los estados de comprobantes.</p>
      <button type="button" class="box-border min-h-[44px] min-w-[44px] cursor-pointer border-0 bg-transparent px-3 py-1 font-[inherit] text-sm text-[#103A5C] underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]" @click="receipts.refresh()">
        Reintentar estados de comprobantes
      </button>
    </div>

    <!-- Table States & Content -->
    <!-- Loading State -->
    <div v-if="loading && !orders" class="rounded-[10px] border border-[#E2E8F0] bg-white p-8 text-center shadow-sm">
      <p role="status" class="text-slate-500 m-0">Cargando tus pedidos…</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="rounded-[10px] border border-[#E2E8F0] bg-white p-8 text-center shadow-sm space-y-3">
      <p role="alert" class="text-red-700 m-0">No se pudieron cargar tus pedidos.</p>
      <button
        type="button"
        class="box-border inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-[8px] border border-solid border-[#103A5C] bg-white px-4 font-[inherit] text-sm font-semibold text-[#103A5C] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
        @click="loadOrders()"
      >
        Reintentar
      </button>
    </div>

    <!-- Empty State -->
    <div v-else-if="orders?.length === 0" class="rounded-[10px] border border-[#E2E8F0] bg-white p-8 text-center shadow-sm">
      <p role="status" class="text-slate-600 m-0">Todavía no tenés pedidos.</p>
    </div>

    <!-- Filter empty message -->
    <p
      v-else-if="filteredOrders.length === 0 && !receipts.loading.value"
      class="rounded-[10px] border border-[#E2E8F0] bg-white p-6 text-center text-slate-500 shadow-sm"
    >
      No se encontraron pedidos con los filtros seleccionados.
    </p>

    <!-- Content with Orders -->
    <div v-else class="space-y-6">
      <!-- Desktop Table -->
      <div v-if="!isMobile" class="rounded-[10px] border border-[#E2E8F0] overflow-x-auto bg-white shadow-sm" role="list">
        <table class="w-full min-w-[640px] border-collapse text-left">
          <thead class="bg-slate-50 border-b border-[#E2E8F0]">
            <tr>
              <th scope="col" class="py-4 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider">Fecha</th>
              <th scope="col" class="py-4 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider">Monto Total</th>
              <th scope="col" class="py-4 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider">Método de Pago</th>
              <th scope="col" class="py-4 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider">Estado Pedido</th>
              <th scope="col" class="py-4 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider">Comprobante</th>
              <th scope="col" class="py-4 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">Detalle</th>
            </tr>
          </thead>
          <tbody
            v-for="order in filteredOrders"
            :key="order.pedidoId"
            role="listitem"
            class="divide-y divide-[#E2E8F0] border-b border-[#E2E8F0] last:border-b-0"
          >
            <tr class="hover:bg-slate-50/50 transition-colors">
              <!-- Fecha -->
              <td class="py-4 px-6 text-sm text-slate-600">
                <time :datetime="order.fecha">{{ dateFormat.format(new Date(order.fecha)) }}</time>
                <h3 role="heading" class="m-0 block text-xs font-bold text-[#0B2438] font-mono">
                  {{ order.numero || ('PED-' + String((order as any).idPedido ?? order.pedidoId).padStart(6, '0')) }}
                </h3>
                <p v-if="(order as any).simulado" class="m-0 text-[11px] font-semibold text-slate-500">
                  Pedido simulado académico
                </p>
              </td>

              <!-- Monto Total -->
              <td class="py-4 px-6 text-sm font-bold text-[#0B2438]">
                {{ order.total }} {{ order.moneda || 'USD' }}
              </td>

              <!-- Método de Pago -->
              <td class="py-4 px-6 text-sm">
                <span
                  :class="order.modalidadPago === 'CUENTA_CORRIENTE'
                    ? 'text-sky-800 font-medium'
                    : 'text-slate-700'"
                >
                  {{ order.modalidadPago === 'CUENTA_CORRIENTE' ? 'Cuenta Corriente' : order.modalidadPago.replaceAll('_', ' ') }}
                </span>
              </td>

              <!-- Estado Pedido -->
              <td class="py-4 px-6 text-sm">
                <span
                  class="inline-block rounded-full px-3 py-1 text-xs font-semibold"
                  :class="getOrderStatusBadgeClasses(order.estado)"
                >
                  {{ order.estado.replaceAll('_', ' ') }}
                </span>
              </td>

              <!-- Comprobante -->
              <td class="py-4 px-6 text-sm">
                <OrderReceiptActions
                  :status="receipts.status(order)"
                  :order-number="order.numero"
                  @open="receiptOrder = order"
                  @retry="receipts.refresh()"
                />
              </td>

              <!-- Detalle Action Button -->
              <td class="py-4 px-6 text-sm text-right">
                <button
                  type="button"
                  class="box-border inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-[8px] border border-solid border-[#103A5C] bg-white px-4 font-[inherit] text-sm font-semibold text-[#103A5C] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                  :aria-expanded="expandedOrderId === order.pedidoId"
                  :aria-label="`${expandedOrderId === order.pedidoId ? 'Ocultar' : 'Ver'} detalle de ${order.numero}`"
                  @click="toggleOrder(order.pedidoId)"
                >
                  {{ expandedOrderId === order.pedidoId ? 'Ocultar detalle' : 'Ver detalle' }}
                </button>
              </td>
            </tr>

            <!-- Expanded Detail Row -->
            <tr v-if="expandedOrderId === order.pedidoId">
              <td colspan="6" class="p-4 sm:p-6 bg-slate-50/50 border-t border-[#E2E8F0]">
                <ClientOrderDetail
                  :order-id="order.pedidoId"
                  :show-receipts="receiptOrder?.pedidoId !== order.pedidoId"
                  @receipt-updated="receipts.refresh()"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Order Cards -->
      <div v-else role="list" class="space-y-4">
        <div
          v-for="order in filteredOrders"
          :key="order.pedidoId"
          role="listitem"
          class="min-w-0 rounded-[10px] border border-[#E2E8F0] bg-white p-4 shadow-sm space-y-3"
        >
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-2">
            <div class="min-w-0">
              <h3 role="heading" class="m-0 font-bold text-[#0B2438] text-base">
                {{ order.numero || ('PED-' + String((order as any).idPedido ?? order.pedidoId).padStart(6, '0')) }}
              </h3>
              <span class="block text-xs text-slate-500">{{ dateFormat.format(new Date(order.fecha)) }}</span>
              <p v-if="(order as any).simulado" class="m-0 text-[11px] font-semibold text-slate-500">
                Pedido simulado académico
              </p>
            </div>
            <span
              class="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold"
              :class="getOrderStatusBadgeClasses(order.estado)"
            >
              {{ order.estado.replaceAll('_', ' ') }}
            </span>
          </div>

          <div class="grid grid-cols-2 gap-2 text-sm">
            <div class="min-w-0 [overflow-wrap:anywhere]">
              <span class="text-xs text-slate-500 block">Monto Total:</span>
              <span class="font-bold text-[#0B2438] text-base">
                {{ order.total }} {{ order.moneda || 'USD' }}
              </span>
            </div>
            <div class="min-w-0 [overflow-wrap:anywhere]">
              <span class="text-xs text-slate-500 block">Método de Pago:</span>
              <span
                :class="order.modalidadPago === 'CUENTA_CORRIENTE'
                  ? 'text-sky-800 font-medium'
                  : 'text-slate-700'"
              >
                {{ order.modalidadPago === 'CUENTA_CORRIENTE' ? 'Cuenta Corriente' : order.modalidadPago.replaceAll('_', ' ') }}
              </span>
            </div>
          </div>

          <OrderReceiptActions
            :status="receipts.status(order)"
            :order-number="order.numero"
            @open="receiptOrder = order"
            @retry="receipts.refresh()"
          />

          <button
            type="button"
            class="box-border w-full inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-[8px] border border-solid border-[#103A5C] bg-white px-4 font-[inherit] text-sm font-semibold text-[#103A5C] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
            :aria-expanded="expandedOrderId === order.pedidoId"
            :aria-label="`${expandedOrderId === order.pedidoId ? 'Ocultar' : 'Ver'} detalle de ${order.numero}`"
            @click="toggleOrder(order.pedidoId)"
          >
            {{ expandedOrderId === order.pedidoId ? 'Ocultar detalle' : 'Ver detalle' }}
          </button>

          <ClientOrderDetail
            v-if="expandedOrderId === order.pedidoId"
            :order-id="order.pedidoId"
            :show-receipts="receiptOrder?.pedidoId !== order.pedidoId"
            @receipt-updated="receipts.refresh()"
          />
        </div>
      </div>
    </div>

    <OrderReceiptDialog
      v-if="receiptOrder"
      :key="`${identity()}:${receiptOrder.pedidoId}`"
      :order="receiptOrder"
      @close="closeReceiptDialog"
      @updated="receipts.refresh()"
    />
  </div>
</template>
