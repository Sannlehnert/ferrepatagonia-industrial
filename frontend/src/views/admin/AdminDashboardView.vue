<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import { getAdminDashboardMetrics } from '@/services/adminDashboardService'
import axios from 'axios'
import type { AdminDashboardMetrics } from '@/types/adminDashboard'

const auth = useAuthStore()
const allowed = () => auth.rol === 'ADMIN' && !auth.loggingOut && !auth.loggingIn
const identity = () => `${auth.user?.id}:${auth.rol}:${auth.sessionVersion}`

const metricsState = usePrivateAccountRead<AdminDashboardMetrics>(identity, allowed)
const snapshot = computed(() => metricsState.data.value)
const visibleError = computed(() => {
  const cause = metricsState.error.value
  if (!cause) return null
  if (axios.isAxiosError(cause) && cause.response?.status === 403) return null
  return cause
})

interface DashboardCard {
  id: string
  label: string
  value: number
  hint: string
  to: string
}

const cards = computed<readonly DashboardCard[]>(() => {
  const data = snapshot.value
  if (!data) return []

  const { indicadores, umbralStockBajo } = data
  return [
    {
      id: 'new-orders',
      label: 'Pedidos confirmados (sin preparar)',
      value: indicadores.pedidosNuevos,
      hint: 'Pedidos reales en estado CONFIRMADO pendientes de preparación.',
      to: '/admin/pedidos',
    },
    {
      id: 'in-progress-orders',
      label: 'Pedidos en curso',
      value: indicadores.pedidosEnCurso,
      hint: 'Pedidos reales en preparación o enviados.',
      to: '/admin/pedidos',
    },
    {
      id: 'credit-orders',
      label: 'Pedidos con cuenta corriente',
      value: indicadores.pedidosCuentaCorriente,
      hint: 'Operaciones reales abonadas mediante cuenta corriente.',
      to: '/admin/pedidos',
    },
    {
      id: 'pending-receipts',
      label: 'Comprobantes sin revisar',
      value: indicadores.comprobantesSinRevisar,
      hint: `De ${indicadores.comprobantesTotales} comprobantes reales registrados.`,
      to: '/admin/comprobantes',
    },
    {
      id: 'stock-alerts',
      label: 'Alertas de stock bajo',
      value: indicadores.alertasStockBajo,
      hint: `Productos activos con stock ≤ ${umbralStockBajo} (${indicadores.productosSinStock} sin stock).`,
      to: '/admin/productos',
    },
    {
      id: 'loyal-companies',
      label: 'Empresas fieles aprobadas',
      value: indicadores.empresasFieles,
      hint: 'Clientes empresa activos, aprobados y marcados como fieles.',
      to: '/admin/clientes',
    },
  ]
})

const formattedCutoff = computed(() => {
  const raw = snapshot.value?.corte
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(parsed)
})

function loadMetrics() {
  return metricsState.load(signal => getAdminDashboardMetrics(signal))
}

watch(
  () => [identity(), auth.loggingOut, auth.loggingIn],
  () => {
    metricsState.reset()
    if (allowed()) void loadMetrics()
  },
  { flush: 'sync' },
)

onMounted(() => {
  if (allowed()) void loadMetrics()
})
</script>

<template>
  <section v-if="allowed()" class="max-w-6xl space-y-6" aria-labelledby="admin-dashboard-title">
    <header class="border-b border-slate-200 pb-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xs font-bold uppercase tracking-wider text-sky-700">Administración</p>
          <h1 id="admin-dashboard-title" class="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">
            Dashboard operativo
          </h1>
        </div>
        <button
          type="button"
          class="min-h-10 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-xs transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="metricsState.loading.value"
          @click="loadMetrics()"
        >
          {{ metricsState.loading.value ? 'Actualizando…' : 'Actualizar indicadores' }}
        </button>
      </div>
      <p class="mt-3 max-w-3xl text-sm text-slate-600">
        Indicadores calculados sobre registros operativos reales (excluye datos de demostración).
        <template v-if="formattedCutoff">
          Último corte: <strong class="font-semibold text-slate-800">{{ formattedCutoff }}</strong>.
        </template>
      </p>
    </header>

    <p
      v-if="metricsState.loading.value && !snapshot"
      role="status"
      class="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600"
    >
      Calculando métricas operativas…
    </p>

    <div
      v-else-if="visibleError"
      role="alert"
      class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800"
    >
      <p class="m-0 font-medium">No se pudieron cargar las métricas operativas del panel.</p>
      <button
        type="button"
        class="min-h-10 rounded-md border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-800 transition hover:bg-rose-100"
        @click="loadMetrics()"
      >
        Reintentar
      </button>
    </div>

    <template v-else-if="snapshot">
      <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="card in cards"
          :key="card.id"
          class="flex flex-col rounded-lg border border-slate-200 border-t-4 border-t-sky-700 bg-white p-5 shadow-xs"
        >
          <dt class="text-sm font-bold text-slate-600">{{ card.label }}</dt>
          <dd class="mt-2.5 text-3xl font-extrabold leading-none text-slate-900">
            {{ card.value }}
          </dd>
          <p class="mt-2.5 text-xs leading-relaxed text-slate-500">{{ card.hint }}</p>
          <RouterLink
            :to="card.to"
            class="mt-auto pt-4 text-xs font-bold text-sky-700 underline hover:text-sky-900"
          >
            Ver detalle
          </RouterLink>
        </div>
      </dl>

      <section
        class="rounded-lg border border-slate-200 bg-white p-5 shadow-xs"
        aria-labelledby="orders-status-breakdown-title"
      >
        <h2 id="orders-status-breakdown-title" class="text-sm font-bold text-slate-900">
          Distribución de pedidos operativos ({{ snapshot.pedidosPorEstado.totalOperativos }} totales)
        </h2>
        <dl class="mt-3.5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div class="rounded-md border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
            <dt class="text-xs font-semibold text-slate-500">Confirmados</dt>
            <dd class="mt-1 text-xl font-extrabold text-slate-900">
              {{ snapshot.pedidosPorEstado.CONFIRMADO }}
            </dd>
          </div>
          <div class="rounded-md border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
            <dt class="text-xs font-semibold text-slate-500">En preparación</dt>
            <dd class="mt-1 text-xl font-extrabold text-slate-900">
              {{ snapshot.pedidosPorEstado.EN_PREPARACION }}
            </dd>
          </div>
          <div class="rounded-md border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
            <dt class="text-xs font-semibold text-slate-500">Enviados</dt>
            <dd class="mt-1 text-xl font-extrabold text-slate-900">
              {{ snapshot.pedidosPorEstado.ENVIADO }}
            </dd>
          </div>
          <div class="rounded-md border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
            <dt class="text-xs font-semibold text-slate-500">Entregados</dt>
            <dd class="mt-1 text-xl font-extrabold text-slate-900">
              {{ snapshot.pedidosPorEstado.ENTREGADO }}
            </dd>
          </div>
        </dl>
      </section>
    </template>
  </section>
</template>