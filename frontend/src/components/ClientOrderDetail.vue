<script setup lang="ts">
import { computed, watch } from 'vue'
import PaymentReceipts from '@/components/PaymentReceipts.vue'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import { getClientOrderDetail } from '@/services/clientOrderService'
import { onRealtime } from '@/services/realtime'
import { orderReceiptsPath } from '@/services/paymentReceiptService'
import { useAuthStore } from '@/stores/auth'
import type { ClientOrderDetail } from '@/types/clientOrder'

const props = defineProps<{ orderId: number }>()
const auth = useAuthStore()
const identity = () => `${auth.user?.id}:${auth.rol}:${auth.sessionVersion}:${props.orderId}`
const allowed = () => auth.rol === 'CLIENTE' && !auth.loggingIn && !auth.loggingOut

const { data: detail, loading, error, load } = usePrivateAccountRead<ClientOrderDetail>(
  identity,
  allowed,
)
const showsReceipts = computed(() =>
  (auth.user?.tipo_cliente === 'PARTICULAR' && detail.value?.modalidadPago === 'TRANSFERENCIA') ||
  (auth.user?.tipo_cliente === 'EMPRESA' && detail.value?.modalidadPago === 'CUENTA_CORRIENTE'),
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
        class="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-[#103a5c] px-4 text-sm font-medium text-[#103a5c] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[#145a8d]"
        @click="loadDetail()"
      >
        Reintentar detalle
      </button>
    </div>

    <template v-else-if="detail">
      <h5 class="m-0 mb-3 font-semibold text-[#0B2438]">Productos del pedido</h5>
      <p v-if="!detail.items.length" class="text-sm text-slate-600">Este pedido no tiene productos registrados.</p>
      <ul v-else class="m-0 list-none divide-y divide-slate-200 p-0">
        <li v-for="item in detail.items" :key="item.detalleId" class="py-3 text-sm">
          <p class="m-0 break-words font-semibold text-[#0B2438]">{{ item.nombre }}</p>
          <p class="m-0 break-words text-slate-500">Código {{ item.codigo }}</p>
          <p class="m-0 mt-1">
            Cantidad {{ item.cantidad }} · Precio unitario {{ item.precioUnitario }}
            {{ detail.moneda ?? '' }}
          </p>
          <p class="m-0 mt-0.5 font-medium">Subtotal de la línea {{ item.subtotal }} {{ detail.moneda ?? '' }}</p>
        </li>
      </ul>
      <PaymentReceipts v-if="showsReceipts" :path="orderReceiptsPath(orderId)" mode="pedido" />
    </template>
  </div>
</template>
