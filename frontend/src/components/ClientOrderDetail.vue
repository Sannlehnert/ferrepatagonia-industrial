<script setup lang="ts">
import { computed, watch } from 'vue'
import AdminOrderStatusBadge from '@/components/AdminOrderStatusBadge.vue'
import OrderFinancialStatusBadge from '@/components/OrderFinancialStatusBadge.vue'
import OrderPaymentReceipts from '@/components/OrderPaymentReceipts.vue'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import { getClientOrderDetail } from '@/services/clientOrderService'
import { supportsOrderReceipts } from '@/services/paymentReceiptService'
import { onRealtime } from '@/services/realtime'
import { useAuthStore } from '@/stores/auth'
import type { ClientOrderDetail } from '@/types/clientOrder'
import { formatCivilDate } from '@/utils/cuentaCorriente'
import {
  orderDocumentStateBadge,
  orderPaymentModeLabel,
  resolveOrderCommercialState,
  STATE_BADGE_TONES,
} from '@/utils/payment'

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

const receiptsAvailable = computed(() =>
  detail.value
    ? supportsOrderReceipts(
        auth.user?.tipo_cliente,
        detail.value.modalidadPago,
        auth.user?.estadoAprobacionEmpresa,
        auth.user?.cuentaCorrienteHabilitada,
      )
    : false,
)

const documentBadge = computed(() => {
  if (!detail.value) return null
  if (!receiptsAvailable.value) {
    if (
      detail.value.estadoDocumental === 'APROBADO' ||
      detail.value.estadoDocumental === 'PENDIENTE' ||
      detail.value.estadoDocumental === 'RECHAZADO'
    ) {
      return orderDocumentStateBadge(detail.value.estadoDocumental, { emptyLabel: 'No adjunto' })
    }
    return { label: 'No disponible para esta modalidad', ...STATE_BADGE_TONES.neutral }
  }
  return orderDocumentStateBadge(detail.value.estadoDocumental, { emptyLabel: 'No adjunto' })
})

let suppressRealtimeUntil = 0

function loadDetail(keepData = false) {
  return load(signal => getClientOrderDetail(props.orderId, signal), { keepData })
}

async function handleReceiptUpdated() {
  suppressRealtimeUntil = Date.now() + 800
  await loadDetail(true)
  emit('receiptUpdated')
}

watch([identity, allowed], () => void loadDetail(), {
  immediate: true,
})

onRealtime(change => {
  if (!change.reconnect && Date.now() < suppressRealtimeUntil) return
  if (
    change.reconnect ||
    change.orders.has(props.orderId) ||
    (detail.value?.modalidadPago === 'CUENTA_CORRIENTE' && (change.payments || change.account))
  ) {
    void loadDetail(true)
  }
})
</script>

<template>
  <div class="mt-4 border-t border-slate-200 pt-4 space-y-4">
    <p v-if="loading && !detail" role="status" class="text-sm text-slate-500">Cargando el detalle…</p>

    <div v-else-if="error && !detail" class="space-y-3">
      <p role="alert" class="text-sm text-red-700">No se pudo cargar el detalle del pedido.</p>
      <button
        type="button"
        class="box-border inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-md border border-[#103a5c] bg-white px-4 font-[inherit] text-sm font-medium text-[#103a5c] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
        @click="loadDetail()"
      >
        Reintentar detalle
      </button>
    </div>

    <template v-else-if="detail">
      <!-- Separación de los tres dominios de estado (§2 y §7) -->
      <section
        aria-label="Estados del pedido"
        class="grid grid-cols-1 gap-3 rounded-lg border border-[#E2E8F0] bg-white p-3.5 lg:grid-cols-3"
      >
        <div class="min-w-0 space-y-1.5">
          <p class="m-0 text-xs font-semibold text-slate-600">Estado del pedido (logístico)</p>
          <AdminOrderStatusBadge :status="resolveOrderCommercialState(detail)" />
          <p class="m-0 text-xs text-slate-500">
            Modalidad: {{ orderPaymentModeLabel(detail.modalidadPago) }}
          </p>
        </div>

        <div class="min-w-0 space-y-1.5">
          <p class="m-0 text-xs font-semibold text-slate-600">Estado documental (comprobante)</p>
          <span
            v-if="documentBadge"
            class="box-border inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold leading-tight"
            :class="documentBadge.badgeClasses"
          >
            <span
              aria-hidden="true"
              class="h-1.5 w-1.5 shrink-0 rounded-full"
              :class="documentBadge.dotClasses"
            />
            <span>{{ documentBadge.label }}</span>
          </span>
          <p class="m-0 text-xs text-slate-500">
            Revisión independiente de la acreditación del pago.
          </p>
        </div>

        <div class="min-w-0 space-y-1.5">
          <p class="m-0 text-xs font-semibold text-slate-600">Estado financiero (pago / acreditación)</p>
          <OrderFinancialStatusBadge
            :status="detail.estadoFinanciero"
            :monto-acreditado-usd="detail.montoAcreditadoUSD"
            :document-status="detail.estadoDocumental"
            show-explanation
          />
          <p v-if="detail.modalidadPago === 'CUENTA_CORRIENTE' && detail.venceEl" class="m-0 text-xs text-slate-600">
            Vencimiento del cargo: {{ formatCivilDate(detail.venceEl) }}
          </p>
        </div>
      </section>

      <div>
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
      </div>

      <OrderPaymentReceipts v-if="showReceipts" :order="detail" @updated="handleReceiptUpdated" />
    </template>
  </div>
</template>
