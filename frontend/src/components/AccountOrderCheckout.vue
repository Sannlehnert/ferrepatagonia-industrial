<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CartSnapshot } from '@/types/cart'
import PaymentReceipts from '@/components/PaymentReceipts.vue'
import { orderReceiptsPath } from '@/services/paymentReceiptService'
import { useAccountOrderStore } from '@/stores/accountOrder'
import { useCartStore } from '@/stores/cart'
import { useTransferOrderStore } from '@/stores/transferOrder'
import { precioCarritoComprable } from '@/services/cartService'

const props = defineProps<{
  snapshot?: CartSnapshot
  stale?: boolean
}>()

const order = useAccountOrderStore()
const transfer = useTransferOrderStore()
const cart = useCartStore()
const selected = ref<'TRANSFERENCIA' | 'CUENTA_CORRIENTE'>('TRANSFERENCIA')
const eligibilityFeedback = ref('')
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
  (selected.value === 'CUENTA_CORRIENTE' && order.eligibilityLoading) ||
  (selected.value === 'TRANSFERENCIA' && transfer.eligibilityLoading) ||
  order.attemptState === 'submitting' ||
  order.attemptState === 'pending' ||
  transfer.attemptState === 'submitting' ||
  transfer.attemptState === 'pending',
)

const canConfirm = computed(() =>
  showTotal.value &&
  order.canUseCredit &&
  (!props.snapshot?.items.some(item => item.precio?.datosSinteticos === true) || order.eligibility?.simulado === true) &&
  selected.value === 'CUENTA_CORRIENTE' &&
  !busy.value &&
  order.attemptState === 'idle',
)

const canConfirmTransfer = computed(() =>
  showTotal.value &&
  transfer.canUseTransfer &&
  (!props.snapshot?.items.some(item => item.precio?.datosSinteticos === true) || transfer.eligibility?.simulado === true) &&
  selected.value === 'TRANSFERENCIA' &&
  !busy.value &&
  transfer.attemptState === 'idle',
)

const hasLockedAttempt = computed(() =>
  order.attemptState === 'pending' || order.attemptState === 'confirmed' ||
  transfer.attemptState === 'pending' || transfer.attemptState === 'confirmed',
)

const hasSelectedAvailableMethod = computed(() =>
  showTotal.value &&
  ((selected.value === 'TRANSFERENCIA' && transfer.canUseTransfer) ||
    (selected.value === 'CUENTA_CORRIENTE' && order.canUseCredit)),
)

const showUnavailable = computed(() =>
  !!props.snapshot &&
  !hasLockedAttempt.value &&
  !transfer.confirmation &&
  order.attemptState !== 'confirmed' &&
  !hasSelectedAvailableMethod.value,
)

const transferReceiptPath = computed(() =>
  transfer.confirmation ? orderReceiptsPath(transfer.confirmation.pedidoId) : '',
)

watch(
  [eligibilityKey, showTotal],
  ([, hasVerifiableTotal]) => {
    if (!hasLockedAttempt.value) selected.value = 'TRANSFERENCIA'
    eligibilityFeedback.value = ''
    if (hasVerifiableTotal) {
      void order.loadEligibility()
      void transfer.loadEligibility()
    } else {
      order.invalidateEligibility()
    }
  },
  { immediate: true, flush: 'sync' },
)

watch(
  () => [
    transfer.eligibilityLoading,
    transfer.eligibility?.elegible,
    order.eligibilityLoading,
    order.canUseCredit,
  ] as const,
  ([transferLoading, transferEligible, creditLoading, creditEligible]) => {
    if (creditLoading) eligibilityFeedback.value = ''
    if (hasLockedAttempt.value || transferLoading || creditLoading) return
    if (selected.value === 'TRANSFERENCIA' && transferEligible === false && creditEligible) {
      selected.value = 'CUENTA_CORRIENTE'
    } else if (selected.value === 'CUENTA_CORRIENTE' && !creditEligible && transferEligible) {
      selected.value = 'TRANSFERENCIA'
    }
  },
)

async function retryEligibility() {
  eligibilityFeedback.value = ''
  if (await order.loadEligibility()) eligibilityFeedback.value = 'Elegibilidad actualizada.'
}

