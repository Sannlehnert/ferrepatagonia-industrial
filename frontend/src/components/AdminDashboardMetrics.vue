<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import { getAdminOrders } from '@/services/adminOrderService'

// Permite integrar los agregados de #347 sin redefinir su alcance desde la UI.
interface Indicators {
  pedidosNuevos: number
  pedidosCuentaCorriente: number
  comprobantesTotales: number
  comprobantesSinRevisar: number
  alertasStockBajo: number
  empresasFieles: number
}
const props = defineProps<{ indicators?: Indicators }>()
const auth = useAuthStore()
const allowed = () => auth.rol === 'ADMIN' && !auth.loggingIn && !auth.loggingOut
const identity = () => `${auth.user?.id}:${auth.rol}:${auth.sessionVersion}`
const counts = usePrivateAccountRead<{ nuevos: number; cuenta: number }>(identity, allowed)
const cards = computed(() => [
  { id: 'new-orders', label: 'Pedidos nuevos', value: props.indicators?.pedidosNuevos ?? counts.data.value?.nuevos },
  { id: 'credit-orders', label: 'Pedidos con cuenta corriente', value: props.indicators?.pedidosCuentaCorriente ?? counts.data.value?.cuenta },
  { id: 'receipts', label: 'Comprobantes recibidos', value: props.indicators?.comprobantesTotales },
  { id: 'pending-receipts', label: 'Comprobantes sin evaluar', value: props.indicators?.comprobantesSinRevisar },
  { id: 'stock', label: 'Alertas de stock', value: props.indicators?.alertasStockBajo },
  { id: 'loyal-companies', label: 'Empresas fieles', value: props.indicators?.empresasFieles },
])
const reload = () => counts.load(async signal => {
  const [confirmed, credit] = await Promise.all([
    getAdminOrders({ page: 1, limit: 1, estado: 'CONFIRMADO' }, signal),
    getAdminOrders({ page: 1, limit: 1, modalidadPago: 'CUENTA_CORRIENTE' }, signal),
  ])
  return { nuevos: confirmed.pagination.total, cuenta: credit.pagination.total }
})
watch(() => [identity(), auth.loggingIn, auth.loggingOut], () => {
  counts.reset()
  if (allowed()) void reload()
}, { flush: 'sync' })
onMounted(() => { if (allowed()) void reload() })
defineExpose({ reload })
</script>

<template>
  <dl v-if="allowed()" class="m-0 mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" :aria-busy="counts.loading.value">
    <div v-for="card in cards" :key="card.id" class="min-w-0 rounded-xl border border-slate-200 border-t-4 border-t-[#145a8d] bg-white p-4">
      <dt :id="`metric-${card.id}`" class="text-sm font-semibold text-slate-600">{{ card.label }}</dt>
      <dd :aria-labelledby="`metric-${card.id}`" class="m-0 mt-3 text-3xl font-bold tabular-nums text-[#0b2438]">
        {{ card.value ?? '—' }}
        <span v-if="card.value === undefined" class="sr-only">No disponible</span>
      </dd>
    </div>
  </dl>
</template>
