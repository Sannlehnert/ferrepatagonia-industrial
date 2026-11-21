<script setup lang="ts">
import axios from 'axios'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAdminDialog } from '@/composables/useAdminDialog'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import {
  accreditAdminPayment,
  canAccredit,
  createAccreditationKey,
  documentLabel,
  financialLabel,
  formatPaymentMoney,
  getAdminPayment,
  mapPaymentError,
  type AdminPayment,
} from '@/services/adminPaymentService'
import { useAuthStore } from '@/stores/auth'
import { formatInstant } from '@/utils/cuentaCorriente'

const props = defineProps<{ paymentId: number }>()
const emit = defineEmits<{ close: []; updated: [payment: AdminPayment] }>()

const auth = useAuthStore()
const identity = () => [auth.user?.id, auth.rol, auth.sessionVersion].join(':')
const allowed = () => auth.isAuthenticated && !auth.loggingIn && !auth.loggingOut && auth.rol === 'ADMIN'
const state = usePrivateAccountRead<AdminPayment>(identity, allowed)
const payment = computed(() => state.data.value)
const accreditable = computed(() => payment.value ? canAccredit(payment.value) : false)

const evidence = ref('')
const confirmed = ref(false)
const busy = ref(false)
const uncertain = ref(false)
const operationError = ref('')
const fieldError = ref('')
const notice = ref('')
const consulting = ref(false)

// La clave se genera una única vez por intento y se conserva para reintentos
// inciertos. Nunca se regenera automáticamente después de un timeout.
let idempotencyKey: string | undefined
let attemptedEvidence: string | undefined
let mutation: AbortController | undefined
let refreshController: AbortController | undefined
let active = true

const close = () => emit('close')
const { dialog, handleCancel, handleKeydown, handleNativeClose, requestClose, focusInitial } = useAdminDialog({
  canClose: () => !busy.value,
  onClose: close,
})

onBeforeUnmount(() => {
  active = false
  mutation?.abort()
  refreshController?.abort()
})

onMounted(() => {
  void load()
})

async function load() {
  operationError.value = ''
  notice.value = ''
  await state.load(signal => getAdminPayment(props.paymentId, signal))
  await nextTick()
  if (active && state.data.value && !state.error.value) focusInitial()
}

function reload() {
  if (busy.value || consulting.value) return
  void load()
}

function isUncertain(cause: unknown): boolean {
  if (!axios.isAxiosError(cause)) return true
  const response = cause.response
  const code = response?.data?.code as string | undefined
  return !response || response.status >= 500
    || code === 'RESULTADO_DESCONOCIDO'
    || code === 'CONFLICTO_CONCURRENCIA'
}

async function refreshState(): Promise<AdminPayment | null> {
  refreshController?.abort()
  const controller = new AbortController()
  refreshController = controller
  try {
    const fresh = await getAdminPayment(props.paymentId, controller.signal)
    if (!active || controller.signal.aborted) return null
    state.data.value = fresh
    state.error.value = null
    return fresh
  } catch {
    if (!active || controller.signal.aborted) return null
    return null
  }
}

function applyKnownOutcome(fresh: AdminPayment) {
  if (fresh.estado === 'ACREDITADO') {
    uncertain.value = false
    operationError.value = ''
    notice.value = `El servidor confirma que el pago está acreditado${fresh.montoUsd ? ` por ${formatPaymentMoney(fresh.montoUsd, 'USD')}` : ''}. No se envió un segundo movimiento.`
    emit('updated', fresh)
    return
  }

  if (fresh.estado === 'RECHAZADO' || fresh.estado === 'ANULADO') {
    uncertain.value = false
    idempotencyKey = undefined
    attemptedEvidence = undefined
    operationError.value = 'El pago ya no se encuentra pendiente de acreditación.'
    emit('updated', fresh)
    return
  }

  operationError.value = 'El servidor confirma que el pago continúa pendiente de acreditación. Podés reintentar con la misma clave de idempotencia.'
}

async function consultState() {
  if (busy.value || consulting.value) return
  consulting.value = true
  operationError.value = ''
  try {
    const fresh = await refreshState()
    if (!fresh) {
      operationError.value = 'No se pudo consultar el estado actual. No reintentes sin antes recuperar la consulta.'
      return
    }
    applyKnownOutcome(fresh)
  } finally {
    if (active) consulting.value = false
  }
}

