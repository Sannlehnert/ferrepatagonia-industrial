<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
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
const dialogButtonClass = "box-border min-h-11 min-w-11 cursor-pointer rounded-lg border border-solid border-[#cbd5e1] bg-white px-4 py-2.5 [font-family:inherit] text-sm font-semibold leading-5 text-[#103a5c] enabled:hover:bg-[#f1f5f9] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[3px] focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-50"
const companyBadgeClass = "box-border inline-flex w-44 min-h-7 items-center justify-center gap-[7px] whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold leading-5 before:size-1.5 before:shrink-0 before:rounded-full before:bg-current before:content-['']"
const dialog = ref<HTMLDialogElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const titleId = useId()
const companyState = computed(() => props.client.estadoAprobacionEmpresa === 'APROBADA' ? 'Aprobada'
  : props.client.estadoAprobacionEmpresa === 'RECHAZADA' ? 'Rechazada'
    : props.client.estadoAprobacionEmpresa === 'PENDIENTE' ? 'Pendiente' : 'No informado')
let trigger: HTMLElement | null = null
let fallbackTrigger: HTMLElement | null = null
onMounted(() => {
  trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  fallbackTrigger = trigger?.closest('tr')?.querySelector<HTMLElement>('[data-client-detail]') ?? null
  dialog.value?.showModal()
})
watch(() => [props.client.estadoAprobacionEmpresa, props.uncertain, props.busy], async () => {
  await nextTick()
  if (typeof document !== 'undefined' && dialog.value?.open && !dialog.value.contains(document.activeElement)) {
    closeButton.value?.focus({ preventScroll: true })
  }
})
onBeforeUnmount(() => {
  dialog.value?.close()
  if (trigger?.isConnected && !trigger.matches(':disabled')) trigger.focus()
  else if (fallbackTrigger?.isConnected && !fallbackTrigger.matches(':disabled')) fallbackTrigger.focus()
})
function close() { if (!props.busy) emit('close') }
</script>

