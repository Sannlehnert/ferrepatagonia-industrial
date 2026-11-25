<script setup lang="ts">
import axios from 'axios'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAdminDialog } from '@/composables/useAdminDialog'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import {
  canReview,
  documentLabel,
  financialLabel,
  formatPaymentMoney,
  getAdminPayment,
  mapPaymentError,
  reviewAdminPayment,
  type AdminPayment,
  type ReviewDecision,
} from '@/services/adminPaymentService'
import { useAuthStore } from '@/stores/auth'
import { formatInstant } from '@/utils/cuentaCorriente'

const props = defineProps<{ paymentId: number; decision: ReviewDecision }>()
const emit = defineEmits<{ close: []; updated: [payment: AdminPayment] }>()

const auth = useAuthStore()
const identity = () => [auth.user?.id, auth.rol, auth.sessionVersion].join(':')
const allowed = () => auth.isAuthenticated && !auth.loggingIn && !auth.loggingOut && auth.rol === 'ADMIN'
const state = usePrivateAccountRead<AdminPayment>(identity, allowed)
const payment = computed(() => state.data.value)

const reason = ref('')
const confirmed = ref(false)
const busy = ref(false)
const uncertain = ref(false)
const operationError = ref('')
const fieldError = ref('')
const notice = ref('')
const closeButton = ref<HTMLButtonElement | null>(null)
const formFocus = ref<HTMLElement | null>(null)
let mutation: AbortController | undefined
let refreshController: AbortController | undefined
let active = true