async function confirmOrder() {
  await order.confirm()
}

async function confirmTransfer() {
  await transfer.confirm()
}

async function retryAfterRejection() {
  order.prepareRetry()
  await cart.cargarCarrito()
  await order.loadEligibility()
}

async function retryTransferAfterRejection() {
  transfer.prepareRetry()
  await cart.cargarCarrito()
  await transfer.loadEligibility()
}
</script>

<template>
  <section aria-label="Confirmación de pedido" class="mt-5 border-t border-slate-200 pt-4">
    <p v-if="showTotal && !hasLockedAttempt && order.eligibilityLoading" role="status" class="mb-3 text-sm text-slate-600">
      Verificando si este pedido puede confirmarse a crédito…
    </p>
    <div v-if="showTotal && !hasLockedAttempt && order.eligibilityError" class="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3">
      <p role="alert" class="mb-2 mt-0 text-sm">{{ order.eligibilityError }}</p>
      <button type="button" class="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center border-0 bg-transparent p-0 font-[inherit] text-sm font-medium text-[#103a5c] underline focus-visible:outline-2 focus-visible:outline-[#145a8d]" @click="retryEligibility()">
        Volver a consultar elegibilidad
      </button>
    </div>
    <p v-if="eligibilityFeedback" role="status" class="mb-3 text-sm text-green-800">
      {{ eligibilityFeedback }}
    </p>
    <p v-if="selected === 'TRANSFERENCIA' && transfer.eligibilityLoading" role="status" class="mb-3 text-sm text-slate-600">
      Verificando el total del pedido para transferencia…
    </p>
    <div v-if="selected === 'TRANSFERENCIA' && transfer.eligibilityError" class="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3">
      <p role="alert" class="mb-2 mt-0 text-sm">{{ transfer.eligibilityError }}</p>
      <button type="button" class="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center border-0 bg-transparent p-0 font-[inherit] text-sm font-medium text-[#103a5c] underline focus-visible:outline-2 focus-visible:outline-[#145a8d]" @click="transfer.loadEligibility()">
        Volver a consultar el total
      </button>
    </div>
    <div
      v-if="selected === 'TRANSFERENCIA' && showTotal && !hasLockedAttempt &&
        order.eligibility && !order.eligibility.elegible"
      class="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3"
    >
      <p role="status" class="mb-2 mt-0 text-sm">
        {{ order.eligibility.mensaje || 'El pedido no puede confirmarse a cuenta corriente.' }}
      </p>
      <dl v-if="hasServerAmounts" class="mb-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
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
        :disabled="busy || order.eligibilityLoading"
        class="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center border-0 bg-transparent p-0 font-[inherit] text-sm font-medium text-[#103a5c] underline focus-visible:outline-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-60"
        @click="retryEligibility()"
      >
        {{ order.eligibilityLoading ? 'Consultando…' : 'Volver a consultar elegibilidad' }}
      </button>
    </div>

    <p v-if="order.attemptError" role="alert" class="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm">
      {{ order.attemptError }}
    </p>
    <p v-if="transfer.attemptError" role="alert" class="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm">
      {{ transfer.attemptError }}
    </p>
    <p v-if="order.attemptState === 'pending'" role="status" class="mb-3 text-sm">
      La confirmación todavía no tiene un resultado definitivo. Conservamos el mismo identificador para evitar duplicados.
      <button type="button" class="ml-1 inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center border-0 bg-transparent p-0 font-[inherit] text-sm font-medium text-[#103a5c] underline focus-visible:outline-2 focus-visible:outline-[#145a8d]" @click="order.consultResult()">
        Consultar resultado
      </button>
      <button v-if="order.pendingQuoteToken" type="button" class="ml-3 inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center border-0 bg-transparent p-0 font-[inherit] text-sm font-medium text-[#103a5c] underline focus-visible:outline-2 focus-visible:outline-[#145a8d]" @click="order.retryPendingConfirmation()">
        Reintentar con el mismo identificador
      </button>
    </p>
    <p v-if="transfer.attemptState === 'pending'" role="status" class="mb-3 text-sm">
      Todavía no pudimos verificar si el pedido quedó registrado. Conservamos el mismo identificador para evitar duplicados.
      <button type="button" class="ml-1 inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center border-0 bg-transparent p-0 font-[inherit] text-sm font-medium text-[#103a5c] underline focus-visible:outline-2 focus-visible:outline-[#145a8d]" @click="transfer.consultResult()">
        Consultar resultado
      </button>
      <button v-if="transfer.pendingQuoteToken" type="button" class="ml-3 inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center border-0 bg-transparent p-0 font-[inherit] text-sm font-medium text-[#103a5c] underline focus-visible:outline-2 focus-visible:outline-[#145a8d]" @click="transfer.retryPendingConfirmation()">
        Reintentar con el mismo identificador
      </button>
    </p>
    <button
      v-if="order.attemptState === 'rejected' && showTotal"
      type="button"
      class="mb-3 inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center border-0 bg-transparent p-0 font-[inherit] text-sm font-medium text-[#103a5c] underline focus-visible:outline-2 focus-visible:outline-[#145a8d]"
      @click="retryAfterRejection()"
    >
      Actualizar carrito y crédito para reintentar
    </button>
    <button
      v-if="transfer.attemptState === 'rejected' && showTotal"
      type="button"
      class="mb-3 inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center border-0 bg-transparent p-0 font-[inherit] text-sm font-medium text-[#103a5c] underline focus-visible:outline-2 focus-visible:outline-[#145a8d]"
      @click="retryTransferAfterRejection()"
    >
      Actualizar carrito y total para reintentar
    </button>

    <div
      v-if="transfer.confirmation"
      role="status"
      class="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"
    >
      <p class="mb-1 mt-0 font-semibold">
        {{ transfer.confirmation.simulado ? 'Pedido simulado' : 'Pedido' }}
        #{{ transfer.confirmation.pedidoId }} registrado por USD {{ transfer.confirmation.totalUSD }}.
      </p>
      <p class="mb-0 mt-0">
        El pago por transferencia está pendiente de acreditación y revisión del comprobante.
        Este registro no significa que el pago haya sido aprobado.
      </p>
      <PaymentReceipts v-if="transferReceiptPath" :path="transferReceiptPath" mode="pedido" />
    </div>

    <template v-if="showTotal && !hasLockedAttempt && !transfer.confirmation">
      <fieldset class="mb-3 rounded-md border border-slate-300 p-3">
        <legend class="px-1 text-sm font-medium text-slate-700">Modalidad de pago</legend>
        <label
          v-if="transfer.canUseTransfer && !transfer.eligibilityLoading"
          class="mr-4 inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-base sm:text-sm"
        >
          <input v-model="selected" type="radio" name="payment-method" value="TRANSFERENCIA" class="size-4 text-[#103a5c]" :disabled="busy">
          Transferencia
        </label>
        <label
          v-if="order.canUseCredit && !order.eligibilityLoading"
          class="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-base sm:text-sm"
        >
          <input v-model="selected" type="radio" name="payment-method" value="CUENTA_CORRIENTE" class="size-4 text-[#103a5c]" :disabled="busy">
          Cuenta corriente
        </label>
      </fieldset>
    </template>

    <template
      v-if="!order.eligibilityLoading && !order.eligibilityError &&
        selected === 'CUENTA_CORRIENTE' && order.canUseCredit && showTotal &&
        order.attemptState !== 'confirmed' && !hasLockedAttempt"
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

    <template
      v-if="selected === 'TRANSFERENCIA' && transfer.canUseTransfer && showTotal &&
        transfer.attemptState !== 'confirmed' && !hasLockedAttempt"
    >
      <dl class="mb-3 grid grid-cols-1 gap-2 text-sm">
        <div class="flex flex-wrap justify-between gap-2">
          <dt class="text-slate-600">Total a transferir</dt>
          <dd class="m-0 font-semibold text-[#0B2438]">USD {{ transfer.eligibility?.totalUSD }}</dd>
        </div>
      </dl>

      <p v-if="transfer.eligibility?.simulado" class="mb-3 font-semibold">Pedido simulado académico · sin cargo real.</p>

      <section aria-label="Instrucciones de transferencia de demostración" class="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
        <h3 class="mb-2 mt-0 font-semibold">Datos de demostración — no realizar transferencias</h3>
        <dl class="m-0 grid grid-cols-1 gap-1">
          <div><dt class="inline font-medium">Banco:</dt> <dd class="m-0 inline">Banco de demostración (ficticio)</dd></div>
          <div><dt class="inline font-medium">Titular:</dt> <dd class="m-0 inline">Ferretería Patagonia (ficticio)</dd></div>
          <div><dt class="inline font-medium">CUIT:</dt> <dd class="m-0 inline">00-00000000-0 (ficticio)</dd></div>
          <div><dt class="inline font-medium">CBU/CVU:</dt> <dd class="m-0 inline">No configurado</dd></div>
          <div><dt class="inline font-medium">Alias:</dt> <dd class="m-0 inline">NO-TRANSFERIR-DEMO</dd></div>
        </dl>
        <p class="mb-0 mt-2">
          Estos datos no corresponden a una cuenta real. El pedido quedará pendiente hasta revisar el comprobante; no se confirma ni acredita el pago automáticamente.
        </p>
      </section>

      <button
        type="button"
        :disabled="!canConfirmTransfer"
        class="flex min-h-12 w-full items-center justify-center rounded-lg border-0 bg-[#103A5C] hover:bg-[#145A8D] px-4 py-2
          font-[inherit] text-base sm:text-sm font-semibold text-white
          focus-visible:outline-2 focus-visible:outline-[#145a8d]
          disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
        @click="confirmTransfer()"
      >
        {{ transfer.attemptState === 'submitting' ? 'Registrando pedido…' : 'Confirmar pedido por transferencia' }}
      </button>
    </template>

    <template v-if="showUnavailable">
      <dl
        v-if="selected === 'CUENTA_CORRIENTE' && !order.eligibilityLoading && !order.eligibilityError && hasServerAmounts"
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
        :role="(selected === 'CUENTA_CORRIENTE' ? order.eligibility?.mensaje : transfer.eligibility?.mensaje) ? 'alert' : 'status'"
      >
        {{ !showTotal
          ? 'La confirmación requiere un total vigente y verificable del carrito.'
        : selected === 'TRANSFERENCIA' && transfer.eligibilityLoading
          ? 'Verificando las condiciones del pedido por transferencia.'
          : selected === 'TRANSFERENCIA' && transfer.eligibilityError
            ? 'No se pudo verificar el total del pedido por transferencia.'
            : selected === 'TRANSFERENCIA' && transfer.eligibility?.mensaje
              ? transfer.eligibility.mensaje
              : selected === 'CUENTA_CORRIENTE' && order.eligibilityLoading
            ? 'Verificando las condiciones de la cuenta corriente.'
          : selected === 'CUENTA_CORRIENTE' && order.eligibilityError
              ? 'No se pudo verificar la elegibilidad del pedido.'
            : order.eligibility?.mensaje ||
              'No hay una modalidad de pago habilitada para este pedido.' }}
      </p>
      <button
        v-if="selected === 'CUENTA_CORRIENTE' && order.eligibility && !order.eligibility.elegible && showTotal"
        type="button"
        :disabled="busy"
        class="mt-2 inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center border-0 bg-transparent p-0 font-[inherit] text-sm font-medium text-[#103a5c] underline focus-visible:outline-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-60"
        @click="retryEligibility()"
      >
        Volver a consultar elegibilidad
      </button>
      <button
        v-if="selected === 'TRANSFERENCIA' && transfer.eligibility && !transfer.eligibility.elegible && showTotal"
        type="button"
        :disabled="busy"
        class="mt-2 inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center border-0 bg-transparent p-0 font-[inherit] text-sm font-medium text-[#103a5c] underline focus-visible:outline-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-60"
        @click="transfer.loadEligibility()"
      >
        Volver a consultar el total
      </button>
    </template>

    <p v-if="order.storageError" role="alert" class="mb-0 mt-2 text-xs text-amber-800">
      {{ order.storageError }}
    </p>
    <p v-if="transfer.storageError" role="alert" class="mb-0 mt-2 text-xs text-amber-800">
      {{ transfer.storageError }}
    </p>
  </section>
</template>
