<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterLink } from 'vue-router'
import CompanyStatus from '@/components/CompanyStatus.vue'
import DatosClientes from '@/views/cuenta/DatosClientes.vue'
import { useOrderReceiptSummaries } from '@/composables/useOrderReceiptSummaries'
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
const receipts = useOrderReceiptSummaries(() => orders.value)

function loadOrders() {
  return load(listClientOrders)
}

watch([identity, allowed], () => {
  void loadOrders()
}, { immediate: true })

onRealtime(change => {
  if (change.reconnect || change.orders.size > 0) {
    void load(listClientOrders, { keepData: true })
  }
})

const totalOrdersCount = computed(() => orders.value?.length ?? 0)
const creditOrdersCount = computed(() =>
  orders.value?.filter(o => o.modalidadPago === 'CUENTA_CORRIENTE').length ?? 0,
)
const pendingReceiptOrdersCount = computed(() =>
  orders.value?.filter(order =>
    receipts.status(order) === 'NO_ADJUNTO'
  ).length ?? 0,
)
const receiptError = computed(() => orders.value?.some(order => receipts.status(order) === 'ERROR') ?? false)
const ultimoPedidoFecha = computed(() => {
  const fecha = orders.value?.[0]?.fecha
  if (!fecha || !Number.isFinite(Date.parse(fecha))) return ''
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium', timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date(fecha))
})

const isCompany = computed(() => auth.user?.tipo_cliente === 'EMPRESA')
</script>

<template>
  <div class="min-w-0 space-y-6">
    <header>
      <h1 class="m-0 text-2xl font-bold text-[#0B2438]">Mi cuenta</h1>
      <p v-if="auth.user?.nombre" class="mb-0 mt-2 break-words text-base text-slate-700">
        Bienvenido/a, {{ auth.user.nombre }}
      </p>
    </header>

    <CompanyStatus />

    <div v-if="error" class="rounded-[10px] border border-[#E2E8F0] bg-white p-6 text-center shadow-sm space-y-3">
      <p role="alert" class="text-red-700 m-0">No se pudieron cargar las métricas de tus pedidos.</p>
      <button
        type="button"
        class="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[8px] border border-[#103A5C] bg-white px-4 text-sm font-semibold text-[#103A5C] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[#145A8D] cursor-pointer"
        @click="loadOrders()"
      >
        Reintentar
      </button>
    </div>

    <section aria-labelledby="account-summary-title">
      <h2 id="account-summary-title" class="mb-3 mt-0 text-lg font-bold text-[#0B2438]">Resumen de pedidos</h2>
      <p v-if="loading && !orders" role="status" class="mb-3 text-sm text-slate-700">
        Cargando resumen de pedidos…
      </p>
      <div v-if="receiptError && !error" class="mb-3 rounded-lg border border-amber-400 bg-amber-50 p-3">
        <p role="alert" class="m-0 text-sm text-amber-950">No se pudo consultar el estado de todos los comprobantes.</p>
        <button type="button" class="min-h-[44px] text-sm font-semibold text-[#103A5C] underline focus-visible:outline-2 focus-visible:outline-[#145A8D]" @click="receipts.refresh()">
          Reintentar comprobantes
        </button>
      </div>
      <div
        class="grid grid-cols-1 gap-4"
        :class="isCompany ? 'lg:grid-cols-3' : 'lg:grid-cols-2'"
      >
      <RouterLink
        :to="{ name: 'cuenta-pedidos' }"
        class="min-w-0 rounded-[10px] border border-[#CBD5E1] p-4 sm:p-5 shadow-sm bg-white flex flex-col justify-between hover:border-[#145A8D] hover:shadow-md transition-all no-underline text-inherit group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
      >
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold text-[#0B2438] text-base m-0 group-hover:text-[#145A8D] transition-colors">
            Pedidos Realizados
          </h3>
          <svg class="w-6 h-6 text-[#10B981]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
          </svg>
        </div>
        <div class="my-2 font-bold text-[#0B2438]" :class="error || (loading && !orders) ? 'text-xl' : 'text-4xl'">
          {{ error ? 'No disponible' : loading && !orders ? 'Cargando…' : totalOrdersCount }}
        </div>
        <p class="text-xs text-slate-500 m-0">
          Todos los estados{{ ultimoPedidoFecha ? ' · Último pedido: ' + ultimoPedidoFecha : '' }}
        </p>
        <span class="mt-3 text-sm font-semibold text-[#145A8D]">Ver pedidos →</span>
      </RouterLink>

      <RouterLink
        v-if="isCompany"
        :to="{ name: 'cuenta-pedidos', query: { filtro: 'cuenta-corriente' } }"
        class="min-w-0 rounded-[10px] border border-[#CBD5E1] p-4 sm:p-5 shadow-sm bg-white flex flex-col justify-between hover:border-[#145A8D] hover:shadow-md transition-all no-underline text-inherit group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
      >
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold text-[#0B2438] text-base m-0 group-hover:text-[#145A8D] transition-colors">
            Pedidos con Cuenta Corriente
          </h3>
          <svg class="w-6 h-6 text-[#0EA5E9]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
        </div>
        <div class="my-2 font-bold text-[#0B2438]" :class="error || (loading && !orders) ? 'text-xl' : 'text-4xl'">
          {{ error ? 'No disponible' : loading && !orders ? 'Cargando…' : creditOrdersCount }}
        </div>
        <p class="text-xs text-slate-500 m-0">
          Modalidad cuenta corriente
        </p>
        <span class="mt-3 text-sm font-semibold text-[#145A8D]">Ver pedidos →</span>
      </RouterLink>

      <RouterLink
        :to="{ name: 'cuenta-pedidos', query: { filtro: 'sin-comprobante' } }"
        class="min-w-0 rounded-[10px] border border-[#CBD5E1] p-4 sm:p-5 shadow-sm bg-white flex flex-col justify-between hover:border-[#145A8D] hover:shadow-md transition-all no-underline text-inherit group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
      >
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold text-[#0B2438] text-base m-0 group-hover:text-[#145A8D] transition-colors">
            Pedidos sin comprobante
          </h3>
          <svg class="w-6 h-6 text-[#10B981]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div class="my-2 font-bold text-[#0B2438]" :class="error || receiptError || (loading && !orders) || receipts.loading.value ? 'text-xl' : 'text-4xl'">
          {{ error || receiptError ? 'No disponible' : (loading && !orders) || receipts.loading.value ? 'Cargando…' : pendingReceiptOrdersCount }}
        </div>
        <p class="text-xs text-slate-500 m-0">
          Pedidos que permiten adjuntar comprobantes
        </p>
        <span class="mt-3 text-sm font-semibold text-[#145A8D]">Ver pedidos →</span>
      </RouterLink>
      </div>
    </section>

    <DatosClientes summary-only />
  </div>
</template>
