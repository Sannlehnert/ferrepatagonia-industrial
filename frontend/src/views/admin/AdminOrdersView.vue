<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import axios from 'axios'
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
import type {
  AdminOrderDetail,
  AdminOrderFilterStatus,
  AdminOrderListResponse,
  AdminOrderOperationalStatus,
  AdminOrderQueryFilters,
} from '@/types/adminOrder'

const auth = useAuthStore()
const allowed = () => auth.rol === 'ADMIN' && !auth.loggingOut && !auth.loggingIn
const identity = () => `${auth.user?.id}:${auth.rol}:${auth.sessionVersion}`

const list = usePrivateAccountRead<AdminOrderListResponse>(identity, allowed)
const detail = usePrivateAccountRead<AdminOrderDetail>(identity, allowed)

// Filtros
const searchInput = ref('')
const statusInput = ref<AdminOrderFilterStatus | ''>('')
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

const ordersPage = computed(() => list.data.value)
const selectedOrder = computed(() => detail.data.value)

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
  return list.load(signal => getAdminOrders(filters, signal), { keepData })
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
    ...(dateInput.value ? { fecha: dateInput.value } : {}),
    ...(rawQuery ? { q: rawQuery } : {}),
  }

  void loadList(1)
}

function clearFilters() {
  searchInput.value = ''
  statusInput.value = ''
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

  savingOpeningId.value = targetOpening
  statusFeedback.value = null
  const session = identity()
  const isCurrentModal = () => isCurrentSession(session) &&
    targetOpening === currentModalOpeningId.value && selectedOrderId.value === targetId

  try {
    const updated = await updateAdminOrderStatus(targetId, targetStatus)
    reconcileList(session)
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
    if (status !== 401 && status !== 403) reconcileList(session)
    if (!isCurrentModal()) return
    statusFeedback.value = { text: message, error: true }

    if (status === undefined || status === 409 || status >= 500) {
      await detail.load(signal => getAdminOrderDetail(targetId, signal))
      const fresh = detail.data.value
      if (fresh && isCurrentModal()) {
        nextStatusSelection.value = fresh.estadosPermitidos[0] ?? ''
      }
    }
  } finally {
    if (savingOpeningId.value === targetOpening) {
      savingOpeningId.value = null
    }
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'CONFIRMADO':
      return 'bg-[#FEF3C7] text-[#D97706] border border-[#FDE68A]'
    case 'EN_PREPARACION':
      return 'bg-amber-100 text-amber-800 border border-amber-200'
    case 'ENVIADO':
      return 'bg-[#E0F2FE] text-[#0369A1] border border-[#BAE6FD]'
    case 'ENTREGADO':
      return 'bg-[#DCFCE7] text-[#16A34A] border border-[#BBF7D0]'
    default:
      return 'bg-[#F1F5F9] text-[#64748B] border border-[#E2E8F0]'
  }
}

watch(
  () => [identity(), auth.loggingOut, auth.loggingIn],
  () => {
    currentModalOpeningId.value++
    savingOpeningId.value = null
    list.reset()
    detail.reset()
    showModal.value = false
    selectedOrderId.value = null
    searchInput.value = ''
    statusInput.value = ''
    dateInput.value = ''
    validationError.value = ''
    activeFilters = { page: 1, limit: 20 }
    if (allowed()) void loadList(1)
  },
  { flush: 'sync' },
)

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  if (allowed()) void loadList(1)
})

onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <section
    v-if="allowed()"
    class="min-w-0 text-[#0b2438]"
    aria-labelledby="admin-orders-title"
  >
    <header class="mb-6">
      <h1 id="admin-orders-title" class="m-0 mb-1 text-[28px] font-semibold text-[#0B2438]">Pedidos</h1>
      <p class="m-0 text-sm text-slate-500">
        Consulta de operaciones confirmadas, detalle de pedido/cliente y seguimiento de estados autorizados.
      </p>
    </header>

    <!-- Barra de Filtros Superior -->
    <div class="mb-6 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 shadow-xs">
      <form class="flex flex-wrap items-center gap-3" @submit.prevent="applyFilters">
        <div class="relative min-w-[200px] flex-1">
          <input
            v-model="searchInput"
            type="search"
            maxlength="100"
            aria-label="Buscar pedidos por empresa, ID o CUIT"
            placeholder="Ingrese Empresa o ID"
            class="h-10 w-full rounded-xl border border-[#E2E8F0] bg-white pl-4 pr-4 text-sm text-[#0B2438] placeholder-slate-400 focus:border-[#145A8D] focus:outline-none focus:ring-1 focus:ring-[#145A8D]"
          />
        </div>

        <div class="relative">
          <select
            v-model="statusInput"
            aria-label="Filtrar por estado del pedido"
            class="h-10 rounded-xl border border-[#E2E8F0] bg-white px-3 text-sm font-medium text-slate-700 focus:border-[#145A8D] focus:outline-none"
          >
            <option value="">Estado del Pedido</option>
            <option value="CONFIRMADO">Pendiente / Confirmado</option>
            <option value="EN_PREPARACION">En preparación</option>
            <option value="ENVIADO">Enviado</option>
            <option value="ENTREGADO">Entregado</option>
            <option value="DEMO_REGISTRADO">DEMO Registrado</option>
          </select>
        </div>

        <input
          v-model="dateInput"
          type="date"
          aria-label="Filtrar por fecha"
          class="h-10 rounded-xl border border-[#E2E8F0] bg-white px-3 text-sm text-slate-700 focus:border-[#145A8D] focus:outline-none"
        />

        <button
          type="submit"
          class="h-10 rounded-xl bg-[#145A8D] px-5 text-sm font-bold text-white transition-colors hover:bg-[#103A5C]"
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
      </form>
    </div>

    <p v-if="validationError" role="alert" class="mb-4 text-sm font-semibold text-red-600">{{ validationError }}</p>

    <p v-if="list.loading.value && !ordersPage" role="status" class="py-8 text-center text-slate-500">Cargando pedidos…</p>

    <div v-else-if="list.error.value" class="mb-6 rounded-xl border border-slate-200 bg-[#F8FAFC] p-6 text-center">
      <p role="alert" class="m-0 mb-3 text-sm font-medium text-slate-700">{{ resolveErrorMessage(list.error.value, 'list').message }}</p>
      <button
        type="button"
        class="rounded-lg bg-[#145A8D] px-4 py-2 text-sm font-bold text-white hover:bg-[#103A5C]"
        @click="loadList()"
      >
        Reintentar consulta
      </button>
    </div>

    <template v-else-if="ordersPage">
      <div v-if="ordersPage.items.length === 0" role="status" class="py-12 text-center text-slate-500">
        No se encontraron pedidos registrados para los filtros seleccionados.
      </div>

      <div
        v-else
        class="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-xs"
        role="region"
        aria-label="Listado de pedidos"
        tabindex="0"
      >
        <table class="w-full min-w-[750px] border-collapse text-left">
          <thead>
            <tr class="border-b border-[#E2E8F0] bg-[#F8FAFC] text-xs font-semibold uppercase tracking-wider text-slate-500">
              <th class="py-3.5 pl-6 pr-4">ID Pedido</th>
              <th class="px-4 py-3.5">Fecha</th>
              <th class="px-4 py-3.5">Cliente/Empresa</th>
              <th class="px-4 py-3.5">Monto Total</th>
              <th class="px-4 py-3.5">Método de Pago</th>
              <th class="px-4 py-3.5 text-center">Estado Pedido</th>
              <th class="py-3.5 pl-4 pr-6 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#E2E8F0] text-sm">
            <tr
              v-for="order in ordersPage.items"
              :key="order.idPedido"
              class="transition-colors hover:bg-slate-50/70"
            >
              <td class="whitespace-nowrap py-4 pl-6 pr-4 font-bold text-[#0B2438]">
                #{{ String(order.idPedido).padStart(2, '0') }}
                <span v-if="order.origen === 'DEMO'" class="ml-1 text-[11px] font-normal text-slate-400">(DEMO)</span>
              </td>
              <td class="whitespace-nowrap px-4 py-4 font-semibold text-[#0B2438]">{{ formatDate(order.fecha) }}</td>
              <td class="px-4 py-4 font-bold text-[#0B2438]">
                <div>{{ order.cliente.nombreRazonSocial }}</div>
                <div class="text-xs font-normal text-slate-500">
                  {{ order.cliente.tipoCliente }}
                  <template v-if="order.cliente.cuit"> · {{ order.cliente.cuit }}</template>
                </div>
              </td>
              <td class="whitespace-nowrap px-4 py-4 font-bold text-[#0B2438]">
                {{ formatAdminOrderMoney(order.total, order.moneda) }}
              </td>
              <td class="px-4 py-4 text-slate-700">{{ formatAdminOrderPaymentMode(order.modalidadPago) }}</td>
              <td class="whitespace-nowrap px-4 py-4 text-center">
                <span class="inline-block rounded-full px-3 py-1 text-xs font-bold" :class="statusBadgeClass(order.estado)">
                  {{ formatAdminOrderStatus(order.estado) }}
                </span>
              </td>
              <td class="whitespace-nowrap py-4 pl-4 pr-6 text-right">
                <button
                  type="button"
                  class="text-sm font-semibold text-[#0EA5E9] hover:underline"
                  :aria-label="`Ver detalle del pedido ${order.idPedido}`"
                  @click="openOrderDetailModal(order.idPedido, $event)"
                >
                  ver
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <nav
        v-if="ordersPage.pagination.totalPages > 1"
        class="mt-4 flex items-center justify-between text-sm text-slate-600"
        aria-label="Paginación"
      >
        <div>Página {{ ordersPage.pagination.page }} de {{ ordersPage.pagination.totalPages }}</div>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold disabled:opacity-40"
            :disabled="ordersPage.pagination.page <= 1"
            @click="loadList(ordersPage.pagination.page - 1)"
          >
            Anterior
          </button>
          <button
            type="button"
            class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold disabled:opacity-40"
            :disabled="ordersPage.pagination.page >= ordersPage.pagination.totalPages"
            @click="loadList(ordersPage.pagination.page + 1)"
          >
            Siguiente
          </button>
        </div>
      </nav>
    </template>

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
        <div class="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-4">
          <h2 class="text-lg sm:text-xl font-bold text-[#0B2438]">
            Pedido #{{ selectedOrderId }}
          </h2>
          <button
            ref="modalCloseBtn"
            type="button"
            class="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-2xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-[#145a8d]"
            aria-label="Cerrar modal"
            @click="closeModal"
          >
            &times;
          </button>
        </div>

        <!-- Cuerpo del Modal -->
        <div class="flex-1 overflow-y-auto p-4 sm:p-6">
          <p v-if="detail.loading.value" role="status" class="py-6 text-center text-slate-500">Cargando información del pedido…</p>

          <div v-else-if="detail.error.value" class="rounded-xl border border-red-200 bg-red-50 p-4 text-center text-red-700">
            <p role="alert" class="m-0 mb-3 text-sm font-semibold">{{ resolveErrorMessage(detail.error.value, 'detail').message }}</p>
            <button
              type="button"
              class="rounded-lg bg-[#145A8D] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#103A5C]"
              @click="selectedOrderId && openOrderDetailModal(selectedOrderId)"
            >
              Reintentar
            </button>
          </div>

          <template v-else-if="selectedOrder && selectedOrder.idPedido === selectedOrderId">
            <!-- Datos del Cliente y Operación -->
            <div class="mb-5 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-[#F8FAFC] p-4 text-sm">
              <div>
                <span class="block text-xs font-semibold uppercase text-slate-500">Cliente</span>
                <span class="font-bold text-[#0B2438]">{{ selectedOrder.cliente.nombreRazonSocial }}</span>
                <div class="text-xs text-slate-500">
                  {{ selectedOrder.cliente.cuit ? `CUIT: ${selectedOrder.cliente.cuit}` : (selectedOrder.cliente.documento ?? '') }}
                </div>
              </div>
              <div>
                <span class="block text-xs font-semibold uppercase text-slate-500">Contacto</span>
                <div class="text-xs text-[#0B2438]">{{ selectedOrder.cliente.email ?? 'Sin email' }}</div>
                <div class="text-xs text-slate-500">{{ selectedOrder.cliente.telefono ?? 'Sin teléfono' }}</div>
              </div>
              <div>
                <span class="block text-xs font-semibold uppercase text-slate-500">Fecha</span>
                <span class="font-semibold text-slate-700">{{ formatDate(selectedOrder.fecha) }}</span>
              </div>
              <div>
                <span class="block text-xs font-semibold uppercase text-slate-500">Modalidad</span>
                <span class="font-semibold text-[#0EA5E9]">{{ formatAdminOrderPaymentMode(selectedOrder.modalidadPago) }}</span>
              </div>
              <div class="sm:col-span-2 border-t border-slate-200 pt-2">
                <span class="text-xs font-semibold uppercase text-slate-500">Total</span>
                <div class="text-lg font-bold text-[#145A8D]">
                  {{ formatAdminOrderMoney(selectedOrder.total, selectedOrder.moneda) }}
                </div>
              </div>
            </div>

            <!-- Seguimiento de Estado -->
            <div class="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <h3 class="mb-3 text-sm font-bold uppercase tracking-wider text-slate-700">Seguimiento de Estado</h3>
              <div class="mb-2 text-xs text-slate-600">
                Estado actual: <strong>{{ formatAdminOrderStatus(selectedOrder.estado) }}</strong>
              </div>
              <template v-if="selectedOrder.estadosPermitidos.length > 0">
                <div class="flex flex-wrap items-center gap-3">
                  <select
                    v-model="nextStatusSelection"
                    aria-label="Seleccionar nuevo estado de pedido"
                    class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-[#0B2438]"
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
                    class="h-10 rounded-lg bg-[#145A8D] px-4 text-sm font-bold text-white hover:bg-[#103A5C] disabled:opacity-50"
                    @click="submitStatusChange"
                  >
                    {{ isSaving ? 'Guardando…' : 'Guardar Estado' }}
                  </button>
                </div>
              </template>
              <p v-else class="m-0 text-xs text-slate-500">
                Este pedido se encuentra en estado {{ formatAdminOrderStatus(selectedOrder.estado) }} y no admite transiciones manuales.
              </p>
              <p
                v-if="statusFeedback"
                role="alert"
                class="mt-2 text-xs font-semibold"
                :class="statusFeedback.error ? 'text-red-600' : 'text-emerald-700'"
              >
                {{ statusFeedback.text }}
              </p>
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