const approving = computed(() => props.decision === 'APROBADO')
const title = computed(() => approving.value ? 'Aprobar documento' : 'Rechazar documento')
const reviewable = computed(() => payment.value ? canReview(payment.value) : false)
const close = () => emit('close')
const { dialog, initialFocus, handleCancel, handleKeydown, handleNativeClose, requestClose, focusInitial } = useAdminDialog({
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
  if (active && state.data.value && !state.error.value) {
    initialFocus.value = reviewable.value ? formFocus.value : closeButton.value
    focusInitial()
  }
}

function reload() {
  if (busy.value) return
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

async function refreshAfterUncertain() {
  const current = await refreshState()
  if (!active) return

  if (!current) {
    operationError.value = 'No pudimos confirmar el resultado ni consultar el estado actual. Cerrá el diálogo y recargá el listado antes de reintentar.'
    return
  }

  const applied = approving.value
    ? current.estadoDocumental === 'APROBADO'
    : current.estadoDocumental === 'RECHAZADO' && current.motivoRevision === reason.value.trim()
  if (applied) {
    uncertain.value = false
    notice.value = approving.value
      ? 'El servidor confirmó la aprobación documental. No se acreditó dinero.'
      : 'El servidor confirmó el rechazo documental. No se acreditó dinero.'
    emit('updated', current)
    return
  }

  operationError.value = 'No pudimos confirmar el resultado de la revisión. El estado actualizado se muestra abajo; verificá antes de repetir la operación.'
}

async function submit() {
  fieldError.value = ''
  operationError.value = ''
  notice.value = ''

  const current = payment.value
  if (!current || busy.value) return
  if (!allowed() || !canReview(current)) {
    fieldError.value = 'Este pago no admite revisión documental en su estado actual.'
    return
  }

  const value = reason.value.trim()
  if (!approving.value && !value) {
    fieldError.value = 'Indicá el motivo del rechazo documental.'
    return
  }
  if (value.length > 1000) {
    fieldError.value = 'El motivo debe contener hasta 1000 caracteres.'
    return
  }
  if (!confirmed.value) {
    fieldError.value = 'Confirmá expresamente que verificaste el comprobante antes de continuar.'
    return
  }

  const controller = new AbortController()
  mutation = controller
  const currentIdentity = identity()
  const valid = () => active && !controller.signal.aborted && identity() === currentIdentity && allowed()
  busy.value = true

  try {
    const updated = await reviewAdminPayment(
      props.paymentId,
      props.decision,
      approving.value ? undefined : value,
      controller.signal,
    )
    if (!valid()) return
    state.data.value = updated
    notice.value = approving.value
      ? 'Documento aprobado. El pago continúa pendiente de acreditación y no se generó ningún abono.'
      : 'Documento rechazado. El pago quedó cerrado y no se generó ningún abono.'
    uncertain.value = false
    emit('updated', updated)
  } catch (cause) {
    if (!valid()) return

    if (isUncertain(cause)) {
      uncertain.value = true
      await refreshAfterUncertain()
    } else {
      uncertain.value = false
      const response = axios.isAxiosError<{ message?: string; code?: string }>(cause)
        ? cause.response
        : undefined
      const code = response?.data?.code
      if (code === 'PAGO_YA_REVISADO' || code === 'PAGO_YA_ACREDITADO'
        || code === 'PAGO_DOCUMENTALMENTE_RECHAZADO' || code === 'TRANSICION_PAGO_INVALIDA') {
        const fresh = await refreshState()
        if (fresh) emit('updated', fresh)
      }
      operationError.value = response?.data?.message
        || mapPaymentError(code, response?.status)
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
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      aria-labelledby="payment-review-title"
      aria-describedby="payment-review-description"
      class="box-border m-auto w-[calc(100%-1rem)] max-w-xl border-0 bg-transparent p-0 text-left text-[#0b2438] backdrop:bg-[#0b2438]/70 sm:w-[calc(100%-2rem)]"
      @cancel="handleCancel"
      @close="handleNativeClose"
      @keydown="handleKeydown"
    >
      <div class="box-border flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header class="box-border shrink-0 border-b border-slate-200 bg-[#f8fafc] px-4 py-3 sm:px-6 sm:py-4">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#145a8d]">Revisión documental</p>
          <h2 id="payment-review-title" class="m-0 mt-1 text-lg font-bold sm:text-xl">
            {{ title }} · Pago #{{ paymentId }}
          </h2>
        </header>

        <div class="box-border min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 text-sm sm:px-6">
          <p id="payment-review-description" class="m-0 rounded-md border border-sky-200 bg-sky-50 p-3 text-[#0b2438]">
            La revisión documental no acredita dinero. Solo valida el comprobante asociado.
          </p>

          <p v-if="state.loading.value" role="status" class="m-0 text-slate-600">Consultando el estado actual del pago…</p>

          <div v-else-if="state.error.value" class="space-y-2">
            <p role="alert" class="m-0 rounded-md border border-red-200 bg-red-50 p-3 text-red-800 [overflow-wrap:anywhere]">
              No se pudo consultar el pago. No se envió ninguna revisión.
            </p>
            <button
              type="button"
              class="box-border min-h-11 cursor-pointer rounded-md border border-[#145a8d] bg-white px-4 font-[inherit] text-sm font-semibold text-[#145a8d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed"
              @click="reload"
            >
              Reintentar consulta
            </button>
          </div>

          <template v-else-if="payment">
            <dl class="m-0 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-[#f8fafc] p-3 sm:grid-cols-2">
              <div class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Cliente</dt>
                <dd class="m-0 font-semibold [overflow-wrap:anywhere]">{{ payment.cliente }} · Cliente #{{ payment.clienteId }}</dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Importe original</dt>
                <dd class="m-0 font-semibold">{{ formatPaymentMoney(payment.monto, payment.moneda) }}</dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Estado documental</dt>
                <dd class="m-0 font-semibold">{{ documentLabel(payment.estadoDocumental) }}</dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Estado financiero</dt>
                <dd class="m-0 font-semibold">{{ financialLabel(payment.estado) }}</dd>
              </div>
              <div class="min-w-0 sm:col-span-2">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Comprobante</dt>
                <dd class="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 break-all font-mono text-xs">
                  <span>{{ payment.comprobanteId ?? 'Sin comprobante asociado' }}</span>
                  <span v-if="payment.comprobanteTipoMime" class="font-sans font-semibold">
                    · {{ payment.comprobanteTipoMime === 'application/pdf' ? 'PDF' : payment.comprobanteTipoMime === 'image/png' ? 'PNG' : 'JPG' }}
                  </span>
                  <a
                    v-if="payment.comprobanteId"
                    :href="`/api/admin/comprobantes/${payment.comprobanteId}`"
                    class="box-border inline-flex min-h-[44px] cursor-pointer items-center font-sans text-xs font-semibold text-[#145a8d] underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
                  >
                    Descargar comprobante
                  </a>
                </dd>
              </div>
              <div class="min-w-0 sm:col-span-2">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Declarado</dt>
                <dd class="m-0">{{ formatInstant(payment.fecha) }}</dd>
              </div>
            </dl>

            <p
              v-if="notice"
              role="status"
              class="m-0 rounded-md border border-emerald-200 bg-emerald-50 p-3 font-medium text-emerald-800 [overflow-wrap:anywhere]"
            >
              {{ notice }}
            </p>

            <p
              v-if="operationError"
              role="alert"
              class="m-0 rounded-md border border-red-200 bg-red-50 p-3 text-red-800 [overflow-wrap:anywhere]"
            >
              {{ operationError }}
            </p>

            <p
              v-if="uncertain"
              role="alert"
              class="m-0 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 [overflow-wrap:anywhere]"
            >
              No afirmamos que la revisión haya fallado ni que se haya completado. El estado mostrado proviene del servidor.
            </p>

            <form v-if="canReview(payment) && !notice" class="space-y-4" @submit.prevent="submit">
              <label v-if="!approving" class="box-border grid cursor-pointer gap-1">
                <span class="font-semibold">Motivo del rechazo documental</span>
                <textarea
                  ref="formFocus"
                  v-model="reason"
                  aria-label="Motivo del rechazo documental"
                  required
                  maxlength="1000"
                  rows="4"
                  class="box-border min-h-24 w-full resize-y rounded-md border border-slate-300 bg-white p-3 font-[inherit] text-sm text-[#0b2438] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:bg-slate-100"
                  :disabled="busy"
                />
                <span class="text-xs text-slate-500">{{ reason.length }} / 1000 caracteres</span>
              </label>

              <label class="box-border flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3">
                <input
                  :ref="el => { if (approving) formFocus = el as HTMLElement | null }"
                  v-model="confirmed"
                  type="checkbox"
                  class="box-border mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[#145a8d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed"
                  :disabled="busy"
                />
                <span>
                  Confirmo que verifiqué el comprobante asociado y que esta decisión no acredita dinero.
                </span>
              </label>

              <p v-if="fieldError" role="alert" class="m-0 text-sm font-medium text-red-700 [overflow-wrap:anywhere]">{{ fieldError }}</p>

              <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  class="box-border min-h-11 cursor-pointer rounded-md border border-slate-300 bg-white px-4 font-[inherit] text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-60"
                  :disabled="busy"
                  @click="requestClose"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  class="box-border min-h-11 cursor-pointer rounded-md border border-transparent px-5 font-[inherit] text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-60"
                  :class="approving ? 'bg-[#15803d] hover:bg-[#166534]' : 'bg-[#b91c1c] hover:bg-[#991b1b]'"
                  :disabled="busy || !confirmed"
                >
                  {{ busy ? 'Guardando…' : approving ? 'Confirmar aprobación' : 'Confirmar rechazo' }}
                </button>
              </div>
            </form>

            <p v-else-if="!canReview(payment) && !notice" role="status" class="m-0 rounded-md border border-slate-200 bg-slate-50 p-3 [overflow-wrap:anywhere]">
              Este pago no admite una nueva revisión documental en su estado actual.
            </p>
          </template>
        </div>

        <footer v-if="notice || !reviewable" class="box-border flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-[#f8fafc] px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
          <button
            ref="closeButton"
            type="button"
            class="box-border min-h-11 cursor-pointer rounded-md border border-slate-300 bg-white px-4 font-[inherit] text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="busy"
            @click="requestClose"
          >
            Cerrar
          </button>
        </footer>
      </div>
    </dialog>
  </Teleport>
</template>
