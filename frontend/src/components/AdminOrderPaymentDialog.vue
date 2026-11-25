<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAdminDialog } from '@/composables/useAdminDialog'
import {
  createAdminOrderPayment,
  findPaymentByIdempotencyKey,
  formatPaymentMoney,
  listAdminPaymentsForOrder,
  mapPaymentError,
  PAYMENT_METHOD_TRANSFER,
  paymentRegistrationNotice,
  type AdminPayment,
  type PaymentCurrency,
} from '@/services/adminPaymentService'
import { useAuthStore } from '@/stores/auth'
import type { AdminOrderDetail } from '@/types/adminOrder'
import { orderDocumentStateBadge, fromCents, isValidPaymentAmount, toCents } from '@/utils/payment'
import { formatAdminOrderMoney } from '@/services/adminOrderService'

const props = defineProps<{
  order: AdminOrderDetail
  existingPayments?: AdminPayment[]
}>()
const emit = defineEmits<{ close: []; created: [payment: AdminPayment] }>()

const auth = useAuthStore()
const allowed = () => auth.isAuthenticated && !auth.loggingIn && !auth.loggingOut && auth.rol === 'ADMIN'

const currency = ref<PaymentCurrency>(props.order.moneda === 'ARS' ? 'ARS' : 'USD')
const amount = ref('')
const reference = ref('')
const observations = ref('')
const confirmed = ref(false)
const busy = ref(false)
const consulting = ref(false)
const uncertain = ref(false)
const operationError = ref('')
const fieldError = ref('')
const notice = ref('')
const created = ref<AdminPayment | null>(null)
const amountInput = ref<HTMLInputElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)

let idempotencyKey: string | undefined
let attemptedPayload: string | undefined
let mutation: AbortController | undefined
let active = true

const close = () => emit('close')
const { dialog, initialFocus, handleCancel, handleKeydown, handleNativeClose, requestClose, focusInitial } = useAdminDialog({
  canClose: () => !busy.value && !consulting.value,
  onClose: close,
})

onBeforeUnmount(() => {
  active = false
  mutation?.abort()
})

const documentBadge = computed(() => orderDocumentStateBadge(props.order.estadoDocumental ?? 'SIN_COMPROBANTE'))
const orderTotal = computed(() => formatAdminOrderMoney(props.order.total, props.order.moneda))
const orderCurrency = computed(() => (props.order.moneda === 'USD' || props.order.moneda === 'ARS' ? props.order.moneda : null))
const accreditedUsd = computed(() => {
  const value = props.order.montoAcreditadoUSD
  if (!value || props.order.moneda !== 'USD') return null
  const cents = toCents(value)
  return cents === null || cents <= 0n ? null : fromCents(cents)
})
const duplicateWarning = computed(() => {
  if (!props.existingPayments?.length) return ''
  const cents = toCents(amount.value.trim())
  if (cents === null) return ''
  const duplicate = props.existingPayments.find(payment =>
    payment.estado !== 'ANULADO'
    && payment.estado !== 'RECHAZADO'
    && payment.moneda === currency.value
    && toCents(payment.monto) === cents)
  if (!duplicate) return ''
  return `Ya existe el pago #${duplicate.id} por el mismo importe y moneda. Verificá que este registro no sea un duplicado accidental.`
})
const canSubmit = computed(() => allowed()
  && !busy.value
  && !consulting.value
  && !notice.value
  && confirmed.value)

function validate(): string {
  const value = amount.value.trim()
  if (!isValidPaymentAmount(value)) return 'Ingresá un importe mayor a cero con hasta dos decimales.'
  if (currency.value !== 'USD' && currency.value !== 'ARS') return 'Seleccioná una moneda admitida: USD o ARS.'
  if (reference.value.trim().length > 2048) return 'La referencia puede contener hasta 2048 caracteres.'
  if (observations.value.trim().length > 1000) return 'Las observaciones pueden contener hasta 1000 caracteres.'
  if (!confirmed.value) return 'Confirmá expresamente el registro del pago antes de continuar.'
  if (uncertain.value && attemptedPayload && payloadSnapshot() !== attemptedPayload) {
    return 'Para reintentar un resultado incierto usá exactamente los mismos datos y la misma clave.'
  }
  return ''
}

