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
  <section v-if="allowed()" aria-labelledby="company-status-title" class="rounded-[10px] border border-[#E2E8F0] bg-white p-6 shadow-sm">
    <h3 id="company-status-title" class="m-0 text-lg font-bold text-[#0B2438]">Estado comercial</h3>
    <p>{{ approvalMessage(auth.user?.estadoAprobacionEmpresa) }}</p>
    <p v-if="loading" role="status">Consultando el estado de la cuenta corriente…</p>
    <p v-else-if="error" role="alert">No se pudo consultar el estado de la cuenta corriente.</p>
    <p v-else-if="demoDataBlocked" role="alert">Se recibió información de demostración y no se mostrará fuera del entorno de pruebas.</p>
    <p v-else-if="data">{{ creditMessage(data.summary) }}</p>
    <p v-if="sessionError" role="alert">{{ sessionError }}</p>
    <button type="button" class="min-h-11 rounded-md border border-slate-300 px-4 py-2 hover:bg-slate-50"
      :disabled="refreshing" @click="refresh">
      {{ refreshing ? 'Actualizando…' : 'Actualizar estado comercial' }}
    </button>
  </section>
</template>
