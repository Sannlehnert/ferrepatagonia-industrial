<script setup lang="ts">
import { watch } from 'vue'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import { getClientOrderDetail } from '@/services/clientOrderService'
import { onRealtime } from '@/services/realtime'
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
    <p v-if="loading" role="status">Cargando el detalle…</p>

    <div v-else-if="error" class="space-y-3">
      <p role="alert">No se pudo cargar el detalle del pedido.</p>
      <button
        type="button"
        class="min-h-11 rounded-md border border-[#103a5c] px-4 text-[#103a5c]"
        @click="loadDetail()"
      >
        Reintentar detalle
      </button>
    </div>

    <template v-else-if="detail">
      <h5 class="m-0 mb-2 font-semibold">Productos del pedido</h5>
      <p v-if="!detail.items.length">Este pedido no tiene productos registrados.</p>
      <ul v-else class="m-0 list-none divide-y divide-slate-200 p-0">
        <li v-for="item in detail.items" :key="item.detalleId" class="py-3 text-sm">
          <p class="m-0 break-words font-semibold">{{ item.nombre }}</p>
          <p class="m-0 break-words text-slate-600">Código {{ item.codigo }}</p>
          <p class="m-0">
            Cantidad {{ item.cantidad }} · Precio unitario {{ item.precioUnitario }}
            {{ detail.moneda ?? '' }}
          </p>
          <p class="m-0">Subtotal de la línea {{ item.subtotal }} {{ detail.moneda ?? '' }}</p>
        </li>
      </ul>
    </template>
  </div>
</template>
