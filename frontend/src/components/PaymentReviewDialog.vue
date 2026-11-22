<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import type { PaymentReceipt } from '@/services/paymentReceiptService'
import type { DeclarePaymentPayload } from '@/types/payment'
import { formatInstant } from '@/utils/cuentaCorriente'
import { formatPaymentMoney } from '@/utils/payment'

const props = defineProps<{
    payload: DeclarePaymentPayload
    receipt: PaymentReceipt
    busy: boolean
    uncertain: boolean
    error: string
    checked: boolean
}>()

const emit = defineEmits<{
    'update:checked': [value: boolean]
    confirm: []
    cancel: []
    retry: []
    checkStatus: []
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const titleId = useId()
const cancelButton = ref<HTMLButtonElement | null>(null)
let trigger: HTMLElement | null = null

onMounted(() => {
    trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.value?.showModal()
    void nextTick(() => cancelButton.value?.focus({ preventScroll: true }))
})

onBeforeUnmount(() => {
    if (dialog.value?.open) dialog.value.close()
    if (trigger?.isConnected) trigger.focus({ preventScroll: true })
})

function requestClose() {
    if (props.busy) return
    emit('cancel')
}
</script>

<template>
    <dialog
        ref="dialog"
        :aria-labelledby="titleId"
        class="box-border m-auto max-h-[90dvh] w-[calc(100%_-_1rem)] max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-0 text-[#0B2438] backdrop:bg-[#0B2438]/60 sm:w-[calc(100%_-_2rem)]"
        @cancel.prevent="requestClose"
    >
        <form class="grid gap-4 p-4 sm:p-6" @submit.prevent="emit('confirm')">
            <header class="flex items-start justify-between gap-3">
                <div>
                    <h2 :id="titleId" class="m-0 text-xl font-semibold">Revisar declaración de pago</h2>
                    <p class="m-0 mt-1 text-sm text-slate-600">
                        Verificá los datos antes de confirmar. La declaración queda pendiente y no acredita dinero.
                    </p>
                </div>
                <button
                    ref="cancelButton"
                    type="button"
                    class="box-border min-h-11 min-w-11 shrink-0 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm font-semibold text-[#0B2438] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                    :disabled="busy"
                    aria-label="Cancelar revisión"
                    @click="requestClose"
                >
                    Cancelar
                </button>
            </header>

            <dl class="m-0 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2">
                <div class="min-w-0">
                    <dt class="font-medium text-slate-600">Importe declarado</dt>
                    <dd class="m-0 mt-1 break-words text-lg font-semibold">
                        {{ formatPaymentMoney(payload.monto, payload.moneda) }}
                    </dd>
                </div>
                <div class="min-w-0">
                    <dt class="font-medium text-slate-600">Moneda</dt>
                    <dd class="m-0 mt-1 font-semibold">{{ payload.moneda }}</dd>
                </div>
                <div class="min-w-0 sm:col-span-2">
                    <dt class="font-medium text-slate-600">Comprobante</dt>
                    <dd class="m-0 mt-1 break-all font-semibold">
                        {{ receipt.tipoMime }} · cargado {{ formatInstant(receipt.fecha) }}
                    </dd>
                </div>
                <div v-if="payload.observaciones" class="min-w-0 sm:col-span-2">
                    <dt class="font-medium text-slate-600">Observaciones</dt>
                    <dd class="m-0 mt-1 whitespace-pre-wrap break-words">{{ payload.observaciones }}</dd>
                </div>
            </dl>

            <p class="m-0 text-sm text-slate-600">
                La revisión documental y la acreditación se realizan por separado. Una declaración pendiente
                no representa dinero acreditado ni modifica tu saldo.
            </p>

            <p v-if="error" role="alert" class="m-0 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                {{ error }}
            </p>

            <template v-if="uncertain">
                <p role="status" class="m-0 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    El resultado de la declaración no está confirmado. No generamos una nueva declaración ni cambiamos
                    la clave de idempotencia. Consultá el estado o reintentá con la misma clave.
                </p>
                <div class="flex flex-wrap gap-2">
                    <button type="button" class="box-border min-h-11 cursor-pointer rounded-md border-0 bg-[#145A8D] px-4 py-2 font-[inherit] text-sm font-semibold text-white hover:bg-[#103A5C] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                        :disabled="busy" @click="emit('checkStatus')">
                        Consultar estado
                    </button>
                    <button type="button" class="box-border min-h-11 cursor-pointer rounded-md border border-solid border-[#145A8D] bg-white px-4 py-2 font-[inherit] text-sm font-semibold text-[#145A8D] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                        :disabled="busy" @click="emit('retry')">
                        Reintentar con la misma clave
                    </button>
                </div>
            </template>

            <template v-else>
                <label class="flex items-start gap-3 text-sm">
                    <input
                        type="checkbox"
                        class="mt-0.5 box-border h-5 w-5 shrink-0 cursor-pointer accent-[#145A8D] disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                        :checked="checked"
                        :disabled="busy"
                        @change="emit('update:checked', ($event.target as HTMLInputElement).checked)"
                    >
                    <span>
                        Confirmo que los datos son correctos y que esta declaración no implica una acreditación
                        automática del pago.
                    </span>
                </label>
                <div class="flex flex-wrap justify-end gap-2">
                    <button type="button" class="box-border min-h-11 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-4 py-2 font-[inherit] text-sm font-semibold text-[#0B2438] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                        :disabled="busy" @click="requestClose">
                        Volver
                    </button>
                    <button type="submit" class="box-border min-h-11 cursor-pointer rounded-md border-0 bg-[#145A8D] px-4 py-2 font-[inherit] text-sm font-semibold text-white hover:bg-[#103A5C] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                        :disabled="busy || !checked" :aria-busy="busy">
                        {{ busy ? 'Declarando…' : 'Confirmar declaración' }}
                    </button>
                </div>
            </template>
        </form>
    </dialog>
</template>
