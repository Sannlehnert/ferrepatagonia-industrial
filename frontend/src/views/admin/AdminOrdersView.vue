<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { useRoute } from 'vue-router'
import AdminOrderStatusBadge from '@/components/AdminOrderStatusBadge.vue'
import AdminOrderReceiptSummary from '@/components/AdminOrderReceiptSummary.vue'
import AdminOrdersPagination from '@/components/AdminOrdersPagination.vue'
import OrderFinancialStatusBadge from '@/components/OrderFinancialStatusBadge.vue'
import { useAuthStore } from '@/stores/auth'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import {
  formatAdminOrderMoney,
  formatAdminOrderPaymentMode,
  formatAdminOrderStatus,
  getAdminOrderDetail,
  getAdminOrders,
  updateAdminOrderStatus,
} from '@/services/adminOrderService'
import { onRealtime } from '@/services/realtime'
import { resolveOrderCommercialState } from '@/utils/payment'
import type {
  AdminOrderDetail,
  AdminOrderFilterStatus,
  AdminOrderListResponse,
  AdminOrderOperationalStatus,
  AdminOrderQueryFilters,
} from '@/types/adminOrder'

const auth = useAuthStore()
const route = useRoute()
const allowed = () => auth.rol === 'ADMIN' && !auth.loggingOut && !auth.loggingIn
const identity = () => `${auth.user?.id}:${auth.rol}:${auth.sessionVersion}`

const list = usePrivateAccountRead<AdminOrderListResponse>(identity, allowed)
const detail = usePrivateAccountRead<AdminOrderDetail>(identity, allowed)

// Filtros
const searchInput = ref('')
const statusInput = ref<AdminOrderFilterStatus | ''>('')
const paymentModeInput = ref('')
const dateInput = ref('')
const validationError = ref('')

// Modal y control de operaciones desacoplado por apertura reactiva (H-01)
const showModal = ref(false)
const selectedOrderId = ref<number | null>(null)
const nextStatusSelection = ref<AdminOrderOperationalStatus | ''>('')
const currentModalOpeningId = ref(0)
const savingOpeningId = ref<number | null>(null)
const statusFeedback = ref<{ text: string; error: boolean } | null>(null)

// Trazabilidad y contención de foco accesible (H-02)
let lastTriggerElement: HTMLElement | null = null
const modalCloseBtn = ref<HTMLButtonElement | null>(null)
const modalDialogRef = ref<HTMLElement | null>(null)

let activeFilters: AdminOrderQueryFilters = { page: 1, limit: 20 }
let disposed = false
let queuedListRefresh: string | undefined
const inFlightOrderTargets = new Map<number, string>()
const recentLocalOrderSaves = new Map<number, { status: string; until: number }>()
const pendingExternalOrderIds = new Set<number>()
let deferredOrderReconcileTimer: ReturnType<typeof setTimeout> | undefined

const ordersPage = computed(() => list.data.value)
const selectedOrder = computed(() => detail.data.value)
const visibleRange = computed(() => {
  const page = ordersPage.value
  if (!page || !page.items.length) return '0 resultados'
  const first = (page.pagination.page - 1) * page.pagination.limit + 1
  return `${first}–${first + page.items.length - 1} de ${page.pagination.total} pedidos`
})

// isSaving es 100% reactivo: al cambiar currentModalOpeningId.value se invalida de inmediato
const isSaving = computed(
  () => savingOpeningId.value !== null && savingOpeningId.value === currentModalOpeningId.value
)

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function formatDate(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed)
}

function resolveErrorMessage(
  error: unknown,
  context: 'list' | 'detail' | 'mutation'
): { message: string; status?: number } {
  const response = axios.isAxiosError<{ message?: string }>(error)
    ? error.response
    : (error as { response?: { status?: number; data?: { message?: string } } })?.response
  const status = response?.status

  if (status === 401 || status === 403) {
    return { message: 'La sesión actual no tiene permisos para administrar pedidos.', status }
  }
  if (status === 404) {
    return { message: 'El pedido solicitado no existe.', status }
  }
  if (status === 409) {
    return { message: response?.data?.message ?? 'El pedido cambió de estado concurrentemente.', status }
  }
  if (status === 400) {
    return { message: response?.data?.message ?? 'La operación no es válida para el estado actual.', status }
  }
  if (context === 'mutation') {
    return { message: 'No pudimos actualizar el estado del pedido. Verificá su estado actual.', status }
  }
  if (context === 'detail') {
    return { message: 'No pudimos cargar el detalle del pedido. Intentá nuevamente.', status }
  }
  return { message: 'No pudimos consultar el listado de pedidos.', status }
}

