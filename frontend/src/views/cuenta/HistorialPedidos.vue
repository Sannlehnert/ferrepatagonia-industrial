<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ClientOrderDetail from '@/components/ClientOrderDetail.vue'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import { listClientOrders } from '@/services/clientOrderService'
import { onRealtime } from '@/services/realtime'
import { orderReceiptsPath, uploadPaymentReceipt } from '@/services/paymentReceiptService'
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

function toggleOrder(orderId: number) {
  expandedOrderId.value = expandedOrderId.value === orderId ? null : orderId
}

watch([identity, allowed], () => {
  expandedOrderId.value = null
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
  () => route.query.filtro,
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
  if (route.query.filtro) {
    void router.replace({ query: {} })
  }
}

// Receipt status simulation / tracking
const receiptsUploaded = ref(new Set<number>())

function getReceiptStatus(order: ClientOrderSummary): 'Subido' | 'No adjunto' | 'Aprobado' | 'Rechazado' {
  if (receiptsUploaded.value.has(order.pedidoId)) return 'Subido'
  if (order.modalidadPago === 'CUENTA_CORRIENTE') return 'Aprobado'
  if (order.estado === 'ENTREGADO') return 'Aprobado'
  if (order.estado === 'CANCELADO') return 'Rechazado'
  if (order.estado === 'PENDIENTE') return 'No adjunto'
  return 'Subido'
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
    if (filtroComprobante.value) {
      const status = getReceiptStatus(order)
      if (filtroComprobante.value === 'SUBIDO' && status !== 'Subido') return false
      if (filtroComprobante.value === 'NO_ADJUNTO' && status !== 'No adjunto') return false
      if (filtroComprobante.value === 'APROBADO' && status !== 'Aprobado') return false
      if (filtroComprobante.value === 'RECHAZADO' && status !== 'Rechazado') return false
    }
    return true
  })
})

function getOrderStatusBadgeClasses(status: string) {
  const s = status.toUpperCase().replaceAll(' ', '_')
  if (s === 'PENDIENTE') return 'bg-[#FEF3C7] text-[#D97706]'
  if (s === 'ENVIADO') return 'bg-emerald-50 text-emerald-700'
  if (s === 'ENTREGADO') return 'bg-[#DCFCE7] text-[#16A34A]'
  if (s === 'CONFIRMADO') return 'bg-sky-50 text-[#0EA5E9]'
  if (s === 'CANCELADO' || s === 'RECHAZADO') return 'bg-[#FEE2E2] text-[#DC2626]'
  return 'bg-slate-100 text-slate-700'
}

function getReceiptBadgeClasses(status: string) {
  if (status === 'Aprobado') return 'bg-[#DCFCE7] text-[#16A34A]'
  if (status === 'Subido') return 'bg-[#FEF3C7] text-[#D97706]'
  if (status === 'Rechazado') return 'bg-[#FEE2E2] text-[#DC2626]'
  return 'bg-slate-100 text-slate-600'
}

// Receipt Modal
const modalOpen = ref(false)
const modalTargetOrder = ref<ClientOrderSummary | null>(null)
const modalFileInput = ref<HTMLInputElement | null>(null)
const modalFile = shallowRef<File | null>(null)
const modalBusy = ref(false)
const modalError = ref('')
const modalNotice = ref('')

function openReceiptModal(order: ClientOrderSummary) {
  modalTargetOrder.value = order
  modalFile.value = null
  modalError.value = ''
  modalNotice.value = ''
  modalOpen.value = true
}

function closeReceiptModal() {
  if (modalBusy.value) return
  modalOpen.value = false
  modalTargetOrder.value = null
  modalFile.value = null
  modalError.value = ''
  modalNotice.value = ''
}

function handleModalFileSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  modalError.value = ''
  modalNotice.value = ''
  modalFile.value = file ?? null
  if (file && (file.size === 0 || file.size > 5 * 1024 * 1024 || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type))) {
    modalError.value = 'Seleccioná un PDF, JPG o PNG con contenido y de hasta 5 MB.'
    modalFile.value = null
    if (modalFileInput.value) modalFileInput.value.value = ''
  }
}

function handleModalDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0]
  modalError.value = ''
  modalNotice.value = ''
  modalFile.value = file ?? null
  if (file && (file.size === 0 || file.size > 5 * 1024 * 1024 || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type))) {
    modalError.value = 'Seleccioná un PDF, JPG o PNG con contenido y de hasta 5 MB.'
    modalFile.value = null
    if (modalFileInput.value) modalFileInput.value.value = ''
  }
}

async function submitModalReceipt() {
  if (!modalFile.value || !modalTargetOrder.value || modalBusy.value) return
  modalBusy.value = true
  modalError.value = ''
  modalNotice.value = ''

  try {
    const controller = new AbortController()
    const path = orderReceiptsPath(modalTargetOrder.value.pedidoId)
    const success = await uploadPaymentReceipt(path, modalFile.value, controller.signal)
    if (success) {
      receiptsUploaded.value.add(modalTargetOrder.value.pedidoId)
      modalNotice.value = 'Comprobante recibido. La acreditación del pago se gestiona por separado.'
      setTimeout(() => {
        closeReceiptModal()
        void loadOrders()
      }, 1200)
    } else {
      modalNotice.value = 'Este comprobante ya estaba registrado para la operación.'
      setTimeout(() => {
        closeReceiptModal()
      }, 1200)
    }
  } catch {
    modalError.value = 'No se pudo procesar el comprobante. Reintentá en unos instantes.'
  } finally {
    modalBusy.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Section Heading -->
    <h3 class="m-0 mb-4 text-xl font-bold text-[#0B2438]">Mis pedidos</h3>

    <!-- Filter Bar -->
    <div class="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3 flex flex-wrap gap-4 items-center justify-between shadow-sm mb-6">
      <div class="flex flex-wrap items-center gap-3 min-w-0">
        <div class="flex items-center gap-2">
          <label for="filtro-fecha" class="text-xs font-semibold text-slate-600">Fecha:</label>
          <input
            id="filtro-fecha"
            v-model="filtroFecha"
            type="date"
            aria-label="Filtrar por fecha"
            class="bg-white border border-[#CBD5E1] rounded-lg px-3 py-1.5 text-sm min-h-[44px] text-slate-700 focus:outline-none focus:border-[#145A8D]"
          />
        </div>

        <div class="flex items-center gap-2">
          <label for="filtro-comprobante" class="text-xs font-semibold text-slate-600">Comprobante:</label>
          <select
            id="filtro-comprobante"
            v-model="filtroComprobante"
            aria-label="Estado del Comprobante"
            class="bg-white border border-[#CBD5E1] rounded-lg px-3 py-1.5 text-sm min-h-[44px] text-slate-700 focus:outline-none focus:border-[#145A8D]"
          >
            <option value="">Estado del Comprobante (Todos)</option>
            <option value="SUBIDO">Subido</option>
            <option value="NO_ADJUNTO">No adjunto</option>
            <option value="APROBADO">Aprobado</option>
            <option value="RECHAZADO">Rechazado</option>
          </select>
        </div>

        <div class="flex items-center gap-2">
          <label for="filtro-estado" class="text-xs font-semibold text-slate-600">Estado:</label>
          <select
            id="filtro-estado"
            v-model="filtroEstado"
            aria-label="Estado del Pedido"
            class="bg-white border border-[#CBD5E1] rounded-lg px-3 py-1.5 text-sm min-h-[44px] text-slate-700 focus:outline-none focus:border-[#145A8D]"
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
        class="text-xs text-[#145A8D] hover:underline font-semibold min-h-[44px] px-2 py-1 cursor-pointer"
        @click="limpiarFiltros"
      >
        Limpiar filtros
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
        class="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[8px] border border-[#103A5C] bg-white px-4 text-sm font-semibold text-[#103A5C] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[#145A8D] cursor-pointer"
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
      v-else-if="filteredOrders.length === 0"
      class="rounded-[10px] border border-[#E2E8F0] bg-white p-6 text-center text-slate-500 shadow-sm"
    >
      No se encontraron pedidos con los filtros seleccionados.
    </p>

    <!-- Content with Orders -->
    <div v-else class="space-y-6">
      <!-- Desktop Table (>= 768px) -->
      <div class="hidden md:block rounded-[10px] border border-[#E2E8F0] overflow-x-auto bg-white shadow-sm">
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
          <tbody class="divide-y divide-[#E2E8F0]">
            <template v-for="order in filteredOrders" :key="order.pedidoId">
              <tr class="hover:bg-slate-50/50 transition-colors">
                <!-- Fecha -->
                <td class="py-4 px-6 text-sm text-slate-600">
                  <time :datetime="order.fecha">{{ dateFormat.format(new Date(order.fecha)) }}</time>
                  <span class="block text-xs text-slate-400 font-mono">{{ order.numero }}</span>
                </td>

                <!-- Monto Total -->
                <td class="py-4 px-6 text-sm font-bold text-[#0B2438]">
                  {{ order.moneda === 'USD' ? 'USD ' : '$' }}{{ order.total }}
                </td>

                <!-- Método de Pago -->
                <td class="py-4 px-6 text-sm">
                  <span
                    :class="order.modalidadPago === 'CUENTA_CORRIENTE'
                      ? 'text-[#0EA5E9] font-medium'
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
                  <div class="flex items-center gap-2">
                    <svg class="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span
                      class="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                      :class="getReceiptBadgeClasses(getReceiptStatus(order))"
                    >
                      {{ getReceiptStatus(order) }}
                    </span>
                    <button
                      type="button"
                      class="text-[#145A8D] font-semibold underline cursor-pointer text-xs ml-1 hover:text-[#103A5C]"
                      @click="toggleOrder(order.pedidoId)"
                    >
                      ver
                    </button>
                    <button
                      type="button"
                      class="inline-flex items-center justify-center min-h-[32px] min-w-[32px] text-slate-500 hover:text-[#103A5C] hover:bg-slate-100 rounded-[8px] transition cursor-pointer p-1"
                      title="Subir o editar comprobante"
                      aria-label="Subir o editar comprobante"
                      @click="openReceiptModal(order)"
                    >
                      ✏️
                    </button>
                  </div>
                </td>

                <!-- Detalle Action Button -->
                <td class="py-4 px-6 text-sm text-right">
                  <button
                    type="button"
                    class="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[8px] border border-[#103A5C] px-4 text-sm font-semibold text-[#103A5C] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[#145A8D] cursor-pointer"
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
                  <ClientOrderDetail :order-id="order.pedidoId" />
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- Mobile Order Cards (< 768px) -->
      <div class="md:hidden space-y-4">
        <div
          v-for="order in filteredOrders"
          :key="order.pedidoId"
          class="rounded-[10px] border border-[#E2E8F0] bg-white p-4 shadow-sm space-y-3"
        >
          <div class="flex items-center justify-between gap-2 border-b border-[#E2E8F0] pb-2">
            <div>
              <span class="font-bold text-[#0B2438] text-base">{{ order.numero }}</span>
              <span class="block text-xs text-slate-500">{{ dateFormat.format(new Date(order.fecha)) }}</span>
            </div>
            <span
              class="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold"
              :class="getOrderStatusBadgeClasses(order.estado)"
            >
              {{ order.estado.replaceAll('_', ' ') }}
            </span>
          </div>

          <div class="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span class="text-xs text-slate-500 block">Monto Total:</span>
              <span class="font-bold text-[#0B2438] text-base">
                {{ order.moneda === 'USD' ? 'USD ' : '$' }}{{ order.total }}
              </span>
            </div>
            <div>
              <span class="text-xs text-slate-500 block">Método de Pago:</span>
              <span
                :class="order.modalidadPago === 'CUENTA_CORRIENTE'
                  ? 'text-[#0EA5E9] font-medium'
                  : 'text-slate-700'"
              >
                {{ order.modalidadPago === 'CUENTA_CORRIENTE' ? 'Cuenta Corriente' : order.modalidadPago.replaceAll('_', ' ') }}
              </span>
            </div>
          </div>

          <div class="flex items-center justify-between border-t border-[#E2E8F0] pt-2 text-sm">
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <span
                class="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                :class="getReceiptBadgeClasses(getReceiptStatus(order))"
              >
                {{ getReceiptStatus(order) }}
              </span>
              <button
                type="button"
                class="text-[#145A8D] font-semibold underline cursor-pointer text-xs ml-1 hover:text-[#103A5C]"
                @click="toggleOrder(order.pedidoId)"
              >
                ver
              </button>
            </div>

            <button
              type="button"
              class="inline-flex items-center justify-center min-h-[44px] min-w-[44px] text-slate-600 hover:text-[#103A5C] hover:bg-slate-100 rounded-[8px] transition cursor-pointer px-2"
              title="Subir o editar comprobante"
              aria-label="Subir o editar comprobante"
              @click="openReceiptModal(order)"
            >
              ✏️ Comprobante
            </button>
          </div>

          <button
            type="button"
            class="w-full inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[8px] border border-[#103A5C] px-4 text-sm font-semibold text-[#103A5C] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[#145A8D] cursor-pointer"
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
        </div>
      </div>
    </div>

    <!-- Receipt Upload Modal (Figma Spec) -->
    <div
      v-if="modalOpen"
      class="fixed inset-0 bg-[#0B2438]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      @click.self="closeReceiptModal"
    >
      <div class="bg-white rounded-xl shadow-2xl border border-[#E2E8F0] max-w-sm sm:max-w-md w-full p-6 flex flex-col items-center gap-6">
        <div class="w-full flex items-center justify-between border-b border-[#E2E8F0] pb-3">
          <h4 class="text-base font-bold text-[#0B2438] m-0">Comprobante · {{ modalTargetOrder?.numero }}</h4>
          <button
            type="button"
            class="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-[8px] cursor-pointer"
            aria-label="Cerrar modal"
            @click="closeReceiptModal"
          >
            ✕
          </button>
        </div>

        <label
          class="border-2 border-dashed border-[#CBD5E1] rounded-[10px] p-6 sm:p-8 w-full flex flex-col items-center justify-center gap-3 bg-[#F8FAFC] hover:bg-slate-50 transition cursor-pointer text-center"
          @dragover.prevent
          @drop.prevent="handleModalDrop"
        >
          <svg class="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <span class="text-xs sm:text-sm font-semibold text-slate-700 text-center">
            Subir Comprobante de Transferencia (Click o arrastrar)
          </span>
          <span class="text-xs text-slate-500">
            {{ modalFile ? modalFile.name : 'PDF, JPG o PNG, hasta 5 MB' }}
          </span>
          <input
            ref="modalFileInput"
            type="file"
            aria-label="Archivo (PDF, JPG o PNG, hasta 5 MB)"
            accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
            class="hidden"
            :disabled="modalBusy"
            @change="handleModalFileSelect"
          />
        </label>

        <p v-if="modalError" role="alert" class="m-0 text-sm font-medium text-[#DC2626]">{{ modalError }}</p>
        <p v-if="modalNotice" role="status" class="m-0 text-sm font-medium text-[#16A34A]">{{ modalNotice }}</p>

        <div class="flex items-center justify-end gap-3 w-full">
          <button
            type="button"
            class="bg-[#94A3B8] hover:bg-[#64748B] text-white font-semibold rounded-[8px] px-6 py-2 min-h-[44px] min-w-[100px] text-sm transition cursor-pointer"
            :disabled="modalBusy"
            @click="closeReceiptModal"
          >
            Cancelar
          </button>
          <button
            type="button"
            class="bg-[#16A34A] hover:bg-[#15803D] text-white font-semibold rounded-[8px] px-6 py-2 min-h-[44px] min-w-[100px] text-sm transition shadow-sm disabled:opacity-50 cursor-pointer"
            :disabled="!modalFile || modalBusy"
            @click="submitModalReceipt"
          >
            {{ modalBusy ? 'Subiendo…' : 'Subir' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
