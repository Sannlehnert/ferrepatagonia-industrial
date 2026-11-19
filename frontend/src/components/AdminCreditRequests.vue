<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import AdminCreditRequestDecision from './AdminCreditRequestDecision.vue'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import { accountMoney } from '@/services/adminAccountDto'
import { listAdminCreditRequests } from '@/services/adminCreditService'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const allowed = () => auth.rol === 'ADMIN' && !auth.loggingOut && !auth.loggingIn
const identity = () => `${auth.user?.id}:${auth.rol}:${auth.sessionVersion}`
type CreditRequestPage = Awaited<ReturnType<typeof listAdminCreditRequests>>

const { data: page, loading, error, load, reset } =
  usePrivateAccountRead<CreditRequestPage>(identity, allowed)

const currentCursor = ref<number | undefined>(undefined)

const feedback = ref('')

function onResolved(message: string) {
  feedback.value = message
  void loadRequests()
}

function loadRequests(antesDeId?: number) {
  currentCursor.value = antesDeId
  return load(signal => listAdminCreditRequests(
    { estado: 'PENDIENTE', limite: 20, antesDeId },
    signal,
  ))
}

watch(() => [identity(), allowed()], () => {
  feedback.value = ''
  reset()
  if (allowed()) void loadRequests()
}, { flush: 'sync' })

onMounted(() => { void loadRequests() })
</script>

<template>
  <section class="credit-requests my-6 rounded-lg border border-slate-200 bg-white p-4">
    <h2 class="text-lg font-semibold">Solicitudes de crédito pendientes</h2>
    <p v-if="feedback" role="status" class="mt-3 text-emerald-800">
      {{ feedback }}
    </p>

    <p v-if="loading" class="mt-3" role="status">Cargando solicitudes…</p>

    <div v-else-if="error" class="mt-3">
      <p role="alert">No se pudieron consultar las solicitudes de crédito.</p>
      <button type="button" class="mt-2 underline" @click="loadRequests(currentCursor)">
        Reintentar
      </button>
    </div>

    <template v-else-if="page">
      <p v-if="!page.items.length" class="mt-3" role="status">
        {{ currentCursor === undefined
          ? 'No hay solicitudes de crédito pendientes.'
          : 'No hay más solicitudes pendientes.' }}
      </p>

      <ul v-else class="mt-3 divide-y divide-slate-200">
        <li
          v-for="request in page.items"
          :key="request.id"
          class="flex flex-wrap items-center justify-between gap-2 py-3"
        >
          <div>
            <p class="font-medium">{{ request.clienteNombre || `Cliente #${request.clienteId}` }}</p>
            <p class="text-sm text-slate-600">
              Solicitud #{{ request.id }} · {{ accountMoney(request.montoSolicitado) }}
              · {{ request.plazoDias }} días
            </p>
          </div>
          <span class="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-900">
            Pendiente
          </span>
          <AdminCreditRequestDecision
            :key="`${identity()}:${request.id}`"
            :request="request"
            @resolved="onResolved"
          />
        </li>
      </ul>

      <div class="mt-3 flex flex-wrap gap-4">
        <button
          v-if="currentCursor !== undefined"
          type="button"
          class="underline"
          @click="loadRequests()"
        >
          Volver a la primera página
        </button>
        <button
          v-if="page.siguienteAntesDeId !== null"
          type="button"
          class="underline"
          @click="loadRequests(page.siguienteAntesDeId)"
        >
          Ver más solicitudes
        </button>
      </div>
    </template>
  </section>
</template>
<style scoped>
.credit-requests, .credit-requests * { box-sizing: border-box; min-width: 0; }
.credit-requests { max-width: 100%; color: #0b2438; }
.credit-requests fieldset { margin-inline: 0; border: 0; padding: 0; }
.credit-requests :is(button, input, select, textarea) { min-height: 44px; max-width: 100%; font: inherit; font-size: 14px; }
.credit-requests :is(input, select, textarea) { width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; background: white; color: #0b2438; padding: 8px; }
.credit-requests textarea { min-height: 88px; resize: vertical; }
.credit-requests button { min-width: 44px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 16px; background: white; color: #103a5c; font-weight: 600; cursor: pointer; }
.credit-requests button:hover:not(:disabled) { background: #f1f5f9; }
.credit-requests button[type="submit"] { border-color: transparent; background: #103a5c; color: white; }
.credit-requests button[type="submit"]:hover:not(:disabled) { background: #145a8d; }
.credit-requests :is(button, input, select, textarea):focus-visible { outline: 2px solid #145a8d; outline-offset: 2px; }
.credit-requests :is(button, input, select, textarea):disabled { opacity: .5; cursor: not-allowed; }
.credit-requests ul { list-style: none; padding: 0; }
.credit-requests button { border-color: transparent; background: transparent; }
</style>
