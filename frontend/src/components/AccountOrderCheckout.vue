<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CartSnapshot } from '@/types/cart'
import { useAccountOrderStore } from '@/stores/accountOrder'
import { useCartStore } from '@/stores/cart'
import { precioCarritoComprable } from '@/services/cartService'

const props = defineProps<{
  snapshot?: CartSnapshot
  stale?: boolean
}>()

const order = useAccountOrderStore()
const cart = useCartStore()
const selected = ref(false)
const eligibilityKey = computed(() => props.snapshot && JSON.stringify({
  id: props.snapshot.id_carrito,
  total: props.snapshot.totalUSD,
  stale: props.stale,
  items: props.snapshot.items.map(item => [
    item.id_producto,
    item.cantidad,
    item.precio?.precioUnitarioUSD,
    item.precio?.estadoPrecio,
    item.precio?.compraAcademica,
  ]),
}))

const showTotal = computed(() => {
  const snapshot = props.snapshot
  return snapshot !== undefined &&
    !props.stale &&
    snapshot.estado_total === 'DEFINIDO' &&
    !snapshot.tiene_incompatibles &&
    snapshot.totalUSD !== null &&
    /^(0|[1-9]\d{0,9})\.\d{2}$/.test(snapshot.totalUSD) &&
    snapshot.totalUSD !== '0.00' &&
    snapshot.items.every(item =>
      item.disponible && precioCarritoComprable(item.precio),
    )
})

const hasServerAmounts = computed(() =>
  order.eligibility?.totalUSD !== null &&
  order.eligibility?.totalUSD !== undefined &&
  order.eligibility?.creditoDisponibleUSD !== null &&
  order.eligibility?.creditoDisponibleUSD !== undefined,
)

const busy = computed(() =>
  cart.loading ||
  cart.operation !== null ||
  order.eligibilityLoading ||
  order.attemptState === 'submitting' ||
  order.attemptState === 'pending',
)

const canConfirm = computed(() =>
  showTotal.value &&
  order.canUseCredit &&
  (!props.snapshot?.items.some(item => item.precio?.datosSinteticos === true) || order.eligibility?.simulado === true) &&
  selected.value &&
  !busy.value &&
  order.attemptState === 'idle',
)

watch(
  eligibilityKey,
  () => {
    selected.value = false
    if (showTotal.value) void order.loadEligibility()
  },
  { immediate: true },
)

async function confirmOrder() {
  await order.confirm()
}

async function retryAfterRejection() {
  order.prepareRetry()
  await cart.cargarCarrito()
  await order.loadEligibility()
}
</script>

