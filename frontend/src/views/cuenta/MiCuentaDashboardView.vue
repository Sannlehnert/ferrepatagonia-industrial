<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterLink } from 'vue-router'
import DatosClientes from '@/views/cuenta/DatosClientes.vue'
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

// Metrics
const totalOrdersCount = computed(() => orders.value?.length ?? 0)
const creditOrdersCount = computed(() =>
  orders.value?.filter(o => o.modalidadPago === 'CUENTA_CORRIENTE').length ?? 0,
)
const pendingReceiptOrdersCount = computed(() =>
  orders.value?.filter(o =>
    o.modalidadPago === 'TRANSFERENCIA' && o.estado === 'PENDIENTE',
  ).length ?? 0,
)
const ultimoPedidoFecha = computed(() => {
  if (!orders.value || orders.value.length === 0) return ''
  const first = orders.value[0]
  if (!first?.fecha) return ''
  const d = new Date(first.fecha)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${day}/${month}`
})

const isParticular = computed(() => {
  const u = auth.user as Record<string, any> | null | undefined
  const tipo = u?.tipoCliente ?? u?.tipo_cliente ?? u?.cliente?.tipoCliente ?? u?.cliente?.tipo_cliente
  return tipo === 'PARTICULAR'
})
</script>

<template>
  <div class="space-y-6">
    <!-- Saludo / Título: Nombre del usuario o empresa -->
    <h2 class="text-2xl font-bold text-[#0B2438] text-center my-6">
      {{ auth.user?.nombre || 'Mi Cuenta' }}
    </h2>

    <!-- Error State -->
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

    <!-- 3 Metrics Cards Grid -->
    <div
      class="grid grid-cols-1 gap-6 mb-8"
      :class="isParticular ? 'md:grid-cols-2' : 'md:grid-cols-3'"
    >
      <!-- Card 1: Pedidos Realizados -->
      <RouterLink
        :to="{ name: 'cuenta-pedidos' }"
        class="rounded-[10px] border border-[#E2E8F0] p-6 shadow-sm bg-white flex flex-col justify-between hover:border-[#10B981] hover:shadow-md transition-all cursor-pointer no-underline text-inherit group focus-visible:outline-2 focus-visible:outline-[#145A8D]"
      >
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold text-[#0B2438] text-base m-0 group-hover:text-[#145A8D] transition-colors">
            Pedidos Realizados
          </h3>
          <svg class="w-6 h-6 text-[#10B981]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
          </svg>
        </div>
        <div class="text-4xl font-bold text-[#10B981] my-2">
          {{ loading && !orders ? '-' : totalOrdersCount }}
        </div>
        <p class="text-xs text-slate-500 m-0">
          Todos los estados{{ ultimoPedidoFecha ? ' - último: ' + ultimoPedidoFecha : '' }}
        </p>
      </RouterLink>

      <!-- Card 2: Pedidos con Cuenta Corriente -->
      <RouterLink
        v-if="!isParticular"
        :to="{ name: 'cuenta-pedidos', query: { filtro: 'cuenta-corriente' } }"
        class="rounded-[10px] border border-[#E2E8F0] p-6 shadow-sm bg-white flex flex-col justify-between hover:border-[#0EA5E9] hover:shadow-md transition-all cursor-pointer no-underline text-inherit group focus-visible:outline-2 focus-visible:outline-[#145A8D]"
      >
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold text-[#0B2438] text-base m-0 group-hover:text-[#145A8D] transition-colors">
            Pedidos con Cuenta Corriente
          </h3>
          <svg class="w-6 h-6 text-[#0EA5E9]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
        </div>
        <div class="text-4xl font-bold text-[#0EA5E9] my-2">
          {{ loading && !orders ? '-' : creditOrdersCount }}
        </div>
        <p class="text-xs text-slate-500 m-0">
          Modalidad cuenta corriente
        </p>
      </RouterLink>

      <!-- Card 3: Pedidos sin comprobante -->
      <RouterLink
        :to="{ name: 'cuenta-pedidos', query: { filtro: 'sin-comprobante' } }"
        class="rounded-[10px] border border-[#E2E8F0] p-6 shadow-sm bg-white flex flex-col justify-between hover:border-[#10B981] hover:shadow-md transition-all cursor-pointer no-underline text-inherit group focus-visible:outline-2 focus-visible:outline-[#145A8D]"
      >
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold text-[#0B2438] text-base m-0 group-hover:text-[#145A8D] transition-colors">
            Pedidos sin comprobante
          </h3>
          <svg class="w-6 h-6 text-[#10B981]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div class="text-4xl font-bold text-[#10B981] my-2">
          {{ loading && !orders ? '-' : pendingReceiptOrdersCount }}
        </div>
        <p class="text-xs text-slate-500 m-0">
          Transferencias pendientes
        </p>
      </RouterLink>
    </div>

    <!-- Status text when loading -->
    <p v-if="loading && !orders" role="status" class="text-center text-sm text-slate-500">
      Cargando métricas…
    </p>

    <DatosClientes />
  </div>
</template>
