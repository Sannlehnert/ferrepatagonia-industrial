<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import PaymentStatusBadges from '@/components/PaymentStatusBadges.vue'
import { accountReceiptsPath } from '@/services/paymentReceiptService'
import type { ClientPayment } from '@/types/payment'
import { formatInstant } from '@/utils/cuentaCorriente'
import { formatPaymentMoney, paymentFinancialState } from '@/utils/payment'

const props = defineProps<{
    payment: ClientPayment | null
    loading: boolean
    error: string
}>()
const emit = defineEmits<{ close: []; retry: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const titleId = useId()
let trigger: HTMLElement | null = null

const financialState = computed(() => props.payment ? paymentFinancialState(props.payment) : 'OTRO')
const canShowUsd = computed(() =>
    Boolean(props.payment && financialState.value === 'ACREDITADO' && props.payment.montoUsd),
)

onMounted(() => {
    trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.value?.showModal()
    void nextTick(() => closeButton.value?.focus({ preventScroll: true }))
})

onBeforeUnmount(() => {
    if (dialog.value?.open) dialog.value.close()
    if (trigger?.isConnected) trigger.focus({ preventScroll: true })
})
</script>

<template>
    <dialog
        ref="dialog"
        :aria-labelledby="titleId"
        class="box-border m-auto max-h-[90dvh] w-[calc(100%_-_1rem)] max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-0 text-[#0B2438] backdrop:bg-[#0B2438]/60 sm:w-[calc(100%_-_2rem)]"
        @cancel.prevent="emit('close')"
    >
        <div class="grid gap-4 p-4 sm:p-6">
            <header class="flex items-start justify-between gap-3">
                <div>
                    <h2 :id="titleId" class="m-0 text-xl font-semibold">
                        Detalle del pago #{{ payment?.id ?? '—' }}
                    </h2>
                    <p class="m-0 mt-1 text-sm text-slate-600">
                        Consulta confirmada al servidor. Una aprobación documental no implica acreditación financiera.
                    </p>
                </div>
                <button ref="closeButton" type="button" aria-label="Cerrar detalle del pago"
                    class="min-h-11 min-w-11 shrink-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-[#0B2438] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                    @click="emit('close')">
                    Cerrar
                </button>
            </header>

            <p v-if="loading" role="status" class="m-0 text-sm text-slate-600">
                Consultando el detalle del pago…
            </p>
            <div v-else-if="error" class="grid gap-2 rounded-md border border-red-200 bg-red-50 p-3">
                <p role="alert" class="m-0 text-sm text-red-900">{{ error }}</p>
                <button type="button" class="min-h-11 w-fit rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-900 hover:bg-red-50"
                    @click="emit('retry')">
                    Reintentar detalle
                </button>
            </div>
            <template v-else-if="payment">
                <PaymentStatusBadges :payment="payment" />

                <dl class="m-0 grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2">
                    <div class="min-w-0">
                        <dt class="font-medium text-slate-600">Importe declarado</dt>
                        <dd class="m-0 mt-1 break-words text-lg font-semibold">
                            {{ formatPaymentMoney(payment.monto, payment.moneda) }}
                        </dd>
                    </div>
                    <div class="min-w-0">
                        <dt class="font-medium text-slate-600">Moneda declarada</dt>
                        <dd class="m-0 mt-1 font-semibold">{{ payment.moneda ?? 'No determinable' }}</dd>
                    </div>
                    <div v-if="canShowUsd" class="min-w-0">
                        <dt class="font-medium text-slate-600">Importe acreditado en USD</dt>
                        <dd class="m-0 mt-1 font-semibold">{{ formatPaymentMoney(payment.montoUsd, 'USD') }}</dd>
                    </div>
                    <div v-else-if="payment.moneda === 'ARS'" class="min-w-0 sm:col-span-2">
                        <dt class="font-medium text-slate-600">Equivalente USD</dt>
                        <dd class="m-0 mt-1 font-semibold">
                            {{ financialState === 'ACREDITADO' ? 'No disponible en la respuesta' : 'Se determina recién al acreditar con cotización verificada' }}
                        </dd>
                    </div>
                    <div class="min-w-0">
                        <dt class="font-medium text-slate-600">Fecha de declaración</dt>
                        <dd class="m-0 mt-1">{{ formatInstant(payment.fecha) }}</dd>
                    </div>
                    <div class="min-w-0">
                        <dt class="font-medium text-slate-600">Fecha de revisión documental</dt>
                        <dd class="m-0 mt-1">{{ payment.revisadoEn ? formatInstant(payment.revisadoEn) : 'Sin revisión registrada' }}</dd>
                    </div>
                    <div class="min-w-0">
                        <dt class="font-medium text-slate-600">Fecha de acreditación</dt>
                        <dd class="m-0 mt-1">{{ payment.acreditadoEn ? formatInstant(payment.acreditadoEn) : 'Todavía no acreditado' }}</dd>
                    </div>
                    <div class="min-w-0">
                        <dt class="font-medium text-slate-600">Comprobante</dt>
                        <dd class="m-0 mt-1">
                            <a v-if="payment.comprobanteId" class="font-semibold text-[#145A8D] underline focus-visible:outline-2 focus-visible:outline-[#145A8D]"
                                :href="'/api' + accountReceiptsPath + '/' + payment.comprobanteId">
                                Descargar comprobante
                            </a>
                            <span v-else>No adjunto</span>
                        </dd>
                    </div>
                    <div v-if="payment.observaciones" class="min-w-0 sm:col-span-2">
                        <dt class="font-medium text-slate-600">Observaciones</dt>
                        <dd class="m-0 mt-1 whitespace-pre-wrap break-words">{{ payment.observaciones }}</dd>
                    </div>
                    <div v-if="payment.motivoRevision" class="min-w-0 sm:col-span-2">
                        <dt class="font-medium text-slate-600">Motivo informado</dt>
                        <dd class="m-0 mt-1 whitespace-pre-wrap break-words">{{ payment.motivoRevision }}</dd>
                    </div>
                </dl>
            </template>
        </div>
    </dialog>
</template>
