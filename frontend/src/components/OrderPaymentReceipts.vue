<script setup lang="ts">
import { computed } from 'vue'
import PaymentReceipts from '@/components/PaymentReceipts.vue'
import { orderReceiptsPath, supportsOrderReceipts } from '@/services/paymentReceiptService'
import { useAuthStore } from '@/stores/auth'
import type { ClientOrderSummary } from '@/types/clientOrder'

const props = defineProps<{ order: Pick<ClientOrderSummary, 'pedidoId' | 'modalidadPago'> }>()
const emit = defineEmits<{ updated: [] }>()
const auth = useAuthStore()
const available = computed(() => auth.rol === 'CLIENTE' && !auth.loggingIn && !auth.loggingOut
  && supportsOrderReceipts(
    auth.user?.tipo_cliente,
    props.order.modalidadPago,
    auth.user?.estadoAprobacionEmpresa,
    auth.user?.cuentaCorrienteHabilitada,
  ))
const receiptKey = computed(() => [
  auth.user?.id, auth.sessionVersion, props.order.pedidoId, props.order.modalidadPago,
].join(':'))
</script>

<template>
  <PaymentReceipts
    v-if="available"
    :key="receiptKey"
    :path="orderReceiptsPath(order.pedidoId)"
    mode="pedido"
    @updated="emit('updated')"
  />
</template>