<template>
  <dialog ref="dialog" :aria-labelledby="titleId" :aria-busy="busy"
    class="client-dialog box-border m-auto max-h-[90dvh] w-[calc(100%_-_32px)] max-w-[680px] overflow-y-auto rounded-2xl border border-solid border-[#e2e8f0] bg-white p-0 text-sm leading-normal text-[#13293a] shadow-[0_24px_64px_#0b243833] backdrop:bg-[#0b2438a6] [&_*]:box-border"
    @cancel.prevent="close">
    <header class="sticky top-0 z-[1] flex items-center justify-between gap-4 border-x-0 border-t-0 border-b border-solid border-[#e2e8f0] bg-white px-6 py-5 max-[541px]:p-4">
      <h2 :id="titleId" class="m-0 text-[22px] font-semibold leading-[1.3] text-[#0b2438] max-[541px]:text-[20px]">
        {{ target ? (target === 'APROBADA' ? 'Aprobar empresa' : 'Rechazar empresa') : 'Detalle del cliente' }}
      </h2>
      <button ref="closeButton" type="button" autofocus :disabled="busy" aria-label="Cerrar detalle del cliente"
        :class="dialogButtonClass" @click="close">Cerrar</button>
    </header>
    <div class="p-6 max-[541px]:px-4 max-[541px]:py-5">
    <dl class="m-0 grid grid-cols-2 gap-x-6 gap-y-5 [overflow-wrap:anywhere] max-[541px]:grid-cols-1 max-[541px]:gap-4">
      <div><dt class="mb-1.5 text-xs leading-normal font-semibold text-[#64748b]">Nombre o razón social</dt><dd class="m-0 text-sm leading-normal font-semibold">{{ client.nombreRazonSocial }}</dd></div>
      <div><dt class="mb-1.5 text-xs leading-normal font-semibold text-[#64748b]">Email</dt><dd class="m-0 text-sm leading-normal">{{ client.email }}</dd></div>
      <div><dt class="mb-1.5 text-xs leading-normal font-semibold text-[#64748b]">Tipo de cliente</dt><dd class="m-0 text-sm leading-normal">{{ client.tipoCliente === 'EMPRESA' ? 'Empresa' : 'Particular' }}</dd></div>
      <div v-if="client.cuit"><dt class="mb-1.5 text-xs leading-normal font-semibold text-[#64748b]">CUIT</dt><dd class="m-0 text-sm leading-normal">{{ client.cuit }}</dd></div>
      <div v-if="client.docCliente"><dt class="mb-1.5 text-xs leading-normal font-semibold text-[#64748b]">Documento</dt><dd class="m-0 text-sm leading-normal">{{ client.docCliente }}</dd></div>
      <div><dt class="mb-1.5 text-xs leading-normal font-semibold text-[#64748b]">Registro empresarial</dt><dd class="m-0 text-sm leading-normal"><span :class="[companyBadgeClass, 'company-badge', uncertain ? 'bg-[#fef3c7] text-[#92400e]' : client.estadoAprobacionEmpresa === 'APROBADA' ? 'bg-[#dcfce7] text-[#166534]' : client.estadoAprobacionEmpresa === 'RECHAZADA' ? 'bg-[#fee2e2] text-[#991b1b]' : client.estadoAprobacionEmpresa === 'PENDIENTE' ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#f3f4f6] text-[#475569]']">{{ client.tipoCliente === 'EMPRESA' ? (uncertain ? 'Por verificar' : companyState) : 'No aplica a particulares' }}</span></dd></div>
      <div class="col-span-full border-x-0 border-b-0 border-t border-solid border-[#e2e8f0] pt-5"><dt class="mb-1.5 text-xs leading-normal font-semibold text-[#64748b]">Cuenta corriente y crédito</dt><dd class="m-0 text-sm leading-normal">
        <AdminClientCreditStatus :company="client.tipoCliente === 'EMPRESA'" :credit="credit" @retry="emit('refreshCredit')" />
      </dd></div>
    </dl>
    <p class="m-0 mt-3 text-xs leading-normal text-[#64748b]">El crédito se administra en Cuentas corrientes.</p>
    <p v-if="target" class="m-0 mt-6 rounded-lg border border-solid border-[#e2e8f0] bg-[#f8fafc] p-4">
      {{ target === 'APROBADA' ? 'Confirmá que querés aprobar el registro de esta empresa. Esta acción no habilita crédito.'
        : 'Confirmá que querés rechazar el registro de esta empresa. No se eliminan la cuenta corriente ni su historial financiero.' }}
    </p>
    <p v-if="uncertain" role="alert" class="m-0 mt-4 text-sm font-semibold text-amber-900">Resultado incierto: verificá el estado antes de volver a modificarlo.</p>
    <p v-if="feedback" :role="feedback.error ? 'alert' : 'status'" class="m-0 mt-4 text-sm"
      :class="feedback.error ? 'text-rose-800' : 'text-emerald-800'">{{ feedback.text }}</p>
    </div>
    <footer v-if="uncertain || (target && client.estadoAprobacionEmpresa !== target)" class="sticky bottom-0 flex flex-wrap justify-end gap-3 border-x-0 border-b-0 border-t border-solid border-[#e2e8f0] bg-[#f8fafc] px-6 py-4 max-[541px]:px-4 max-[541px]:[&_button]:w-full">
      <button v-if="uncertain" type="button" :disabled="busy" :class="dialogButtonClass"
        @click="emit('retry')">Verificar estado actual</button>
      <button v-if="target && !uncertain && client.estadoAprobacionEmpresa !== target" type="button"
        :disabled="busy" :class="[dialogButtonClass, target === 'RECHAZADA' ? '!border-[#dc2626] !bg-[#dc2626] !text-white enabled:hover:!border-[#b91c1c] enabled:hover:!bg-[#b91c1c]' : '!border-[#145a8d] !bg-[#145a8d] !text-white enabled:hover:!border-[#103a5c] enabled:hover:!bg-[#103a5c]']"
        @click="emit('confirm')">{{ busy ? 'Guardando…' : target === 'APROBADA' ? 'Confirmar aprobación' : 'Confirmar rechazo' }}</button>
    </footer>
  </dialog>
</template>