<template>
  <section aria-label="Confirmación de pedido" class="mt-5 border-t border-slate-200 pt-4">
    <p v-if="order.eligibilityLoading" role="status" class="mb-3 text-sm text-slate-600">
      Verificando si este pedido puede confirmarse a crédito…
    </p>
    <div v-else-if="order.eligibilityError" class="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3">
      <p role="alert" class="mb-2 mt-0 text-sm">{{ order.eligibilityError }}</p>
      <button type="button" class="inline-flex min-h-[44px] min-w-[44px] items-center text-sm font-medium text-[#103a5c] underline focus-visible:outline-2 focus-visible:outline-[#145a8d]" @click="order.loadEligibility()">
        Volver a consultar elegibilidad
      </button>
    </div>

    <p v-if="order.attemptError" role="alert" class="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm">
      {{ order.attemptError }}
    </p>
    <p v-if="order.attemptState === 'pending'" role="status" class="mb-3 text-sm">
      La confirmación todavía no tiene un resultado definitivo. Conservamos el mismo identificador para evitar duplicados.
      <button type="button" class="ml-1 inline-flex min-h-[44px] min-w-[44px] items-center text-sm font-medium text-[#103a5c] underline focus-visible:outline-2 focus-visible:outline-[#145a8d]" @click="order.consultResult()">
        Consultar resultado
      </button>
      <button v-if="order.pendingQuoteToken" type="button" class="ml-3 inline-flex min-h-[44px] min-w-[44px] items-center text-sm font-medium text-[#103a5c] underline focus-visible:outline-2 focus-visible:outline-[#145a8d]" @click="order.retryPendingConfirmation()">
        Reintentar con el mismo identificador
      </button>
    </p>
    <button
      v-if="order.attemptState === 'rejected' && showTotal"
      type="button"
      class="mb-3 inline-flex min-h-[44px] min-w-[44px] items-center text-sm font-medium text-[#103a5c] underline focus-visible:outline-2 focus-visible:outline-[#145a8d]"
      @click="retryAfterRejection()"
    >
      Actualizar carrito y crédito para reintentar
    </button>

    <template
      v-if="!order.eligibilityLoading && !order.eligibilityError &&
        order.canUseCredit && showTotal &&
        order.attemptState !== 'confirmed'"
    >
      <dl class="mb-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div class="flex flex-wrap justify-between gap-2">
          <dt class="text-slate-600">Total del pedido</dt>
          <dd class="m-0 font-semibold text-[#0B2438]">USD {{ order.eligibility?.totalUSD }}</dd>
        </div>
        <div class="flex flex-wrap justify-between gap-2">
          <dt class="text-slate-600">Crédito disponible</dt>
          <dd class="m-0 font-semibold text-[#0B2438]">USD {{ order.eligibility?.creditoDisponibleUSD }}</dd>
        </div>
      </dl>

      <p v-if="order.eligibility?.simulado" class="mb-3 font-semibold">Pedido simulado académico · sin cargo real.</p>

      <fieldset class="mb-3 rounded-md border border-slate-300 p-3">
        <legend class="px-1 text-sm font-medium text-slate-700">Modalidad de pago</legend>
        <label class="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-base sm:text-sm">
          <input v-model="selected" type="radio" name="payment-method" value="CUENTA_CORRIENTE" class="size-4 text-[#103a5c]">
          Cuenta corriente
        </label>
      </fieldset>

      <button
        type="button"
        :disabled="!canConfirm"
        class="flex min-h-12 w-full items-center justify-center rounded-lg border-0 bg-[#103A5C] hover:bg-[#145A8D] px-4 py-2
          font-[inherit] text-base sm:text-sm font-semibold text-white
          focus-visible:outline-2 focus-visible:outline-[#145a8d]
          disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
        @click="confirmOrder()"
      >
        {{ order.attemptState === 'submitting' ? 'Confirmando…' : 'Confirmar pedido a cuenta corriente' }}
      </button>
    </template>

    <template v-else-if="snapshot && order.attemptState !== 'confirmed'">
      <dl
        v-if="!order.eligibilityLoading && !order.eligibilityError && hasServerAmounts"
        class="mb-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2"
      >
        <div class="flex flex-wrap justify-between gap-2">
          <dt class="text-slate-600">Total del pedido</dt>
          <dd class="m-0 font-semibold text-[#0B2438]">USD {{ order.eligibility?.totalUSD }}</dd>
        </div>
        <div class="flex flex-wrap justify-between gap-2">
          <dt class="text-slate-600">Crédito disponible</dt>
          <dd class="m-0 font-semibold text-[#0B2438]">USD {{ order.eligibility?.creditoDisponibleUSD }}</dd>
        </div>
      </dl>
      <button
        type="button"
        disabled
        class="flex min-h-12 w-full cursor-not-allowed items-center justify-center rounded-lg border-0
          bg-[#103A5C] px-4 py-2 font-[inherit] text-base sm:text-sm font-semibold
          text-white opacity-60"
      >
        Finalizar compra
      </button>
      <p
        class="mb-0 mt-2 text-xs text-slate-600"
        :role="order.eligibility?.mensaje ? 'alert' : 'status'"
      >
        {{ !showTotal
          ? 'La confirmación requiere un total vigente y verificable del carrito.'
          : order.eligibilityLoading
            ? 'Verificando las condiciones de la cuenta corriente.'
            : order.eligibilityError
              ? 'No se pudo verificar la elegibilidad del pedido.'
              : order.eligibility?.mensaje ||
                'La cuenta corriente no está habilitada para este pedido.' }}
      </p>
      <button
        v-if="order.eligibility && !order.eligibility.elegible && showTotal"
        type="button"
        :disabled="busy"
        class="mt-2 inline-flex min-h-[44px] min-w-[44px] items-center text-sm font-medium text-[#103a5c] underline focus-visible:outline-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-60"
        @click="order.loadEligibility()"
      >
        Volver a consultar elegibilidad
      </button>
    </template>

    <p v-if="order.storageError" role="alert" class="mb-0 mt-2 text-xs text-amber-800">
      {{ order.storageError }}
    </p>
  </section>
</template>
