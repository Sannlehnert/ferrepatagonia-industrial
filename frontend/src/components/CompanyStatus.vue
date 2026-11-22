<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import { getCuentaCorriente, getCuentaCorrienteMovimientos, getCuentaCorrienteVencimientos } from '@/services/cuentaCorrienteService'
import { useAuthStore } from '@/stores/auth'
import type { CuentaCorrienteConsulta } from '@/types/cuentaCorriente'
import { approvalMessage, creditMessage } from '@/utils/companyStatus'

const auth = useAuthStore()
const identity = () => `${auth.user?.id}:${auth.sessionVersion}`
const allowed = () => auth.rol === 'CLIENTE' && auth.user?.tipo_cliente === 'EMPRESA'
  && !auth.loggingIn && !auth.loggingOut
const { data, loading, error, load } = usePrivateAccountRead<{
  summary: CuentaCorrienteConsulta
  hasDemo: boolean
}>(identity, allowed)
const demoDataBlocked = computed(() => data.value?.hasDemo && !import.meta.env.DEV)
const refreshing = ref(false)
const sessionError = ref('')

const BADGE_CLASSES = {
  positive: 'bg-[#DCFCE7] text-green-800 border-[#BBF7D0]',
  warning: 'bg-[#FEF3C7] text-amber-900 border-[#FDE68A]',
  danger: 'bg-[#FEE2E2] text-red-800 border-[#FECACA]',
  neutral: 'bg-[#F1F5F9] text-slate-700 border-[#E2E8F0]',
} as const

const approvalBadge = computed(() => {
  const status = auth.user?.estadoAprobacionEmpresa
  if (status === 'APROBADA') return { label: 'Aprobada', classes: BADGE_CLASSES.positive }
  if (status === 'PENDIENTE') return { label: 'Pendiente', classes: BADGE_CLASSES.warning }
  if (status === 'RECHAZADA') return { label: 'Rechazada', classes: BADGE_CLASSES.danger }
  return { label: 'No determinable', classes: BADGE_CLASSES.neutral }
})

const creditBadge = computed(() => {
  const summary = data.value?.summary
  if (!summary || summary.estado === 'SIN_CUENTA') {
    return { label: 'Sin cuenta', classes: BADGE_CLASSES.neutral }
  }
  if (summary.estado === 'INHABILITADA') {
    return { label: 'Inhabilitada', classes: BADGE_CLASSES.warning }
  }
  if (summary.estadoCredito === 'DISPONIBLE') {
    return { label: 'Disponible', classes: BADGE_CLASSES.positive }
  }
  if (summary.estadoCredito === 'BLOQUEADO') {
    return { label: 'Bloqueado', classes: BADGE_CLASSES.danger }
  }
  return { label: 'No determinable', classes: BADGE_CLASSES.neutral }
})

async function readStatus(signal: AbortSignal) {
  const summary = await getCuentaCorriente(signal)
  if (summary.estado === 'SIN_CUENTA') return { summary, hasDemo: false }
  const [movements, dues] = await Promise.all([
    getCuentaCorrienteMovimientos(),
    getCuentaCorrienteVencimientos(),
  ])
  if (!('items' in movements) || !('items' in dues) ||
      movements.revision !== summary.revision || dues.revision !== summary.revision) {
    throw new Error('No coinciden las revisiones de la cuenta corriente.')
  }
  return {
    summary,
    hasDemo: summary.origen === 'DEMO' || movements.items.some(item => item.origen === 'DEMO')
      || dues.items.some(item => item.origen === 'DEMO'),
  }
}

watch([identity, allowed], () => void load(readStatus), { immediate: true })

async function refresh() {
  if (refreshing.value) return
  refreshing.value = true
  sessionError.value = ''
  try {
    if (await auth.fetchSession()) await load(readStatus)
  } catch {
    sessionError.value = 'No se pudo actualizar la aprobación. Reintentá antes de tomar decisiones.'
  } finally {
    refreshing.value = false
  }
}
</script>

<template>
  <section v-if="allowed()" aria-labelledby="company-status-title" class="rounded-[10px] border border-[#E2E8F0] bg-white p-6 shadow-sm space-y-3">
    <h2 id="company-status-title" class="m-0 text-lg font-bold text-[#0B2438]">Estado comercial</h2>
    <div class="space-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border" :class="approvalBadge.classes">
          {{ approvalBadge.label }}
        </span>
        <p class="m-0 text-sm text-[#0B2438]">{{ approvalMessage(auth.user?.estadoAprobacionEmpresa) }}</p>
      </div>
      <p v-if="loading" role="status" class="m-0 text-sm text-slate-600">Consultando el estado de la cuenta corriente…</p>
      <p v-else-if="error" role="alert" class="m-0 rounded-[8px] border border-solid border-[#FECACA] bg-[#FEE2E2]/60 px-3 py-2 text-sm font-medium text-red-800">
        No se pudo consultar el estado de la cuenta corriente.
      </p>
      <p v-else-if="demoDataBlocked" role="alert" class="m-0 rounded-[8px] border border-solid border-[#FECACA] bg-[#FEE2E2]/60 px-3 py-2 text-sm font-medium text-red-800">
        Se recibió información de demostración y no se mostrará fuera del entorno de pruebas.
      </p>
      <div v-else-if="data" class="flex flex-wrap items-center gap-2">
        <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border" :class="creditBadge.classes">
          {{ creditBadge.label }}
        </span>
        <p class="m-0 text-sm text-[#0B2438]">{{ creditMessage(data.summary) }}</p>
      </div>
      <p v-if="sessionError" role="alert" class="m-0 rounded-[8px] border border-solid border-[#FECACA] bg-[#FEE2E2]/60 px-3 py-2 text-sm font-medium text-red-800">
        {{ sessionError }}
      </p>
    </div>
    <button
      type="button"
      class="box-border min-h-[44px] cursor-pointer rounded-[8px] border border-solid border-[#CBD5E1] bg-white px-4 py-2 font-[inherit] text-sm font-semibold text-[#0B2438] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] transition-colors"
      :disabled="refreshing"
      @click="refresh"
    >
      {{ refreshing ? 'Actualizando…' : 'Actualizar estado comercial' }}
    </button>
  </section>
</template>
