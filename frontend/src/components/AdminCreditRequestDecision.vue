<script setup lang="ts">
import axios from 'axios'
import { nextTick, onBeforeUnmount, ref } from 'vue'
import {
  approveAdminCreditRequest,
  rejectAdminCreditRequest,
  type AdminCreditRequest,
  type CreditTerm,
} from '@/services/adminCreditService'

const props = defineProps<{ request: AdminCreditRequest }>()
const emit = defineEmits<{ resolved: [message: string] }>()

const action = ref<'approve' | 'reject' | null>(null)
const limit = ref('')
const term = ref<CreditTerm>(30)
const reason = ref('')
const evidence = ref('')
const submitting = ref(false)
const retrySameRequest = ref(false)
const error = ref('')

let idempotencyKey: string | undefined
const fields = ref<HTMLFieldSetElement | null>(null)
const primaryTrigger = ref<HTMLButtonElement | null>(null)
const secondaryTrigger = ref<HTMLButtonElement | null>(null)
let active = true

onBeforeUnmount(() => { active = false })

async function openDecision(nextAction: 'approve' | 'reject') {
  action.value = nextAction
  limit.value = props.request.montoSolicitado
  term.value = props.request.plazoDias
  reason.value = ''
  evidence.value = ''
  error.value = ''
  idempotencyKey = undefined
  retrySameRequest.value = false
  await nextTick()
  if (active && action.value === nextAction) fields.value?.querySelector<HTMLElement>('input, select, textarea')?.focus()
}

async function cancel() {
  if (submitting.value || retrySameRequest.value || !action.value) return
  const previous = action.value
  action.value = null
  await nextTick()
  if (active && !action.value) (previous === 'reject' ? secondaryTrigger.value : primaryTrigger.value)?.focus()
}

function onEscape(event: KeyboardEvent) {
  if (submitting.value || retrySameRequest.value) return
  event.preventDefault()
  event.stopPropagation()
  void cancel()
}

async function submitDecision() {
  const decision = action.value
  if (!decision || submitting.value) return

  error.value = ''
  const motivo = reason.value.trim()
  const evidencia = evidence.value.trim()
  const limiteAutorizado = limit.value.trim().replace(',', '.')

  if (!motivo) {
    error.value = 'Ingresá el motivo de la decisión.'
    return
  }

  if (decision === 'approve') {
    if (!/^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(limiteAutorizado)
      || Number(limiteAutorizado) === 0) {
      error.value = 'Ingresá un límite USD mayor a cero, con hasta dos decimales.'
      return
    }

    if (!evidencia) {
      error.value = 'Ingresá la evidencia comercial de la aprobación.'
      return
    }
  }

  submitting.value = true

  try {
    idempotencyKey ??= crypto.randomUUID()

    if (decision === 'approve') {
      await approveAdminCreditRequest(
        props.request.id,
        { limiteAutorizado, plazoDias: term.value, motivo, evidencia },
        idempotencyKey,
      )
    } else {
      await rejectAdminCreditRequest(
        props.request.id,
        { motivo, ...(evidencia ? { evidencia } : {}) },
        idempotencyKey,
      )
    }

    if (!active) return
    emit('resolved', decision === 'approve'
      ? 'Solicitud aprobada. La habilitación de la cuenta se gestiona por separado.'
      : 'Solicitud rechazada.')
  } catch (cause) {
    if (!active) return

    const response = axios.isAxiosError<{ message?: string; code?: string }>(cause)
      ? cause.response
      : undefined
    const code = response?.data?.code
    const uncertain = axios.isAxiosError(cause)
      && (!response || response.status >= 500 || code === 'CONFLICTO_CONCURRENCIA')

    retrySameRequest.value = uncertain

    if (uncertain) {
      error.value = 'No pudimos confirmar el resultado. Reintentá la misma operación.'
    } else {
      idempotencyKey = undefined
      error.value = response?.data?.message || 'No se pudo resolver la solicitud.'
    }
  } finally {
    if (active) submitting.value = false
  }
}
</script>

