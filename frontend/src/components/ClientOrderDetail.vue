<script setup lang="ts">
import { watch } from 'vue'
import OrderPaymentReceipts from '@/components/OrderPaymentReceipts.vue'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import { getClientOrderDetail } from '@/services/clientOrderService'
import { onRealtime } from '@/services/realtime'
import { useAuthStore } from '@/stores/auth'
import type { ClientOrderDetail } from '@/types/clientOrder'

const props = withDefaults(defineProps<{ orderId: number; showReceipts?: boolean }>(), {
  showReceipts: true,
})
const emit = defineEmits<{ receiptUpdated: [] }>()
const auth = useAuthStore()
const identity = () => `${auth.user?.id}:${auth.rol}:${auth.sessionVersion}:${props.orderId}`
const allowed = () => auth.rol === 'CLIENTE' && !auth.loggingIn && !auth.loggingOut

const { data: detail, loading, error, load } = usePrivateAccountRead<ClientOrderDetail>(
  identity,
  allowed,
)

function loadDetail() {
  return load(signal => getClientOrderDetail(props.orderId, signal))
}

watch([identity, allowed], () => void loadDetail(), {
  immediate: true,
})

onRealtime(change => {
  if (change.reconnect || change.orders.has(props.orderId)) void loadDetail()
})
</script>

<template>
  <div class="mt-4 border-t border-slate-200 pt-4">
    <p v-if="loading" role="status" class="text-sm text-slate-500">Cargando el detalle…</p>

    <div v-else-if="error" class="space-y-3">
      <p role="alert" class="text-sm text-red-700">No se pudo cargar el detalle del pedido.</p>
      <button
        type="button"
        class="box-border inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-md border border-solid border-[#103A5C] bg-white px-4 font-[inherit] text-sm font-medium text-[#103A5C] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
        @click="loadDetail()"
      >
        Reintentar detalle
      </button>
    </div>

    <template v-else-if="detail">
      <h4 class="m-0 mb-3 font-semibold text-[#0B2438]">Productos del pedido</h4>
      <p v-if="!detail.items.length" class="text-sm text-slate-600">Este pedido no tiene productos registrados.</p>
      <ul v-else class="m-0 list-none divide-y divide-slate-200 p-0">
        <li v-for="item in detail.items" :key="item.detalleId" class="py-3 text-sm">
          <p class="m-0 font-semibold text-[#0B2438] [overflow-wrap:anywhere]">{{ item.nombre }}</p>
          <p class="m-0 text-slate-600 [overflow-wrap:anywhere]">Código {{ item.codigo }}</p>
          <dl class="mb-0 mt-2 grid grid-cols-1 gap-1 text-slate-700 sm:grid-cols-2">
            <div><dt class="inline">Cantidad: </dt><dd class="m-0 inline font-medium">{{ item.cantidad }}</dd></div>
            <div class="[overflow-wrap:anywhere]"><dt class="inline">Precio unitario: </dt><dd class="m-0 inline font-medium">{{ item.precioUnitario }} {{ detail.moneda ?? '' }}</dd></div>
            <div class="[overflow-wrap:anywhere]"><dt class="inline">Subtotal de la línea: </dt><dd class="m-0 inline font-semibold">{{ item.subtotal }} {{ detail.moneda ?? '' }}</dd></div>
          </dl>
        </li>
      </ul>
      <OrderPaymentReceipts v-if="showReceipts" :order="detail" @updated="emit('receiptUpdated')" />
    </template>
  </div>
</template>