function payloadSnapshot(): string {
  return JSON.stringify({
    monto: amount.value.trim(),
    moneda: currency.value,
    referencia: reference.value.trim(),
    observaciones: observations.value.trim(),
  })
}

function isUncertain(cause: unknown): boolean {
  const response = (cause as { response?: { status?: number; data?: { code?: string } } })?.response
  const code = response?.data?.code
  return !response || (response.status ?? 0) >= 500
    || code === 'RESULTADO_DESCONOCIDO'
    || code === 'CONFLICTO_CONCURRENCIA'
}

function applySuccess(payment: AdminPayment, replay: boolean) {
  created.value = payment
  uncertain.value = false
  operationError.value = ''
  notice.value = replay
    ? `El servidor confirmó el registro existente #${payment.id}. ${paymentRegistrationNotice(payment)}`
    : paymentRegistrationNotice(payment)
  emit('created', payment)
}

async function recover() {
  if (!idempotencyKey || consulting.value) return
  consulting.value = true
  operationError.value = ''
  const controller = new AbortController()
  mutation = controller
  try {
    const page = await listAdminPaymentsForOrder(props.order.idPedido, controller.signal)
    if (!active || controller.signal.aborted) return
    const found = findPaymentByIdempotencyKey(page, idempotencyKey)
    if (found) {
      applySuccess(found, true)
      return
    }
    uncertain.value = true
    operationError.value = 'El servidor confirma que no hay un pago registrado con esta clave. Podés reintentar con los mismos datos; no se creó un pago duplicado.'
  } catch {
    if (!active || controller.signal.aborted) return
    operationError.value = 'No pudimos confirmar el resultado ni consultar los pagos del pedido. No afirmamos que el registro haya fallado ni que se haya completado.'
  } finally {
    if (active) consulting.value = false
  }
  if (active && notice.value) {
    await nextTick()
    initialFocus.value = closeButton.value
    focusInitial()
  }
}

async function submit() {
  fieldError.value = ''
  operationError.value = ''
  if (!allowed()) {
    fieldError.value = 'La sesión actual no tiene permisos de administración.'
    return
  }
  const error = validate()
  if (error) {
    fieldError.value = error
    return
  }

  idempotencyKey ??= crypto.randomUUID()
  attemptedPayload = payloadSnapshot()
  const keyForAttempt = idempotencyKey
  const controller = new AbortController()
  mutation = controller
  const currentIdentity = [auth.user?.id, auth.rol, auth.sessionVersion].join(':')
  const valid = () => active
    && !controller.signal.aborted
    && allowed()
    && [auth.user?.id, auth.rol, auth.sessionVersion].join(':') === currentIdentity

  busy.value = true
  notice.value = ''
  try {
    const result = await createAdminOrderPayment({
      pedidoId: props.order.idPedido,
      monto: amount.value.trim(),
      moneda: currency.value,
      metodoPago: PAYMENT_METHOD_TRANSFER,
      referencia: reference.value.trim(),
      observaciones: observations.value.trim(),
    }, keyForAttempt, controller.signal)
    if (!valid()) return
    applySuccess(result.payment, result.replay)
  } catch (cause) {
    if (!valid()) return
    if (isUncertain(cause)) {
      uncertain.value = true
      operationError.value = 'El resultado es incierto. No afirmamos que el pago se haya registrado ni que haya fallado. Consultá el estado antes de reintentar.'
      await recover()
    } else {
      const response = (cause as { response?: { status?: number; data?: { message?: string; code?: string } } })?.response
      idempotencyKey = undefined
      attemptedPayload = undefined
      uncertain.value = false
      fieldError.value = response?.data?.message || mapPaymentError(response?.data?.code, response?.status)
    }
  } finally {
    if (active) busy.value = false
  }

  if (active && notice.value) {
    await nextTick()
    initialFocus.value = closeButton.value
    focusInitial()
  }
}

