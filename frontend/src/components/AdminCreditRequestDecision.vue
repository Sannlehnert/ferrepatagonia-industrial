<script setup lang="ts">
import axios from 'axios'
import { onBeforeUnmount, ref } from 'vue'
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
let active = true

onBeforeUnmount(() => { active = false })

function openDecision(nextAction: 'approve' | 'reject') {
  action.value = nextAction
  limit.value = props.request.montoSolicitado
  term.value = props.request.plazoDias
  reason.value = ''
  evidence.value = ''
  error.value = ''
  idempotencyKey = undefined
  retrySameRequest.value = false
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
  <div v-if="!action" class="flex flex-wrap gap-2">
    <button
      type="button"
      class="rounded border border-slate-300 px-3 py-2"
      :aria-label="`Aprobar solicitud ${request.id}`"
      @click="openDecision('approve')"
    >
      Aprobar
    </button>
    <button
      type="button"
      class="rounded border border-slate-300 px-3 py-2"
      :aria-label="`Rechazar solicitud ${request.id}`"
      @click="openDecision('reject')"
    >
      Rechazar
    </button>
  </div>

  <form v-else class="w-full rounded border border-slate-200 p-3" @submit.prevent="submitDecision">
    <h3 class="font-semibold">
      {{ action === 'approve' ? 'Aprobar' : 'Rechazar' }} solicitud #{{ request.id }}
    </h3>

    <fieldset :disabled="submitting || retrySameRequest" class="mt-3 grid gap-3">
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
        class="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
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
        @click="action = null"
      >
        Cancelar
      </button>
    </div>
  </form>
</template>