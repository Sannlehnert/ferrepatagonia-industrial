<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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

// Filtros de la Top Bar de Figma
const searchInput = ref('')
const statusInput = ref<AdminOrderFilterStatus | ''>('')
const dateInput = ref('')
const validationError = ref('')

// Modal de Detalle / Seguimiento
const showModal = ref(false)
const selectedOrderId = ref<number | null>(null)
const nextStatusSelection = ref<AdminOrderOperationalStatus | ''>('')
const statusSaving = ref(false)
const statusFeedback = ref<{ text: string; error: boolean } | null>(null)

let activeFilters: AdminOrderQueryFilters = { page: 1, limit: 20 }

const ordersPage = computed(() => list.data.value)
const selectedOrder = computed(() => detail.data.value)

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
})

function formatDate(value: string): string {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime())
        ? value
        : dateFormatter.format(parsed)
}

function resolveErrorMessage(error: unknown, context: 'list' | 'detail' | 'mutation'): string {
    const response = axios.isAxiosError<{ message?: string }>(error)
        ? error.response
        : (error as { response?: { status?: number; data?: { message?: string } } })?.response
    const status = response?.status

    if (status === 401 || status === 403) {
        return 'La sesión actual no tiene permisos para administrar pedidos.'
    }
    if (status === 404) {
        return 'El pedido solicitado no existe.'
    }
    if (status === 400 || status === 409) {
        return response?.data?.message ?? 'La operación no es válida para el estado actual del pedido.'
    }
    if (context === 'mutation') {
        return 'No pudimos actualizar el estado del pedido. Verificá su estado e intentá nuevamente.'
    }
    if (context === 'detail') {
        return 'No pudimos cargar el detalle del pedido. Intentá nuevamente.'
    }
    return 'No pudimos consultar el listado de pedidos. Asegurate de que el backend esté iniciado.'
}

