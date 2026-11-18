<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import AdminClientCreditStatus from '@/components/AdminClientCreditStatus.vue'
import type { ClientCredit } from '@/composables/useAdminClientCredit'
import type { AdminClient, CompanyApprovalStatus } from '@/types/adminClient'

const props = defineProps<{
  client: AdminClient
  target: CompanyApprovalStatus | null
  credit: ClientCredit | null
  busy: boolean
  uncertain: boolean
  feedback?: { text: string; error: boolean }
}>()
const emit = defineEmits<{ close: []; confirm: []; retry: []; refreshCredit: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = useId()
const companyState = computed(() => props.client.estadoAprobacionEmpresa === 'APROBADA' ? 'Aprobada'
  : props.client.estadoAprobacionEmpresa === 'RECHAZADA' ? 'Rechazada'
    : props.client.estadoAprobacionEmpresa === 'PENDIENTE' ? 'Pendiente' : 'No informado')
let trigger: HTMLElement | null = null
onMounted(() => {
  trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.value?.showModal()
})
onBeforeUnmount(() => {
  dialog.value?.close()
  if (trigger?.isConnected) trigger.focus()
})
function close() { if (!props.busy) emit('close') }
</script>

<template>
  <dialog ref="dialog" :aria-labelledby="titleId" :aria-busy="busy"
    class="box-border m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-xl border border-slate-300 bg-white p-5 text-[#0b2438] backdrop:bg-slate-900/60"
    @cancel.prevent="close">
    <header class="flex items-start justify-between gap-3">
      <h2 :id="titleId" class="m-0 text-xl font-bold">
        {{ target ? (target === 'APROBADA' ? 'Aprobar empresa' : 'Rechazar empresa') : 'Detalle del cliente' }}
      </h2>
      <button type="button" autofocus :disabled="busy" aria-label="Cerrar detalle del cliente"
        class="min-h-11 rounded border border-slate-300 px-3 disabled:opacity-50" @click="close">Cerrar</button>
    </header>
    <dl class="space-y-3 [overflow-wrap:anywhere]">
      <div><dt class="font-semibold">Nombre o razón social</dt><dd class="m-0">{{ client.nombreRazonSocial }}</dd></div>
      <div><dt class="font-semibold">Email</dt><dd class="m-0">{{ client.email }}</dd></div>
      <div><dt class="font-semibold">Tipo de cliente</dt><dd class="m-0">{{ client.tipoCliente === 'EMPRESA' ? 'Empresa' : 'Particular' }}</dd></div>
      <div v-if="client.cuit"><dt class="font-semibold">CUIT</dt><dd class="m-0">{{ client.cuit }}</dd></div>
      <div v-if="client.docCliente"><dt class="font-semibold">Documento</dt><dd class="m-0">{{ client.docCliente }}</dd></div>
      <div><dt class="font-semibold">Registro empresarial</dt><dd class="m-0">{{ client.tipoCliente === 'EMPRESA' ? (uncertain ? 'Por verificar' : companyState) : 'No aplica a particulares' }}</dd></div>
      <div><dt class="mb-1 font-semibold">Cuenta corriente y crédito</dt><dd class="m-0">
        <AdminClientCreditStatus :company="client.tipoCliente === 'EMPRESA'" :credit="credit" @retry="emit('refreshCredit')" />
      </dd></div>
    </dl>
    <p class="rounded bg-slate-50 p-3 text-sm">La aprobación empresarial y la habilitación de crédito son independientes. El crédito se administra en Cuentas corrientes.</p>
    <p v-if="target" class="text-sm">
      {{ target === 'APROBADA' ? 'Confirmá que querés aprobar el registro de esta empresa. Esta acción no habilita crédito.'
        : 'Confirmá que querés rechazar el registro de esta empresa. No se eliminan la cuenta corriente ni su historial financiero.' }}
    </p>
    <p v-if="uncertain" role="alert" class="text-sm font-semibold text-amber-900">Resultado incierto: verificá el estado antes de volver a modificarlo.</p>
    <p v-if="feedback" :role="feedback.error ? 'alert' : 'status'" class="text-sm"
      :class="feedback.error ? 'text-rose-800' : 'text-emerald-800'">{{ feedback.text }}</p>
    <div class="flex flex-wrap justify-end gap-3">
      <button v-if="uncertain" type="button" :disabled="busy" class="min-h-11 rounded border border-amber-600 px-4"
        @click="emit('retry')">Verificar estado actual</button>
      <button v-if="target && !uncertain && client.estadoAprobacionEmpresa !== target" type="button"
        :disabled="busy" class="min-h-11 rounded border-0 bg-[#145a8d] px-4 font-semibold text-white disabled:opacity-50"
        @click="emit('confirm')">{{ busy ? 'Guardando…' : target === 'APROBADA' ? 'Confirmar aprobación' : 'Confirmar rechazo' }}</button>
    </div>
  </dialog>
</template>