function loadList(page = activeFilters.page ?? 1, keepData = false) {
  const filters = { ...activeFilters, page }
  activeFilters = filters
  return list.load(async signal => {
    let result = await getAdminOrders(filters, signal)
    while (filters.page > Math.max(1, result.pagination.totalPages)) {
      signal.throwIfAborted()
      filters.page = Math.max(1, result.pagination.totalPages)
      result = await getAdminOrders(filters, signal)
    }
    return result
  }, { keepData })
}

function isCurrentSession(session: string) {
  return !disposed && allowed() && identity() === session
}

function reconcileList(session: string) {
  if (!isCurrentSession(session) || queuedListRefresh === session) return
  queuedListRefresh = session
  queueMicrotask(() => {
    if (queuedListRefresh !== session) return
    queuedListRefresh = undefined
    if (isCurrentSession(session)) void loadList(activeFilters.page, true)
  })
}

function applyFilters() {
  validationError.value = ''
  const rawQuery = searchInput.value.trim()
  if (rawQuery.length > 100) {
    validationError.value = 'La búsqueda no puede superar los 100 caracteres.'
    return
  }

  activeFilters = {
    page: 1,
    limit: 20,
    ...(statusInput.value ? { estado: statusInput.value } : {}),
    ...(paymentModeInput.value ? { modalidadPago: paymentModeInput.value } : {}),
    ...(dateInput.value ? { fecha: dateInput.value } : {}),
    ...(rawQuery ? { q: rawQuery } : {}),
  }

  void loadList(1)
}

function clearFilters() {
  searchInput.value = ''
  statusInput.value = ''
  paymentModeInput.value = ''
  dateInput.value = ''
  validationError.value = ''
  activeFilters = { page: 1, limit: 20 }
  void loadList(1)
}

function getFocusableElements(): HTMLElement[] {
  const dialog = modalDialogRef.value
  if (!dialog) return []
  const elements = dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )
  return Array.from(elements).filter(el => el.offsetParent !== null)
}