function onDialogMounted() {
  initialFocus.value = amountInput.value
  focusInitial()
}

onMounted(onDialogMounted)
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      aria-labelledby="admin-order-payment-title"
      aria-describedby="admin-order-payment-description"
      class="box-border m-auto w-[calc(100%-1rem)] max-w-xl border-0 bg-transparent p-0 text-left text-[#0b2438] backdrop:bg-[#0b2438]/70 sm:w-[calc(100%-2rem)]"
      @cancel="handleCancel"
      @close="handleNativeClose"
      @keydown="handleKeydown"
    >
      <div class="box-border flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header class="box-border shrink-0 border-b border-slate-200 bg-[#f8fafc] px-4 py-3 sm:px-6 sm:py-4">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#145a8d]">Pago directo de pedido</p>
          <h2 id="admin-order-payment-title" class="m-0 mt-1 text-lg font-bold sm:text-xl">
            Registrar pago del pedido #{{ order.idPedido }}
          </h2>
        </header>

        <div class="box-border min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 text-sm sm:px-6">
          <p id="admin-order-payment-description" class="m-0 rounded-md border border-sky-200 bg-sky-50 p-3 text-[#0b2438] [overflow-wrap:anywhere]">
            El pago se registra en estado PENDIENTE. No se acredita automáticamente y no genera un ABONO de cuenta corriente.
            La referencia es un texto administrativo: no vincula el archivo del comprobante al pago financiero.
          </p>

          <dl class="m-0 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-[#f8fafc] p-3 sm:grid-cols-2">
            <div class="min-w-0">
              <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Pedido</dt>
              <dd class="m-0 font-semibold">#{{ order.idPedido }} · Transferencia bancaria</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Cliente</dt>
              <dd class="m-0 font-semibold [overflow-wrap:anywhere]">{{ order.cliente.nombreRazonSocial }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Total del pedido</dt>
              <dd class="m-0 font-semibold">{{ orderTotal }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Moneda del pedido</dt>
              <dd class="m-0 font-semibold">{{ orderCurrency ?? 'No informada' }}</dd>
            </div>
            <div v-if="accreditedUsd" class="min-w-0">
              <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Ya acreditado</dt>
              <dd class="m-0 font-semibold">{{ formatPaymentMoney(accreditedUsd, 'USD') }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Estado documental del pedido</dt>
              <dd class="m-0">
                <span class="box-border inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" :class="documentBadge.badgeClasses">
                  <span aria-hidden="true" class="h-1.5 w-1.5 shrink-0 rounded-full" :class="documentBadge.dotClasses" />
                  {{ documentBadge.label }}
                </span>
              </dd>
            </div>
          </dl>

          <p v-if="notice" role="status" class="m-0 rounded-md border border-emerald-200 bg-emerald-50 p-3 font-medium text-emerald-800 [overflow-wrap:anywhere]">
            {{ notice }}
          </p>

          <p v-if="operationError" role="alert" class="m-0 rounded-md border border-red-200 bg-red-50 p-3 text-red-800 [overflow-wrap:anywhere]">
            {{ operationError }}
          </p>

          <div v-if="uncertain" role="alert" class="box-border space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
            <p class="m-0 [overflow-wrap:anywhere]">
              El resultado es incierto. Se conserva la misma clave de idempotencia para evitar duplicados.
            </p>
            <button
              type="button"
              class="box-border min-h-11 cursor-pointer rounded-md border border-amber-700 bg-white px-4 font-[inherit] text-sm font-semibold text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="consulting || busy"
              @click="recover"
            >
              {{ consulting ? 'Consultando…' : 'Consultar estado actual' }}
            </button>
          </div>

          <form v-if="!notice" class="space-y-4" @submit.prevent="submit">
            <label class="box-border grid cursor-pointer gap-1">
              <span class="font-semibold">Importe recibido</span>
              <input
                ref="amountInput"
                v-model="amount"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                aria-label="Importe recibido"
                placeholder="0.00"
                maxlength="13"
                required
                class="box-border min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm text-[#0b2438] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:bg-slate-100"
                :disabled="busy || consulting || Boolean(uncertain && attemptedPayload)"
              />
              <span class="text-xs text-slate-500">Hasta dos decimales. Los pagos parciales están permitidos.</span>
            </label>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label class="box-border grid cursor-pointer gap-1">
                <span class="font-semibold">Moneda</span>
                <select
                  v-model="currency"
                  aria-label="Moneda"
                  class="box-border min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm text-[#0b2438] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:bg-slate-100"
                  :disabled="busy || consulting || Boolean(uncertain && attemptedPayload)"
                >
                  <option value="USD">USD</option>
                  <option value="ARS">ARS</option>
                </select>
                <span class="text-xs text-slate-500">El backend admite USD o ARS.</span>
              </label>

              <div class="box-border grid gap-1">
                <span class="font-semibold">Método de pago</span>
                <span class="box-border flex min-h-11 items-center rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                  Transferencia bancaria
                </span>
              </div>
            </div>

            <label class="box-border grid cursor-pointer gap-1">
              <span class="font-semibold">Referencia (opcional)</span>
              <input
                v-model="reference"
                type="text"
                autocomplete="off"
                aria-label="Referencia (opcional)"
                maxlength="2048"
                class="box-border min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm text-[#0b2438] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:bg-slate-100"
                :disabled="busy || consulting || Boolean(uncertain && attemptedPayload)"
              />
              <span class="text-xs text-slate-500">Ejemplo: número de operación bancaria. No adjunta ni vincula el comprobante.</span>
            </label>

            <label class="box-border grid cursor-pointer gap-1">
              <span class="font-semibold">Observaciones (opcionales)</span>
              <textarea
                v-model="observations"
                aria-label="Observaciones (opcionales)"
                rows="3"
                maxlength="1000"
                class="box-border min-h-20 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm text-[#0b2438] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:bg-slate-100"
                :disabled="busy || consulting || Boolean(uncertain && attemptedPayload)"
              />
              <span class="text-xs text-slate-500">{{ observations.length }} / 1000 caracteres.</span>
            </label>

            <p v-if="duplicateWarning" role="alert" class="m-0 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 [overflow-wrap:anywhere]">
              {{ duplicateWarning }}
            </p>

            <label class="box-border flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3">
              <input
                v-model="confirmed"
                type="checkbox"
                class="box-border mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[#145a8d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed"
                :disabled="busy || consulting"
              />
              <span class="min-w-0 [overflow-wrap:anywhere]">
                Confirmo que verifiqué el pedido, el cliente y el importe recibido, y que autorizo registrar este pago en estado PENDIENTE sin acreditarlo automáticamente.
              </span>
            </label>

            <p v-if="fieldError" role="alert" class="m-0 text-sm font-medium text-red-700 [overflow-wrap:anywhere]">{{ fieldError }}</p>

            <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                class="box-border min-h-11 cursor-pointer rounded-md border border-slate-300 bg-white px-4 font-[inherit] text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="busy || consulting"
                @click="requestClose"
              >
                Cancelar
              </button>
              <button
                type="submit"
                class="box-border min-h-11 cursor-pointer rounded-md border border-transparent bg-[#145a8d] px-5 font-[inherit] text-sm font-semibold text-white hover:bg-[#103a5c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="!canSubmit"
              >
                {{ busy ? 'Registrando…' : uncertain ? 'Reintentar con la misma clave' : 'Registrar pago' }}
              </button>
            </div>
          </form>

          <div v-else class="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <router-link
              :to="{ name: 'admin-payments' }"
              class="box-border inline-flex min-h-11 items-center justify-center rounded-md border border-[#145a8d] bg-white px-4 text-sm font-semibold text-[#145a8d] no-underline hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
            >
              Ir a Gestión de pagos
            </router-link>
            <button
              ref="closeButton"
              type="button"
              class="box-border min-h-11 cursor-pointer rounded-md border border-slate-300 bg-white px-4 font-[inherit] text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
              @click="requestClose"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