<template>
  <div v-if="!action" class="credit-decision flex flex-wrap gap-2">
    <button
      ref="primaryTrigger"
      type="button"
      class="rounded border border-slate-300 px-3 py-2"
      :aria-label="`Aprobar solicitud ${request.id}`"
      @click="openDecision('approve')"
    >
      Aprobar
    </button>
    <button
      ref="secondaryTrigger"
      type="button"
      class="rounded border border-slate-300 px-3 py-2"
      :aria-label="`Rechazar solicitud ${request.id}`"
      @click="openDecision('reject')"
    >
      Rechazar
    </button>
  </div>

  <form v-else class="credit-decision w-full rounded border border-slate-200 p-3" @keydown.esc="onEscape" @submit.prevent="submitDecision">
    <h3 class="font-semibold">
      {{ action === 'approve' ? 'Aprobar' : 'Rechazar' }} solicitud #{{ request.id }}
    </h3>
    <p class="mt-1 text-sm leading-6 text-slate-600">
      {{ action === 'approve'
        ? 'La aprobación autoriza un límite y un plazo. No habilita la cuenta corriente; la habilitación se gestiona por separado.'
        : 'El rechazo requiere un motivo. La empresa podrá presentar una nueva solicitud cuando corresponda.' }}
    </p>

    <fieldset ref="fields" :disabled="submitting || retrySameRequest" class="mt-3 grid gap-3">
      <template v-if="action === 'approve'">
        <label class="grid gap-1">
          Límite autorizado (USD)
          <input
            v-model="limit"
            required
            inputmode="decimal"
            maxlength="13"
            class="w-full rounded border border-slate-300 p-2"
          />
        </label>

        <label class="grid gap-1">
          Plazo autorizado
          <select v-model="term" class="w-full rounded border border-slate-300 p-2">
            <option :value="30">30 días</option>
            <option :value="60">60 días</option>
          </select>
        </label>
      </template>

      <label class="grid gap-1">
        Motivo
        <textarea
          v-model="reason"
          required
          maxlength="1000"
          class="w-full rounded border border-slate-300 p-2"
        />
      </label>

      <label class="grid gap-1">
        {{ action === 'approve' ? 'Evidencia comercial' : 'Evidencia (opcional)' }}
        <textarea
          v-model="evidence"
          :required="action === 'approve'"
          maxlength="1000"
          class="w-full rounded border border-slate-300 p-2"
        />
      </label>
    </fieldset>

    <p v-if="error" role="alert" class="mt-3 text-red-700">{{ error }}</p>

    <div class="mt-3 flex flex-wrap gap-2">
      <button
        type="submit"
        :disabled="submitting"
        class="rounded bg-[#103A5C] px-3 py-2 text-white disabled:opacity-50"
      >
        {{ submitting ? 'Guardando…'
          : retrySameRequest ? 'Reintentar operación'
          : action === 'approve' ? 'Confirmar aprobación' : 'Confirmar rechazo' }}
      </button>
      <button
        v-if="!retrySameRequest"
        type="button"
        :disabled="submitting"
        class="rounded border border-slate-300 px-3 py-2"
        @click="cancel"
      >
        Cancelar
      </button>
    </div>
  </form>
</template>
<style scoped>
.credit-decision, .credit-decision * { box-sizing: border-box; min-width: 0; }
.credit-decision { max-width: 100%; color: #0b2438; }
.credit-decision fieldset { margin-inline: 0; border: 0; padding: 0; }
.credit-decision :is(button, input, select, textarea) { min-height: 44px; max-width: 100%; font: inherit; font-size: 14px; }
.credit-decision :is(input, select, textarea) { width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; background: white; color: #0b2438; padding: 8px; }
.credit-decision textarea { min-height: 88px; resize: vertical; }
.credit-decision button { min-width: 44px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 16px; background: white; color: #103a5c; font-weight: 600; cursor: pointer; }
.credit-decision button:hover:not(:disabled) { background: #f1f5f9; }
.credit-decision button[type="submit"] { border-color: transparent; background: #103a5c; color: white; }
.credit-decision button[type="submit"]:hover:not(:disabled) { background: #145a8d; }
.credit-decision :is(button, input, select, textarea):focus-visible { outline: 2px solid #145a8d; outline-offset: 2px; }
.credit-decision :is(button, input, select, textarea):disabled { opacity: .5; cursor: not-allowed; }
</style>