function focusFirstModalElement() {
  const focusables = getFocusableElements()
  const first = focusables[0]
  if (first) {
    first.focus()
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (!showModal.value) return

  if (e.key === 'Escape') {
    e.preventDefault()
    closeModal()
    return
  }

  if (e.key === 'Tab') {
    const dialog = modalDialogRef.value
    if (!dialog) return

    const focusables = getFocusableElements()
    if (focusables.length === 0) {
      e.preventDefault()
      return
    }

    const first = focusables[0]
    const last = focusables[focusables.length - 1]

    if (!first || !last) {
      e.preventDefault()
      return
    }

    const active = document.activeElement

    if (e.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (active === last || !dialog.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
  }
}

async function openOrderDetailModal(orderId: number, triggerEvent?: Event) {
  if (triggerEvent?.currentTarget instanceof HTMLElement) {
    lastTriggerElement = triggerEvent.currentTarget
  }

  currentModalOpeningId.value++
  const thisOpening = currentModalOpeningId.value
  selectedOrderId.value = orderId
  showModal.value = true
  statusFeedback.value = null
  nextStatusSelection.value = ''

  await nextTick()
  if (thisOpening !== currentModalOpeningId.value) return
  modalCloseBtn.value?.focus()
  await detail.load(signal => getAdminOrderDetail(orderId, signal))

  if (thisOpening !== currentModalOpeningId.value || selectedOrderId.value !== orderId) {
    return
  }

  const order = detail.data.value
  if (order && order.idPedido === orderId && order.estadosPermitidos.length > 0) {
    nextStatusSelection.value = order.estadosPermitidos[0] ?? ''
  }

  await nextTick()
  if (modalCloseBtn.value) {
    modalCloseBtn.value.focus()
  } else {
    focusFirstModalElement()
  }
}

function closeModal() {
  currentModalOpeningId.value++
  showModal.value = false
  selectedOrderId.value = null
  detail.reset()
  if (lastTriggerElement) {
    lastTriggerElement.focus()
    lastTriggerElement = null
  }
}

const canSubmitStatusChange = computed(() => {
  const order = selectedOrder.value
  if (
    !order ||
    isSaving.value ||
    !nextStatusSelection.value ||
    selectedOrderId.value !== order.idPedido
  ) {
    return false
  }
  return order.estadosPermitidos.includes(nextStatusSelection.value)
})

function clearDeferredOrderReconcileTimer() {
  if (deferredOrderReconcileTimer !== undefined) {
    clearTimeout(deferredOrderReconcileTimer)
    deferredOrderReconcileTimer = undefined
  }
}

function pruneExpiredRecentLocalOrderSaves(now: number) {
  for (const [id, entry] of recentLocalOrderSaves) {
    if (now >= entry.until) {
      recentLocalOrderSaves.delete(id)
    }
  }
}

function resetRealtimeTracking() {
  clearDeferredOrderReconcileTimer()
  inFlightOrderTargets.clear()
  recentLocalOrderSaves.clear()
  pendingExternalOrderIds.clear()
}

function scheduleDeferredOrderReconcile(session: string, delayMs: number) {
  clearDeferredOrderReconcileTimer()
  deferredOrderReconcileTimer = setTimeout(() => {
    deferredOrderReconcileTimer = undefined
    if (!isCurrentSession(session)) return
    const now = Date.now()
    pruneExpiredRecentLocalOrderSaves(now)
    const readyIds: number[] = []
    for (const id of pendingExternalOrderIds) {
      if (!inFlightOrderTargets.has(id) && !recentLocalOrderSaves.has(id)) {
        readyIds.push(id)
      }
    }
    for (const id of readyIds) {
      pendingExternalOrderIds.delete(id)
    }
    if (readyIds.length > 0) {
      reconcileList(session)
      const currentId = selectedOrderId.value
      if (showModal.value && currentId !== null && !isSaving.value && readyIds.includes(currentId)) {
        void refreshOpenOrderDetail(currentId)
      }
    }
    let nextDelay: number | undefined
    for (const id of pendingExternalOrderIds) {
      const entry = recentLocalOrderSaves.get(id)
      if (entry && !inFlightOrderTargets.has(id)) {
        const remaining = Math.max(0, entry.until - now)
        nextDelay = nextDelay === undefined ? remaining : Math.min(nextDelay, remaining)
      }
    }
    if (nextDelay !== undefined) {
      scheduleDeferredOrderReconcile(session, nextDelay)
    }
  }, Math.max(0, delayMs))
}

async function submitStatusChange() {
  const targetId = selectedOrderId.value
  const order = selectedOrder.value
  const targetOpening = currentModalOpeningId.value
  const targetStatus = nextStatusSelection.value

  if (
    !targetId ||
    !order ||
    order.idPedido !== targetId ||
    !targetStatus ||
    !canSubmitStatusChange.value
  ) {
    return
  }

  inFlightOrderTargets.set(targetId, targetStatus)
  recentLocalOrderSaves.delete(targetId)
  pendingExternalOrderIds.delete(targetId)
  savingOpeningId.value = targetOpening
  statusFeedback.value = null
  const session = identity()
  const isCurrentModal = () => isCurrentSession(session) &&
    targetOpening === currentModalOpeningId.value && selectedOrderId.value === targetId
  let savedStatus: string | null = null
  let authRejected = false

  try {
    const updated = await updateAdminOrderStatus(targetId, targetStatus)
    savedStatus = updated.estado
    reconcileList(session)
    if (isCurrentSession(session)) {
      recentLocalOrderSaves.set(targetId, { status: updated.estado, until: Date.now() + 1500 })
    }
    if (!isCurrentModal()) return

    await detail.load(async () => updated)
    if (!isCurrentModal()) return

    nextStatusSelection.value = updated.estadosPermitidos[0] ?? ''
    statusFeedback.value = {
      text: `Estado actualizado a ${formatAdminOrderStatus(updated.estado)}.`,
      error: false,
    }
  } catch (error: unknown) {
    const { message, status } = resolveErrorMessage(error, 'mutation')
    authRejected = status === 401 || status === 403
    if (!authRejected) {
      reconcileList(session)
    }
    if (!isCurrentModal()) return
    statusFeedback.value = { text: message, error: true }

    if (status === undefined || status === 409 || status >= 500) {
      await detail.load(signal => getAdminOrderDetail(targetId, signal))
      const fresh = detail.data.value
      if (fresh && fresh.idPedido === targetId) {
        savedStatus = fresh.estado
      }
      if (fresh && isCurrentModal()) {
        nextStatusSelection.value = fresh.estadosPermitidos[0] ?? ''
      }
    }
  } finally {
    if (savingOpeningId.value === targetOpening) {
      savingOpeningId.value = null
    }
    inFlightOrderTargets.delete(targetId)
    if (savedStatus && isCurrentSession(session)) {
      recentLocalOrderSaves.set(targetId, { status: savedStatus, until: Date.now() + 1500 })
    }
    const hadPendingExternal = pendingExternalOrderIds.delete(targetId)
    if (hadPendingExternal && !authRejected && isCurrentSession(session)) {
      reconcileList(session)
      if (showModal.value && selectedOrderId.value === targetId && !isSaving.value) {
        void refreshOpenOrderDetail(targetId)
      }
    }
  }
}

async function refreshOpenOrderDetail(orderId: number) {
  const targetOpening = currentModalOpeningId.value
  await detail.load(signal => getAdminOrderDetail(orderId, signal), { keepData: true })
  if (targetOpening !== currentModalOpeningId.value || selectedOrderId.value !== orderId) {
    return
  }
  const fresh = detail.data.value
  if (fresh && fresh.idPedido === orderId) {
    if (!nextStatusSelection.value || !fresh.estadosPermitidos.includes(nextStatusSelection.value)) {
      nextStatusSelection.value = fresh.estadosPermitidos[0] ?? ''
    }
  }
}

onRealtime(change => {
  if (!allowed()) return
  const now = Date.now()
  pruneExpiredRecentLocalOrderSaves(now)

  const session = identity()
  const externalOrderIds: number[] = []
  let deferredDelay: number | undefined

  for (const id of change.orders) {
    const incomingStatus = change.orderStatuses?.get(id)

    if (inFlightOrderTargets.has(id)) {
      if (incomingStatus !== undefined && incomingStatus === inFlightOrderTargets.get(id)) {
        continue
      }
      pendingExternalOrderIds.add(id)
      continue
    }

    const recentEntry = recentLocalOrderSaves.get(id)
    if (recentEntry && now < recentEntry.until) {
      if (incomingStatus !== undefined && incomingStatus === recentEntry.status) {
        recentLocalOrderSaves.delete(id)
        continue
      }
      if (incomingStatus !== undefined && incomingStatus !== recentEntry.status) {
        recentLocalOrderSaves.delete(id)
        externalOrderIds.push(id)
        continue
      }
      pendingExternalOrderIds.add(id)
      const remaining = Math.max(0, recentEntry.until - now)
      deferredDelay = deferredDelay === undefined ? remaining : Math.min(deferredDelay, remaining)
      continue
    }

    externalOrderIds.push(id)
  }

  if (deferredDelay !== undefined) {
    scheduleDeferredOrderReconcile(session, deferredDelay)
  }

  if (change.reconnect) {
    clearDeferredOrderReconcileTimer()
    for (const id of [...pendingExternalOrderIds]) {
      if (!inFlightOrderTargets.has(id)) {
        pendingExternalOrderIds.delete(id)
      }
    }
  }

  if (change.reconnect || externalOrderIds.length > 0 || change.receipts || change.payments) {
    reconcileList(session)
  }
  const currentId = selectedOrderId.value
  if (
    showModal.value &&
    currentId !== null &&
    !isSaving.value &&
    (change.reconnect || externalOrderIds.includes(currentId) || change.receipts || change.payments)
  ) {
    void refreshOpenOrderDetail(currentId)
  }
})

watch(
  () => [identity(), auth.loggingOut, auth.loggingIn],
  () => {
    currentModalOpeningId.value++
    savingOpeningId.value = null
    queuedListRefresh = undefined
    resetRealtimeTracking()
    list.reset()
    detail.reset()
    showModal.value = false
    selectedOrderId.value = null
    searchInput.value = ''
    statusInput.value = ''
    paymentModeInput.value = ''
    dateInput.value = ''
    validationError.value = ''
    activeFilters = { page: 1, limit: 20 }
    if (allowed()) void loadList(1)
  },
  { flush: 'sync' },
)

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  const query = route.query.q
  if (typeof query === 'string' && query.trim().length <= 100) searchInput.value = query
  if (allowed()) applyFilters()
})

onBeforeUnmount(() => {
  disposed = true
  resetRealtimeTracking()
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <section
    v-if="allowed()"
    class="admin-orders min-w-0 max-w-7xl text-[#0b2438]"
    aria-labelledby="admin-orders-title"
  >
    <header class="mb-6">
      <h1 id="admin-orders-title" class="m-0 mb-1 text-[28px] font-semibold text-[#0B2438]">Pedidos</h1>
    </header>

    <!-- Barra de Filtros Superior -->
    <div class="mb-6 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 shadow-xs">
      <form class="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Filtros de pedidos" @submit.prevent="applyFilters">
        <label class="min-w-0">
          <span class="mb-1 block text-xs font-semibold text-slate-600">Buscar pedido o cliente</span>
          <input
            v-model="searchInput"
            type="search"
            maxlength="100"
            aria-label="Buscar pedidos por empresa, ID o CUIT"
            placeholder="Nombre, ID, email o CUIT"
            class="h-10 w-full rounded-xl border border-[#E2E8F0] bg-white pl-4 pr-4 text-sm text-[#0B2438] placeholder-slate-400 focus:border-[#145A8D] focus:outline-none focus:ring-1 focus:ring-[#145A8D]"
          />
        </label>

        <label class="min-w-0">
          <span class="mb-1 block text-xs font-semibold text-slate-600">Estado del pedido</span>
          <select
            v-model="statusInput"
            aria-label="Filtrar por estado del pedido"
            class="h-10 rounded-xl border border-[#E2E8F0] bg-white px-3 text-sm font-medium text-slate-700 focus:border-[#145A8D] focus:outline-none"
          >
            <option value="">Todos los estados</option>
            <option value="CONFIRMADO">Confirmado</option>
            <option value="EN_PREPARACION">En preparación</option>
            <option value="ENVIADO">Enviado</option>
            <option value="ENTREGADO">Entregado</option>
            <option value="DEMO_REGISTRADO">DEMO Registrado</option>
          </select>
        </label>

        <label class="min-w-0">
          <span class="mb-1 block text-xs font-semibold text-slate-600">Modalidad de pago</span>
          <select v-model="paymentModeInput" aria-label="Filtrar por modalidad de pago" class="h-10 w-full rounded-xl border border-[#E2E8F0] bg-white px-3 text-sm font-medium text-slate-700 focus:border-[#145A8D] focus:outline-none">
            <option value="">Todas las modalidades</option>
            <option value="TRANSFERENCIA">Transferencia bancaria</option>
            <option value="CUENTA_CORRIENTE">Cuenta corriente</option>
            <option value="DEMO_DIRECTO">Pago directo (DEMO)</option>
            <option value="DEMO_CUENTA_CORRIENTE">Cuenta corriente (DEMO)</option>
          </select>
        </label>

        <label class="min-w-0">
          <span class="mb-1 block text-xs font-semibold text-slate-600">Fecha del pedido (Argentina)</span>
          <input
            v-model="dateInput"
            type="date"
            aria-label="Filtrar por fecha"
            class="h-10 rounded-xl border border-[#E2E8F0] bg-white px-3 text-sm text-slate-700 focus:border-[#145A8D] focus:outline-none"
          />
        </label>

        <div class="flex flex-wrap gap-3 sm:col-span-2 xl:col-span-4">
        <button
          type="submit"
          class="h-10 rounded-xl border border-transparent bg-[#145A8D] px-5 text-sm font-bold text-white transition-colors hover:bg-[#103A5C]"
        >
          Filtrar
        </button>
        <button
          type="button"
          class="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          @click="clearFilters"
        >
          Limpiar
        </button>
        </div>
      </form>
    </div>

    <p v-if="validationError" role="alert" class="mb-4 text-sm font-semibold text-red-600">{{ validationError }}</p>

    <p v-if="list.loading.value && !ordersPage" role="status" class="py-8 text-center text-slate-500">Cargando pedidos…</p>

    <div v-else-if="list.error.value" class="mb-6 rounded-xl border border-slate-200 bg-[#F8FAFC] p-6 text-center">
      <p role="alert" class="m-0 mb-3 text-sm font-medium text-slate-700">{{ resolveErrorMessage(list.error.value, 'list').message }}</p>
      <button
        type="button"
        class="box-border cursor-pointer rounded-lg border-0 bg-[#145A8D] px-4 py-2 font-[inherit] text-sm font-bold text-white hover:bg-[#103A5C]"
        @click="loadList()"
      >
        Reintentar consulta
      </button>
    </div>

    <div v-else-if="ordersPage" class="orders-results">
      <p v-if="ordersPage.items.length" class="text-xs text-slate-500 sm:hidden">Deslizá la tabla para ver todas las columnas.</p>
      <div v-if="ordersPage.items.length === 0" role="status" class="py-12 text-center text-slate-500">
        No se encontraron pedidos registrados para los filtros seleccionados.
      </div>

      <div
        v-else
        class="orders-table overflow-auto rounded-xl border border-[#E2E8F0] bg-white shadow-xs"
        role="region"
        aria-label="Listado de pedidos"
        :aria-busy="list.loading.value"
        tabindex="0"
      >
        <table class="w-full min-w-[920px] border-collapse text-left">
          <caption class="sr-only">Pedidos registrados, con estado comercial del pedido, estado documental de comprobantes y estado financiero del pago por separado.</caption>
          <thead>
            <tr class="border-b border-[#E2E8F0] bg-[#F8FAFC] text-xs font-semibold text-slate-600">
              <th class="py-3.5 pl-6 pr-4">Pedido</th>
              <th class="px-4 py-3.5">Fecha</th>
              <th class="px-4 py-3.5">Cliente/Empresa</th>
              <th class="px-4 py-3.5 text-right">Total</th>
              <th class="px-4 py-3.5">Modalidad de pago</th>
              <th class="px-4 py-3.5">Estado del pedido</th>
              <th class="px-4 py-3.5">Comprobantes</th>
              <th class="px-4 py-3.5">Estado financiero</th>
              <th class="sticky right-0 z-10 bg-[#F8FAFC] py-3.5 pl-4 pr-6 text-left">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#E2E8F0] text-sm">
            <tr
              v-for="order in ordersPage.items"
              :key="order.idPedido"
              class="group transition-colors hover:bg-slate-50/70"
            >
              <td class="whitespace-nowrap py-3 pl-6 pr-4 font-semibold text-[#0B2438]">
                #{{ String(order.idPedido).padStart(2, '0') }}
                <span v-if="order.origen === 'DEMO'" class="ml-1 text-[11px] font-normal text-slate-600">(DEMO)</span>
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-slate-600">{{ formatDate(order.fecha) }}</td>
              <td class="px-4 py-3 font-medium text-[#0B2438]">
                <div>{{ order.cliente.nombreRazonSocial }}</div>
                <div class="text-xs font-normal text-slate-500">
                  {{ order.cliente.tipoCliente }}
                  <template v-if="order.cliente.cuit"> · {{ order.cliente.cuit }}</template>
                </div>
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-[#0B2438]">
                {{ formatAdminOrderMoney(order.total, order.moneda) }}
              </td>
              <td class="px-4 py-3 text-slate-700">{{ formatAdminOrderPaymentMode(order.modalidadPago) }}</td>
              <td class="whitespace-nowrap px-4 py-3">
                <AdminOrderStatusBadge :status="resolveOrderCommercialState(order)" />
              </td>
              <td class="px-4 py-3">
                <AdminOrderReceiptSummary
                  :estado-documental="order.estadoDocumental"
                  :summary="order.comprobantes"
                />
              </td>
              <td class="max-w-[240px] px-4 py-3">
                <OrderFinancialStatusBadge
                  :status="order.estadoFinanciero"
                  :monto-acreditado-usd="order.montoAcreditadoUSD"
                  compact
                />
              </td>
              <td class="sticky right-0 bg-white transition-colors group-hover:bg-slate-50 whitespace-nowrap py-3 pl-4 pr-6 text-left">
                <button
                  type="button"
                  class="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-[#103A5C] hover:bg-slate-50"
                  :aria-label="`Ver detalle del pedido ${order.idPedido}`"
                  @click="openOrderDetailModal(order.idPedido, $event)"
                >
                  Ver detalle
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <AdminOrdersPagination :summary="visibleRange" :pagination="ordersPage.pagination" :loading="list.loading.value" @navigate="page => loadList(page, true)" />
    </div>

    <!-- Modal con Trampa de Foco Accesible (H-02) -->
    <div
      v-if="showModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-[#0B2438]/70 p-2 sm:p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      :aria-label="`Detalle del Pedido ${selectedOrderId}`"
    >
      <div
        ref="modalDialogRef"
        class="flex max-h-[90dvh] w-full max-w-[calc(100vw-1rem)] sm:max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl"
        tabindex="-1"
      >
        <!-- Header -->
        <div class="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-2 sm:px-5">
          <h2 class="text-lg sm:text-xl font-bold text-[#0B2438]">
            Pedido #{{ selectedOrderId }}
          </h2>
          <button
            ref="modalCloseBtn"
            type="button"
            class="detail-close flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white p-0 text-2xl leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-[#145a8d]"
            aria-label="Cerrar modal"
            @click="closeModal"
          >
            &times;
          </button>
        </div>

        <!-- Cuerpo del Modal -->
        <div class="min-h-0 flex-1 overflow-y-auto break-words p-3 sm:p-4">
          <p v-if="detail.loading.value && !selectedOrder" role="status" class="py-6 text-center text-slate-500">Cargando información del pedido…</p>

          <div v-else-if="detail.error.value" class="rounded-xl border border-red-200 bg-red-50 p-4 text-center text-red-700">
            <p role="alert" class="m-0 mb-3 text-sm font-semibold">{{ resolveErrorMessage(detail.error.value, 'detail').message }}</p>
            <button
              type="button"
              class="box-border cursor-pointer rounded-lg border-0 bg-[#145A8D] px-3 py-1.5 font-[inherit] text-xs font-bold text-white hover:bg-[#103A5C]"
              @click="selectedOrderId && openOrderDetailModal(selectedOrderId)"
            >
              Reintentar
            </button>
          </div>

          <template v-else-if="selectedOrder && selectedOrder.idPedido === selectedOrderId">
            <!-- Datos del Cliente y Operación -->
            <div class="detail-summary mb-4 grid grid-cols-1 gap-x-6 gap-y-4 rounded-xl bg-[#F8FAFC] p-4 text-sm sm:grid-cols-2">
              <div>
                <span class="block text-xs font-semibold uppercase text-slate-500">Cliente</span>
                <span class="detail-value">{{ selectedOrder.cliente.nombreRazonSocial }}</span>
                <div class="text-xs text-slate-500">
                  {{ selectedOrder.cliente.cuit ? `CUIT: ${selectedOrder.cliente.cuit}` : (selectedOrder.cliente.documento ?? '') }}
                </div>
              </div>
              <div>
                <span class="block text-xs font-semibold uppercase text-slate-500">Contacto</span>
                <div class="detail-value">{{ selectedOrder.cliente.email ?? 'Sin email' }}</div>
                <div class="detail-value">{{ selectedOrder.cliente.telefono ?? 'Sin teléfono' }}</div>
              </div>
              <div>
                <span class="block text-xs font-semibold uppercase text-slate-500">Fecha</span>
                <span class="detail-value">{{ formatDate(selectedOrder.fecha) }}</span>
              </div>
              <div>
                <span class="block text-xs font-semibold uppercase text-slate-500">Modalidad</span>
                <span class="detail-value">{{ formatAdminOrderPaymentMode(selectedOrder.modalidadPago) }}</span>
              </div>
              <div class="flex items-center justify-between gap-3 border-t border-slate-200 pt-3 sm:col-span-2">
                <span class="text-xs font-semibold uppercase text-slate-500">Total</span>
                <div class="text-lg font-semibold text-[#103A5C]">
                  {{ formatAdminOrderMoney(selectedOrder.total, selectedOrder.moneda) }}
                </div>
              </div>
            </div>

            <!-- Seguimiento de Estado -->
            <div class="mb-4 rounded-xl border border-slate-200 bg-white p-4">
              <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h3 class="m-0 text-sm font-semibold text-[#0B2438]">Estado del pedido (comercial / logístico)</h3>
                <AdminOrderStatusBadge :status="resolveOrderCommercialState(selectedOrder)" />
              </div>
              <template v-if="selectedOrder.estadosPermitidos.length > 0">
                <div class="detail-status-controls flex flex-wrap items-center gap-3">
                  <select
                    v-model="nextStatusSelection"
                    aria-label="Seleccionar nuevo estado de pedido"
                    class="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-[#0B2438]"
                    :disabled="isSaving"
                  >
                    <option
                      v-for="nextState in selectedOrder.estadosPermitidos"
                      :key="nextState"
                      :value="nextState"
                    >
                      {{ formatAdminOrderStatus(nextState) }}
                    </option>
                  </select>
                  <button
                    type="button"
                    :disabled="!canSubmitStatusChange"
                    class="h-11 rounded-lg border border-transparent bg-[#145A8D] px-4 text-sm font-semibold text-white hover:bg-[#103A5C] disabled:opacity-50"
                    @click="submitStatusChange"
                  >
                    {{ isSaving ? 'Guardando…' : 'Guardar Estado' }}
                  </button>
                </div>
                <p class="m-0 mt-2 text-xs text-slate-500">
                  Cambiar el estado logístico del pedido no acredita pagos ni modifica saldos.
                </p>
              </template>
              <p v-else class="m-0 text-xs text-slate-500">
                Este pedido se encuentra en estado {{ formatAdminOrderStatus(resolveOrderCommercialState(selectedOrder)) }} y no admite transiciones manuales.
              </p>
              <p
                v-if="statusFeedback"
                role="alert"
                class="mt-2 text-xs font-semibold"
                :class="statusFeedback.error ? 'text-red-600' : 'text-emerald-700'"
              >
                {{ statusFeedback.text }}
              </p>
              <div class="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-3 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div>
                  <span class="block font-semibold text-[#0B2438]">Estado documental (comprobantes)</span>
                  <span class="block text-xs text-slate-500">La revisión documental no acredita fondos.</span>
                </div>
                <AdminOrderReceiptSummary
                  :estado-documental="selectedOrder.estadoDocumental"
                  :summary="selectedOrder.comprobantes"
                />
              </div>
              <div class="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-3 text-sm">
                <span class="font-semibold text-[#0B2438]">Estado financiero (pago / acreditación)</span>
                <OrderFinancialStatusBadge
                  :status="selectedOrder.estadoFinanciero"
                  :monto-acreditado-usd="selectedOrder.montoAcreditadoUSD"
                  :document-status="selectedOrder.estadoDocumental"
                  show-explanation
                />
              </div>
            </div>

            <!-- Líneas de Artículos -->
            <h3 class="mb-2 text-sm font-bold uppercase tracking-wider text-slate-700">Artículos</h3>
            <div class="overflow-x-auto rounded-lg border border-slate-200 text-xs">
              <table class="w-full min-w-[280px] text-left">
                <thead class="bg-[#F8FAFC] text-slate-500">
                  <tr>
                    <th class="p-2">Código</th>
                    <th class="p-2">Producto</th>
                    <th class="p-2 text-center">Cant.</th>
                    <th class="p-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200">
                  <tr v-for="item in selectedOrder.items" :key="item.idDetallePedido">
                    <td class="p-2 font-mono text-slate-600">{{ item.codigoProducto }}</td>
                    <td class="p-2 font-medium text-[#0B2438]">{{ item.nombreProducto }}</td>
                    <td class="p-2 text-center">{{ item.cantidad }}</td>
                    <td class="p-2 text-right font-bold text-[#0B2438]">
                      {{ formatAdminOrderMoney(item.subtotal, selectedOrder.moneda) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>

        <!-- Footer -->
        <div class="shrink-0 border-t border-slate-200 bg-[#F8FAFC] px-4 py-3 sm:px-6 text-right">
          <button
            type="button"
            class="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[#145a8d]"
            @click="closeModal"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.admin-orders :is(button, input, select) { box-sizing: border-box; min-height: 44px; font-family: inherit; }
.admin-orders button:not(:disabled), .admin-orders select:not(:disabled) { cursor: pointer; }
.admin-orders button:disabled { cursor: not-allowed; }
.admin-orders form :is(input, select) { width: 100%; min-width: 0; max-width: 100%; }
.admin-orders :is(button, input, select, a, [tabindex]):focus-visible {
  outline: 2px solid #145a8d;
  outline-offset: 3px;
}
.admin-orders th { white-space: nowrap; }
.detail-summary .uppercase { margin-bottom: 4px; text-transform: none; font-size: 12px; font-weight: 600; color: #64748b; }
.detail-value { color: #0b2438; font-size: 14px; font-weight: 500; line-height: 1.5; }
.detail-close { box-sizing: border-box; flex: 0 0 44px; }
@media (max-width: 639px) { .detail-status-controls > :is(select, button) { flex: 1 1 100%; width: 100%; } }
.admin-orders thead th { font-size: 12px; font-weight: 600; line-height: 1.5; vertical-align: middle; }
.orders-results { min-width: 0; }
@media (min-width: 800px) and (min-height: 640px) {
  :global(.admin-frame:has(.admin-orders)) { height: 100dvh; min-height: 0; overflow: hidden; }
  :global(.admin-main:has(.admin-orders)) { height: 100%; min-height: 0; box-sizing: border-box; overflow: hidden; }
  .admin-orders { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .admin-orders > :not(.orders-results) { flex-shrink: 0; }
  .orders-results { display: flex; flex: 1; flex-direction: column; min-height: 0; }
  .orders-table { flex: 1; min-height: 0; }
  .orders-table thead th { position: sticky; top: 0; z-index: 10; background: #f8fafc; box-shadow: inset 0 -1px #e2e8f0; }
  .orders-table thead th:last-child { z-index: 20; }
}
</style>