async function submit() {
  fieldError.value = ''
  operationError.value = ''

  const current = payment.value
  if (!current || busy.value || consulting.value) return
  if (!allowed() || !accreditable.value) {
    fieldError.value = 'Este pago no es elegible para acreditación en su estado actual.'
    return
  }

  const value = evidence.value.trim()
  if (!value) {
    fieldError.value = 'Ingresá la evidencia de acreditación.'
    return
  }
  if (value.length > 1000) {
    fieldError.value = 'La evidencia debe contener hasta 1000 caracteres.'
    return
  }
  if (!confirmed.value) {
    fieldError.value = 'Confirmá expresamente la acreditación antes de continuar.'
    return
  }
  if (uncertain.value && attemptedEvidence && value !== attemptedEvidence) {
    fieldError.value = 'Para reintentar un resultado incierto usá exactamente la misma evidencia y clave.'
    return
  }

  idempotencyKey ??= createAccreditationKey()
  attemptedEvidence = value
  const keyForAttempt = idempotencyKey

  const controller = new AbortController()
  mutation = controller
  const currentIdentity = identity()
  const valid = () => active && !controller.signal.aborted && identity() === currentIdentity && allowed()
  busy.value = true
  notice.value = ''

  try {
    const updated = await accreditAdminPayment(props.paymentId, value, keyForAttempt, controller.signal)
    if (!valid()) return
    state.data.value = updated
    uncertain.value = false
    operationError.value = ''
    notice.value = 'Acreditación confirmada por el servidor. Se registró un único movimiento de abono.'
    emit('updated', updated)
  } catch (cause) {
    if (!valid()) return

    if (isUncertain(cause)) {
      uncertain.value = true
      const fresh = await refreshState()
      if (!active) return
      if (fresh) {
        applyKnownOutcome(fresh)
      } else {
        operationError.value = 'No pudimos confirmar el resultado ni consultar el estado actual. No afirmamos que la acreditación haya fallado ni que se haya completado. Consultá el estado antes de reintentar.'
      }
      return
    }

    const response = axios.isAxiosError<{ message?: string; code?: string }>(cause)
      ? cause.response
      : undefined
    const code = response?.data?.code

    // Una respuesta funcional 4xx/409/422 garantiza que el servidor no aplicó
    // la acreditación. Se libera la clave para un intento futuro corregido.
    idempotencyKey = undefined
    attemptedEvidence = undefined
    uncertain.value = false

    if (code === 'PAGO_YA_ACREDITADO' || code === 'PAGO_PENDIENTE_REVISION'
      || code === 'TRANSICION_PAGO_INVALIDA' || code === 'COMPROBANTE_NO_ENCONTRADO') {
      const fresh = await refreshState()
      if (fresh) emit('updated', fresh)
    }
    operationError.value = response?.data?.message
      || mapPaymentError(code, response?.status)
  } finally {
    if (active) busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      aria-labelledby="payment-accreditation-title"
      aria-describedby="payment-accreditation-description"
      class="box-border m-auto w-[calc(100%-1rem)] max-w-xl border-0 bg-transparent p-0 text-left text-[#0b2438] backdrop:bg-[#0b2438]/70 sm:w-[calc(100%-2rem)]"
      @cancel="handleCancel"
      @close="handleNativeClose"
      @keydown="handleKeydown"
    >
      <div class="box-border flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header class="box-border shrink-0 border-b border-slate-200 bg-[#f8fafc] px-4 py-3 sm:px-6 sm:py-4">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#b45309]">Acreditación financiera</p>
          <h2 id="payment-accreditation-title" class="m-0 mt-1 text-lg font-bold sm:text-xl">
            Acreditar pago #{{ paymentId }}
          </h2>
        </header>

        <div class="box-border min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 text-sm sm:px-6">
          <p id="payment-accreditation-description" class="m-0 rounded-md border border-amber-300 bg-amber-50 p-3 text-[#0b2438]">
            Esta acción registra un abono real en la cuenta corriente. La autorización y la idempotencia se validan en el backend.
          </p>

          <p v-if="state.loading.value" role="status" class="m-0 text-slate-600">Consultando nuevamente el pago…</p>

          <div v-else-if="state.error.value" class="space-y-2">
            <p role="alert" class="m-0 rounded-md border border-red-200 bg-red-50 p-3 text-red-800">
              No se pudo consultar el pago. No se envió ninguna acreditación.
            </p>
            <button
              type="button"
              class="min-h-11 rounded-md border border-[#145a8d] bg-white px-4 font-[inherit] text-sm font-semibold text-[#145a8d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
              @click="reload"
            >
              Reintentar consulta
            </button>
          </div>

          <template v-else-if="payment">
            <dl class="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-[#f8fafc] p-3 sm:grid-cols-2">
              <div>
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Cliente</dt>
                <dd class="m-0 break-words font-semibold">{{ payment.cliente }} · Cliente #{{ payment.clienteId }}</dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Importe original</dt>
                <dd class="m-0 text-lg font-bold">{{ formatPaymentMoney(payment.monto, payment.moneda) }}</dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Estado documental</dt>
                <dd class="m-0 font-semibold">{{ documentLabel(payment.estadoDocumental) }}</dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Estado financiero</dt>
                <dd class="m-0 font-semibold">{{ financialLabel(payment.estado) }}</dd>
              </div>
              <div class="sm:col-span-2">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Comprobante</dt>
                <dd class="m-0 break-all font-mono text-xs">{{ payment.comprobanteId ?? 'Sin comprobante asociado' }}</dd>
              </div>
              <div class="sm:col-span-2">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Acreditación</dt>
                <dd class="m-0">
                  <template v-if="payment.montoUsd">
                    {{ formatPaymentMoney(payment.montoUsd, 'USD') }} ·
                    {{ payment.moneda === 'ARS' ? 'conversión confirmada por el backend' : 'importe acreditado confirmado por el backend' }}.
                  </template>
                  <template v-else-if="payment.moneda === 'ARS'">
                    El importe en USD se confirmará al acreditar mediante la cotización FER17-v1.
                    La interfaz no estima conversiones.
                  </template>
                  <template v-else>
                    El importe USD se confirmará al acreditar.
                  </template>
                </dd>
              </div>
            </dl>

            <p
              v-if="notice"
              role="status"
              class="m-0 rounded-md border border-emerald-200 bg-emerald-50 p-3 font-medium text-emerald-800"
            >
              {{ notice }}
            </p>

            <p
              v-if="operationError"
              role="alert"
              class="m-0 rounded-md border border-red-200 bg-red-50 p-3 text-red-800"
            >
              {{ operationError }}
            </p>

            <div
              v-if="uncertain"
              role="alert"
              class="box-border space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900"
            >
              <p class="m-0">
                El resultado es incierto. No afirmamos que la acreditación haya fallado ni que se haya completado.
                Se conserva la misma clave de idempotencia para un reintento seguro.
              </p>
              <button
                type="button"
                class="min-h-11 rounded-md border border-amber-700 bg-white px-4 font-[inherit] text-sm font-semibold text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:opacity-60"
                :disabled="consulting || busy"
                @click="consultState"
              >
                {{ consulting ? 'Consultando…' : 'Consultar estado actual' }}
              </button>
            </div>

            <form v-if="accreditable && !notice" class="space-y-4" @submit.prevent="submit">
              <label class="grid gap-1">
                <span class="font-semibold">Evidencia de acreditación</span>
                <textarea
                  v-model="evidence"
                  aria-label="Evidencia de acreditación"
                  required
                  maxlength="1000"
                  rows="4"
                  class="box-border min-h-24 w-full resize-y rounded-md border border-slate-300 bg-white p-3 font-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:bg-slate-100"
                  :disabled="busy || consulting || Boolean(uncertain && attemptedEvidence)"
                />
                <span class="text-xs text-slate-500">
                  {{ evidence.length }} / 1000 caracteres. Ejemplo: referencia bancaria o extracto verificado.
                </span>
              </label>

              <label class="flex min-h-11 items-start gap-3 rounded-md border border-slate-200 p-3">
                <input
                  v-model="confirmed"
                  type="checkbox"
                  class="mt-0.5 h-5 w-5 shrink-0 accent-[#145a8d]"
                  :disabled="busy || consulting"
                />
                <span>
                  Confirmo que verifiqué el comprobante, el importe y la evidencia, y que autorizo la acreditación.
                </span>
              </label>

              <p v-if="fieldError" role="alert" class="m-0 text-sm font-medium text-red-700">{{ fieldError }}</p>

              <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  class="min-h-11 rounded-md border border-slate-300 bg-white px-4 font-[inherit] text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-60"
                  :disabled="busy || consulting"
                  @click="requestClose"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  class="min-h-11 rounded-md border-0 bg-[#b45309] px-5 font-[inherit] text-sm font-semibold text-white hover:bg-[#92400e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-60"
                  :disabled="busy || consulting || !confirmed"
                >
                  {{ busy ? 'Acreditando…'
                    : uncertain ? 'Reintentar con la misma clave'
                    : 'Confirmar acreditación' }}
                </button>
              </div>
            </form>

            <p v-else-if="!accreditable && !notice" role="status" class="m-0 rounded-md border border-slate-200 bg-slate-50 p-3">
              Este pago no es elegible para acreditación: se requiere revisión documental aprobada,
              comprobante asociado, estado financiero pendiente y moneda válida.
            </p>
          </template>
        </div>

        <footer class="box-border flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-[#f8fafc] px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
          <button
            v-if="notice || !accreditable"
            type="button"
            class="min-h-11 rounded-md border border-slate-300 bg-white px-4 font-[inherit] text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:opacity-60"
            :disabled="busy || consulting"
            @click="requestClose"
          >
            Cerrar
          </button>
        </footer>
      </div>
    </dialog>
  </Teleport>
</template>