function loadList(page = activeFilters.page ?? 1) {
    activeFilters = { ...activeFilters, page }
    return list.load(signal => getAdminOrders(activeFilters, signal))
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

async function openOrderDetailModal(orderId: number) {
    selectedOrderId.value = orderId
    showModal.value = true
    statusFeedback.value = null
    nextStatusSelection.value = ''

    await detail.load(signal => getAdminOrderDetail(orderId, signal))
    const order = detail.data.value
    if (order && order.estadosPermitidos.length > 0) {
        nextStatusSelection.value = order.estadosPermitidos[0]!
    }
}

function closeModal() {
    showModal.value = false
    selectedOrderId.value = null
    detail.reset()
}

const canSubmitStatusChange = computed(() => {
    const order = selectedOrder.value
    if (!order || statusSaving.value || !nextStatusSelection.value) return false
    return order.estadosPermitidos.includes(nextStatusSelection.value)
})

async function submitStatusChange() {
    const order = selectedOrder.value
    if (!order || !canSubmitStatusChange.value || !nextStatusSelection.value) return

    statusSaving.value = true
    statusFeedback.value = null

    try {
        const updated = await updateAdminOrderStatus(order.idPedido, nextStatusSelection.value)
        if (!allowed()) return

        await detail.load(async () => updated)
        nextStatusSelection.value = updated.estadosPermitidos[0] ?? ''
        statusFeedback.value = {
            text: `Estado actualizado a ${formatAdminOrderStatus(updated.estado)}.`,
            error: false,
        }
        void loadList(activeFilters.page ?? 1)
    } catch (error: unknown) {
        if (!allowed()) return
        statusFeedback.value = {
            text: resolveErrorMessage(error, 'mutation'),
            error: true,
        }
    } finally {
        statusSaving.value = false
    }
}

// Clases de píldoras idénticas a Figma
function statusBadgeClass(status: string): string {
    switch (status) {
        case 'CONFIRMADO':
        case 'Pendiente':
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
    if (allowed()) void loadList(1)
})
</script>

<template>
    <section v-if="allowed()" class="min-w-0 text-[#0b2438]" aria-labelledby="admin-orders-title">
        <!-- Título y Bajada de la Sección -->
        <header class="mb-6">
            <h1 id="admin-orders-title" class="m-0 mb-1 text-[28px] font-semibold text-[#0B2438]">Pedidos</h1>
            <p class="m-0 text-sm text-slate-500">
                Consulta de operaciones confirmadas, detalle de pedido/cliente y seguimiento de estados autorizados.
            </p>
        </header>

        <!-- Barra de Filtros Superior Estilo Figma (Top Bar Pill) -->
        <div class="mb-6 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 shadow-sm">
            <form class="flex flex-wrap items-center gap-3" @submit.prevent="applyFilters">
                <!-- Buscador con Ícono de Lupa -->
                <div class="relative min-w-[260px] flex-1">
                    <span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </span>
                    <input
                        v-model="searchInput"
                        type="search"
                        maxlength="100"
                        placeholder="Ingrese Empresa o ID"
                        class="h-10 w-full rounded-xl border border-[#E2E8F0] bg-white pl-10 pr-4 text-sm text-[#0B2438] placeholder-slate-400 focus:border-[#145A8D] focus:outline-none focus:ring-1 focus:ring-[#145A8D]"
                    />
                </div>

                <!-- Dropdown: Estado del Pedido -->
                <div class="relative">
                    <select
                        v-model="statusInput"
                        class="h-10 appearance-none rounded-xl border border-[#E2E8F0] bg-white pl-4 pr-9 text-sm font-medium text-slate-700 focus:border-[#145A8D] focus:outline-none"
                    >
                        <option value="">Estado del Pedido</option>
                        <option value="CONFIRMADO">Pendiente / Confirmado</option>
                        <option value="EN_PREPARACION">En preparación</option>
                        <option value="ENVIADO">Enviado</option>
                        <option value="ENTREGADO">Entregado</option>
                        <option value="DEMO_REGISTRADO">DEMO Registrado</option>
                    </select>
                    <span class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                    </span>
                </div>

                <!-- Filtro de Fecha -->
                <input
                    v-model="dateInput"
                    type="text"
                    placeholder="Fecha"
                    onfocus="(this.type='date')"
                    onblur="if(!this.value)this.type='text'"
                    class="h-10 w-36 rounded-xl border border-[#E2E8F0] bg-white px-3 text-sm text-slate-700 placeholder-slate-400 focus:border-[#145A8D] focus:outline-none"
                />

                <!-- Botones de Acción de Filtro -->
                <button
                    type="submit"
                    class="h-10 rounded-xl bg-[#145A8D] px-5 text-sm font-bold text-white transition-colors hover:bg-[#103A5C] focus:outline-none focus:ring-2 focus:ring-[#145A8D]"
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

        <!-- Estado de Carga -->
        <p v-if="list.loading.value" role="status" class="py-8 text-center text-slate-500">Cargando pedidos…</p>

        <!-- Cartel de Error / Reintento -->
        <div v-else-if="list.error.value" class="mb-6 rounded-xl border border-slate-200 bg-[#F8FAFC] p-6 text-center">
            <p role="alert" class="m-0 mb-3 text-sm font-medium text-slate-700">{{ resolveErrorMessage(list.error.value, 'list') }}</p>
            <button
                type="button"
                class="rounded-lg bg-[#145A8D] px-4 py-2 text-sm font-bold text-white hover:bg-[#103A5C]"
                @click="loadList(1)"
            >
                Reintentar consulta
            </button>
        </div>

        <!-- Tabla Estilo Figma -->
        <template v-else-if="ordersPage">
            <div v-if="ordersPage.items.length === 0" role="status" class="py-12 text-center text-slate-500">
                No se encontraron pedidos registrados para los filtros seleccionados.
            </div>

            <div
                v-else
                class="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-sm"
                role="region"
                aria-label="Listado de pedidos"
                tabindex="0"
            >
                <table class="w-full min-w-[850px] border-collapse text-left">
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
                            <!-- ID Pedido -->
                            <td class="whitespace-nowrap py-4 pl-6 pr-4 font-bold text-[#0B2438]">
                                #{{ String(order.idPedido).padStart(2, '0') }}
                                <span v-if="order.origen === 'DEMO'" class="ml-1 text-[11px] font-normal text-slate-400">(DEMO)</span>
                            </td>

                            <!-- Fecha -->
                            <td class="whitespace-nowrap px-4 py-4 font-semibold text-[#0B2438]">
                                {{ formatDate(order.fecha) }}
                            </td>

                            <!-- Cliente/Empresa -->
                            <td class="px-4 py-4 font-bold text-[#0B2438]">
                                <div>{{ order.cliente.nombreRazonSocial }}</div>
                                <div class="text-xs font-normal text-slate-500">
                                    {{ order.cliente.tipoCliente }}
                                    <template v-if="order.cliente.cuit"> · {{ order.cliente.cuit }}</template>
                                </div>
                            </td>

                            <!-- Monto Total -->
                            <td class="whitespace-nowrap px-4 py-4 font-bold text-[#0B2438]">
                                {{ formatAdminOrderMoney(order.total, order.moneda) }}
                            </td>

                            <!-- Método de Pago -->
                            <td class="px-4 py-4">
                                <span
                                    v-if="order.modalidadPago.includes('CUENTA_CORRIENTE')"
                                    class="font-semibold leading-tight text-[#0EA5E9]"
                                >
                                    Cuenta<br />Corriente
                                </span>
                                <span v-else class="font-medium text-[#0B2438]">
                                    {{ formatAdminOrderPaymentMode(order.modalidadPago) }}
                                </span>
                            </td>

                            <!-- Estado Pedido (Badge semántico) -->
                            <td class="whitespace-nowrap px-4 py-4 text-center">
                                <span
                                    class="inline-block rounded-full px-3 py-1 text-xs font-bold"
                                    :class="statusBadgeClass(order.estado)"
                                >
                                    {{ formatAdminOrderStatus(order.estado) }}
                                </span>
                            </td>

                            <!-- Acciones (Ver / Lápiz de edición Figma) -->
                            <td class="whitespace-nowrap py-4 pl-4 pr-6 text-right">
                                <div class="flex items-center justify-end gap-3">
                                    <button
                                        type="button"
                                        class="text-sm font-semibold text-[#0EA5E9] hover:underline"
                                        @click="openOrderDetailModal(order.idPedido)"
                                    >
                                        ver
                                    </button>
                                    <button
                                        type="button"
                                        class="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#0B2438]"
                                        :aria-label="`Editar estado del pedido ${order.idPedido}`"
                                        @click="openOrderDetailModal(order.idPedido)"
                                    >
                                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                        </svg>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Paginación -->
            <nav
                v-if="ordersPage.pagination.totalPages > 1"
                class="mt-4 flex items-center justify-between text-sm text-slate-600"
                aria-label="Paginación"
            >
                <div>
                    Mostrando página {{ ordersPage.pagination.page }} de {{ ordersPage.pagination.totalPages }}
                </div>
                <div class="flex gap-2">
                    <button
                        type="button"
                        class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                        :disabled="ordersPage.pagination.page <= 1"
                        @click="loadList(ordersPage.pagination.page - 1)"
                    >
                        Anterior
                    </button>
                    <button
                        type="button"
                        class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                        :disabled="ordersPage.pagination.page >= ordersPage.pagination.totalPages"
                        @click="loadList(ordersPage.pagination.page + 1)"
                    >
                        Siguiente
                    </button>
                </div>
            </nav>
        </template>

        <!-- Modal de Auditoría / Detalle y Seguimiento (Estilo Figma) -->
        <div
            v-if="showModal"
            class="fixed inset-0 z-50 flex items-center justify-center bg-[#0B2438]/70 p-4 backdrop-blur-xs"
            role="dialog"
            aria-modal="true"
        >
            <div class="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
                <!-- Header del Modal -->
                <div class="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                    <h2 class="text-xl font-bold text-[#0B2438]">
                        Pedido #{{ selectedOrderId }}
                    </h2>
                    <button
                        type="button"
                        class="rounded-lg p-1 text-2xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        @click="closeModal"
                    >
                        &times;
                    </button>
                </div>

                <!-- Contenido con scroll -->
                <div class="flex-1 overflow-y-auto p-6">
                    <p v-if="detail.loading.value" role="status" class="py-6 text-center text-slate-500">Cargando información del pedido…</p>

                    <div v-else-if="detail.error.value" class="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
                        <p class="m-0 text-sm font-semibold">{{ resolveErrorMessage(detail.error.value, 'detail') }}</p>
                    </div>

                    <template v-else-if="selectedOrder">
                        <!-- Tarjetas de Resumen -->
                        <div class="mb-5 grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-[#F8FAFC] p-4 text-sm">
                            <div>
                                <span class="block text-xs font-semibold uppercase text-slate-500">Cliente</span>
                                <span class="font-bold text-[#0B2438]">{{ selectedOrder.cliente.nombreRazonSocial }}</span>
                            </div>
                            <div>
                                <span class="block text-xs font-semibold uppercase text-slate-500">Tipo de Cliente</span>
                                <span class="font-bold text-[#0B2438]">{{ selectedOrder.cliente.tipoCliente }}</span>
                            </div>
                            <div>
                                <span class="block text-xs font-semibold uppercase text-slate-500">Fecha</span>
                                <span class="font-semibold text-slate-700">{{ formatDate(selectedOrder.fecha) }}</span>
                            </div>
                            <div>
                                <span class="block text-xs font-semibold uppercase text-slate-500">Modalidad</span>
                                <span class="font-semibold text-[#0EA5E9]">{{ formatAdminOrderPaymentMode(selectedOrder.modalidadPago) }}</span>
                            </div>
                            <div class="col-span-2 border-t border-slate-200 pt-2 text-base">
                                <span class="text-xs font-semibold uppercase text-slate-500">Total</span>
                                <div class="font-bold text-[#145A8D]">{{ formatAdminOrderMoney(selectedOrder.total, selectedOrder.moneda) }}</div>
                            </div>
                        </div>

                        <!-- Panel de Cambio de Estado -->
                        <div class="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                            <h3 class="mb-3 text-sm font-bold uppercase tracking-wider text-slate-700">
                                Seguimiento de Estado
                            </h3>
                            <template v-if="selectedOrder.estadosPermitidos.length > 0">
                                <div class="flex flex-wrap items-center gap-3">
                                    <select
                                        v-model="nextStatusSelection"
                                        class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-[#0B2438]"
                                        :disabled="statusSaving"
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
                                        {{ statusSaving ? 'Guardando…' : 'Guardar Estado' }}
                                    </button>
                                </div>
                            </template>
                            <p v-else class="m-0 text-sm text-slate-500">
                                Este pedido se encuentra en estado {{ formatAdminOrderStatus(selectedOrder.estado) }} y no admite más transiciones.
                            </p>
                            <p
                                v-if="statusFeedback"
                                class="mt-2 text-sm font-semibold"
                                :class="statusFeedback.error ? 'text-red-600' : 'text-emerald-700'"
                            >
                                {{ statusFeedback.text }}
                            </p>
                        </div>

                        <!-- Líneas del Pedido -->
                        <h3 class="mb-2 text-sm font-bold uppercase tracking-wider text-slate-700">Artículos</h3>
                        <div class="overflow-hidden rounded-lg border border-slate-200 text-xs">
                            <table class="w-full text-left">
                                <thead class="bg-[#F8FAFC] text-slate-500">
                                    <tr>
                                        <th class="p-2.5">Código</th>
                                        <th class="p-2.5">Producto</th>
                                        <th class="p-2.5 text-center">Cant.</th>
                                        <th class="p-2.5 text-right">Subtotal</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-200">
                                    <tr v-for="item in selectedOrder.items" :key="item.idDetallePedido">
                                        <td class="p-2.5 font-mono text-slate-600">{{ item.codigoProducto }}</td>
                                        <td class="p-2.5 font-medium text-[#0B2438]">{{ item.nombreProducto }}</td>
                                        <td class="p-2.5 text-center">{{ item.cantidad }}</td>
                                        <td class="p-2.5 text-right font-bold text-[#0B2438]">
                                            {{ formatAdminOrderMoney(item.subtotal, selectedOrder.moneda) }}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </template>
                </div>

                <!-- Footer del Modal -->
                <div class="border-t border-slate-200 bg-[#F8FAFC] px-6 py-3 text-right">
                    <button
                        type="button"
                        class="h-10 rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        @click="closeModal"
                    >
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    </section>
</template>