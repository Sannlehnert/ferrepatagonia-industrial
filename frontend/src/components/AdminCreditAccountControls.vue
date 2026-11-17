<script setup lang="ts">
import axios from 'axios'
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  changeAdminCreditLimit,
  disableAdminCreditAccount,
  enableAdminCreditAccount,
} from '@/services/adminCreditService'
import type { AccountSummary } from '@/types/adminAccount'

type Action = 'enable' | 'disable' | 'limit'

const props = defineProps<{ clientId: number; account: AccountSummary }>()
const emit = defineEmits<{ updated: [clientId: number, message: string] }>()

const actions = {
  enable: { title: 'Habilitar cuenta', success: 'Cuenta habilitada.' },
  disable: { title: 'Deshabilitar cuenta', success: 'Cuenta deshabilitada.' },
  limit: { title: 'Editar límite', success: 'Límite guardado.' },
}

const action = ref<Action | null>(null)
const limit = ref('')
const reason = ref('')
const evidence = ref('')
const submitting = ref(false)
const retry = ref(false)
const error = ref('')
const formTitle = computed(() => action.value ? actions[action.value].title : '')

let operationKey: string | undefined
let active = true

onBeforeUnmount(() => { active = false })

function openForm(nextAction: Action) {
  action.value = nextAction
  limit.value = props.account.limite ?? ''
  reason.value = ''
  evidence.value = ''
  error.value = ''
  retry.value = false
  operationKey = undefined
}

async function submit() {
  const selectedAction = action.value
  if (!selectedAction || submitting.value) return

  const clientId = props.clientId
  const limite = limit.value.trim().replace(',', '.')
  const motivo = reason.value.trim()
  const evidencia = evidence.value.trim()

  error.value = ''

  if (selectedAction === 'limit' && !/^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(limite)) {
    error.value = 'Ingresá un límite USD no negativo con hasta dos decimales.'
    return
  }

  if (selectedAction !== 'enable' && !motivo) {
    error.value = 'Ingresá el motivo del cambio.'
    return
  }

  if (selectedAction !== 'disable' && !evidencia) {
    error.value = 'Ingresá la evidencia comercial.'
    return
  }

  submitting.value = true

  try {
    operationKey ??= crypto.randomUUID()

    if (selectedAction === 'enable') {
      await enableAdminCreditAccount(
        clientId,
        { evidencia, ...(motivo ? { motivo } : {}) },
        operationKey,
      )
    } else if (selectedAction === 'disable') {
      await disableAdminCreditAccount(
        clientId,
        { motivo, ...(evidencia ? { evidencia } : {}) },
        operationKey,
      )
    } else {
      await changeAdminCreditLimit(clientId, { limite, motivo, evidencia }, operationKey)
    }

    if (!active) return
    action.value = null
    emit('updated', clientId, actions[selectedAction].success)
  } catch (cause) {
    if (!active) return

    const response = axios.isAxiosError<{ message?: string; code?: string }>(cause)
      ? cause.response
      : undefined

    retry.value = axios.isAxiosError(cause) && (
      !response || response.status >= 500 || response.data?.code === 'CONFLICTO_CONCURRENCIA'
    )

    if (retry.value) {
      error.value = 'No se pudo confirmar el resultado. Reintentá la misma operación.'
    } else {
      operationKey = undefined
      error.value = response?.data?.message || 'No se pudo guardar el cambio de crédito.'
    }
  } finally {
    if (active) submitting.value = false
  }
}
</script>

<template>
  <section class="my-4 rounded-lg border border-slate-200 bg-white p-4">
    <h3 class="font-semibold">Gestión de crédito</h3>

    <div v-if="!action" class="mt-3 flex flex-wrap gap-2">
      <button
        v-if="account.estado === 'INHABILITADA'"
        type="button"
        @click="openForm('enable')"
      >
        Habilitar cuenta
      </button>
      <button v-else type="button" @click="openForm('disable')">
        Deshabilitar cuenta
      </button>
      <button type="button" @click="openForm('limit')">Editar límite</button>
    </div>

    <form v-else class="mt-3" @submit.prevent="submit">
      <h4 class="font-medium">{{ formTitle }}</h4>
      <p v-if="action === 'disable'" class="mt-1 text-sm text-slate-600">
        Se suspende el uso de la cuenta para nuevas compras a crédito.
        El historial sigue disponible.
      </p>

      <fieldset :disabled="submitting || retry" class="mt-3 grid gap-3">
        <label v-if="action === 'limit'" class="grid gap-1">
          Nuevo límite (USD)
          <input
            v-model="limit"
            required
            inputmode="decimal"
            maxlength="13"
            class="w-full rounded border border-slate-300 p-2"
          />
        </label>

        <label class="grid gap-1">
          {{ action === 'enable' ? 'Motivo (opcional)' : 'Motivo' }}
          <textarea
            v-model="reason"
            :required="action !== 'enable'"
            maxlength="1000"
            class="w-full rounded border border-slate-300 p-2"
          ></textarea>
        </label>

        <label class="grid gap-1">
          {{ action === 'disable' ? 'Evidencia (opcional)' : 'Evidencia comercial' }}
          <textarea
            v-model="evidence"
            :required="action !== 'disable'"
            maxlength="1000"
            class="w-full rounded border border-slate-300 p-2"
          ></textarea>
        </label>
      </fieldset>

      <p v-if="error" role="alert" class="mt-3 text-red-700">{{ error }}</p>

      <div class="mt-3 flex flex-wrap gap-2">
        <button type="submit" :disabled="submitting">
          {{ submitting ? 'Guardando…' : retry ? 'Reintentar operación' : 'Confirmar cambio' }}
        </button>
        <button
          v-if="!retry"
          type="button"
          :disabled="submitting"
          @click="action = null"
        >
          Cancelar
        </button>
      </div>
    </form>
  </section>
</template>