<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import axios from 'axios'
import { useAuthStore } from '@/stores/auth'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import { getAdminDashboardMetrics } from '@/services/adminDashboardService'
import type { AdminDashboardMetrics } from '@/types/adminDashboard'

const auth = useAuthStore()
const allowed = () => auth.rol === 'ADMIN' && !auth.loggingIn && !auth.loggingOut
const identity = () => `${auth.user?.id}:${auth.rol}:${auth.sessionVersion}`
const metricsState = usePrivateAccountRead<AdminDashboardMetrics>(identity, allowed)
const indicators = computed(() => metricsState.data.value?.indicadores)
const visibleError = computed(() => {
  const cause = metricsState.error.value
  return cause && !(axios.isAxiosError(cause) && cause.response?.status === 403)
})
const formattedCutoff = computed(() => {
  const raw = metricsState.data.value?.corte
  if (!raw) return ''
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires',
  }).format(date)
})
const cards = computed(() => [
  { id: 'new-orders', label: 'Pedidos nuevos', value: indicators.value?.pedidosNuevos },
  { id: 'credit-orders', label: 'Pedidos con cuenta corriente', value: indicators.value?.pedidosCuentaCorriente },
  { id: 'receipts', label: 'Comprobantes recibidos', value: indicators.value?.comprobantesTotales },
  { id: 'pending-receipts', label: 'Comprobantes sin evaluar', value: indicators.value?.comprobantesSinRevisar },
  { id: 'stock', label: 'Alertas de stock', value: indicators.value?.alertasStockBajo },
  { id: 'loyal-companies', label: 'Empresas fieles', value: indicators.value?.empresasFieles },
])
const statusCounts = computed(() => {
  const counts = metricsState.data.value?.pedidosPorEstado
  return [
    { label: 'Confirmados', value: counts?.CONFIRMADO },
    { label: 'En preparación', value: counts?.EN_PREPARACION },
    { label: 'Enviados', value: counts?.ENVIADO },
    { label: 'Entregados', value: counts?.ENTREGADO },
  ]
})
const reload = () => metricsState.load(signal => getAdminDashboardMetrics(signal))
watch(() => [identity(), auth.loggingIn, auth.loggingOut], () => {
  metricsState.reset()
  if (allowed()) void reload()
}, { flush: 'sync' })
onMounted(() => { if (allowed()) void reload() })
defineExpose({ reload, loading: metricsState.loading })
</script>

<template>
  <div v-if="allowed()" class="min-w-0" :aria-busy="metricsState.loading.value">
    <p v-if="metricsState.loading.value" role="status" class="mb-3 text-sm text-slate-600">Actualizando indicadores…</p>
    <p v-else-if="formattedCutoff" class="mb-3 text-xs text-slate-500">Última actualización: {{ formattedCutoff }}</p>
    <div v-if="visibleError" class="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
      <p role="alert" class="m-0 text-sm text-red-800">No pudimos consultar los indicadores. Reintentá con Actualizar pedidos.</p>
      <button type="button" class="mt-2 min-h-11 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-[#103a5c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]" @click="reload">Reintentar indicadores</button>
    </div>
    <dl aria-label="Indicadores" class="m-0 mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="card in cards" :key="card.id" class="min-w-0 rounded-xl border border-slate-200 border-t-4 border-t-[#145a8d] bg-white p-4">
        <dt :id="`metric-${card.id}`" class="text-sm font-semibold text-slate-600">{{ card.label }}</dt>
        <dd :aria-labelledby="`metric-${card.id}`" class="m-0 mt-3 text-3xl font-bold tabular-nums text-[#0b2438]">
          {{ card.value ?? '—' }}
          <span v-if="card.value === undefined" class="sr-only">No disponible</span>
        </dd>
      </div>
    </dl>
    <section class="mb-5 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="dashboard-status-title">
      <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="dashboard-status-title" class="m-0 text-base font-semibold text-[#0b2438]">Pedidos por estado</h3>
        <span v-if="metricsState.data.value" class="text-xs text-slate-500">{{ metricsState.data.value.pedidosPorEstado.totalOperativos }} pedidos operativos</span>
      </div>
      <dl aria-label="Pedidos por estado" class="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div v-for="status in statusCounts" :key="status.label" class="rounded-lg bg-slate-50 p-3">
          <dt class="text-xs font-medium text-slate-600">{{ status.label }}</dt>
          <dd class="m-0 mt-2 text-xl font-semibold tabular-nums text-[#0b2438]">{{ status.value ?? '—' }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>
