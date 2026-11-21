<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import PaymentDetailDialog from '@/components/PaymentDetailDialog.vue'
import PaymentStatusBadges from '@/components/PaymentStatusBadges.vue'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import {
    accountReceiptsPath,
} from '@/services/paymentReceiptService'
import {
    getClientPayment,
    listClientPayments,
    paymentErrorMessage,
} from '@/services/paymentService'
import { useAuthStore } from '@/stores/auth'
import type { ClientPayment, ClientPaymentPage } from '@/types/payment'
import { formatInstant } from '@/utils/cuentaCorriente'
import { formatPaymentMoney, paymentFinancialState } from '@/utils/payment'

const props = defineProps<{ refreshVersion: number }>()
const auth = useAuthStore()
const page = ref(1)
const identity = () => [
    auth.user?.id ?? '',
    auth.rol ?? '',
    auth.user?.tipo_cliente ?? '',
    auth.sessionVersion,
].join(':')
const allowed = () => auth.rol === 'CLIENTE' && auth.user?.tipo_cliente === 'EMPRESA'
    && !auth.loggingIn && !auth.loggingOut

const { data, loading, error, load, reset } = usePrivateAccountRead<ClientPaymentPage>(
    identity,
    allowed,
)
const items = computed(() => data.value?.items ?? [])
const listError = computed(() => error.value
    ? paymentErrorMessage(error.value, 'No pudimos cargar el historial de pagos.')
    : '')

const detailVisible = ref(false)
const detailId = ref<number | null>(null)
const detailPayment = ref<ClientPayment | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
let detailRequest = 0
let detailController: AbortController | undefined

function loadPage(target: number) {
    page.value = target
    void load(signal => listClientPayments(target, signal))
}

function abortDetail() {
    detailRequest += 1
    detailController?.abort()
    detailController = undefined
    detailLoading.value = false
}

function closeDetail() {
    abortDetail()
    detailVisible.value = false
    detailId.value = null
    detailPayment.value = null
    detailError.value = ''
}

async function loadDetail(id: number) {
    const current = ++detailRequest
    detailController?.abort()
    const controller = new AbortController()
    detailController = controller
    const startedIdentity = identity()
    const valid = () => current === detailRequest && !controller.signal.aborted &&
        startedIdentity === identity() && allowed()

    detailLoading.value = true
    detailError.value = ''
    try {
        const result = await getClientPayment(id, controller.signal)
        if (!valid()) return
        detailPayment.value = result
    } catch (cause: unknown) {
        if (!valid()) return
        detailPayment.value = null
        detailError.value = paymentErrorMessage(cause, 'No pudimos consultar el detalle del pago.')
    } finally {
        if (valid()) detailLoading.value = false
    }
}

function openDetail(id: number) {
    detailId.value = id
    detailPayment.value = null
    detailError.value = ''
    detailVisible.value = true
    void loadDetail(id)
}

function reloadCurrent() {
    if (!allowed()) return
    loadPage(page.value)
}

watch(identity, () => {
    closeDetail()
    page.value = 1
    if (allowed()) loadPage(1)
    else reset()
}, { flush: 'sync', immediate: true })

watch(() => props.refreshVersion, () => {
    if (allowed()) loadPage(1)
})

onBeforeUnmount(() => {
    abortDetail()
})
</script>

<template>
    <section v-if="allowed()" aria-labelledby="payment-history-title"
        class="mt-8 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <header class="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
                <h2 id="payment-history-title" class="m-0 text-xl font-semibold text-[#0B2438]">
                    Historial de pagos
                </h2>
                <p class="m-0 mt-1 text-sm text-slate-600">
                    Seguimiento de tus declaraciones. El estado financiero se consulta al servidor y no se modifica desde esta pantalla.
                </p>
            </div>
            <button type="button"
                class="min-h-11 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-[#0B2438] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                :disabled="loading" @click="reloadCurrent">
                {{ loading ? 'Actualizando…' : 'Actualizar historial' }}
            </button>
        </header>

        <p v-if="loading" role="status" class="m-0 text-sm text-slate-600">
            Consultando tus pagos…
        </p>
        <div v-else-if="listError" class="grid gap-2 rounded-md border border-red-200 bg-red-50 p-3">
            <p role="alert" class="m-0 text-sm text-red-900">{{ listError }}</p>
            <div class="flex flex-wrap gap-2">
                <button type="button" class="min-h-11 w-fit rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-900 hover:bg-red-50"
                    @click="reloadCurrent">
                    Reintentar historial
                </button>
                <button v-if="page > 1" type="button"
                    class="min-h-11 w-fit rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-900 hover:bg-red-50"
                    @click="loadPage(1)">
                    Volver a la página 1
                </button>
            </div>
        </div>
        <template v-else>
            <p v-if="items.length === 0" role="status" class="m-0 text-sm text-slate-600">
                Todavía no declaraste pagos.
            </p>
            <ul v-else class="m-0 grid list-none gap-4 p-0">
                <li v-for="payment in items" :key="payment.id"
                    class="min-w-0 rounded-lg border border-slate-200 p-4">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="min-w-0">
                            <h3 class="m-0 text-lg font-semibold text-[#0B2438]">Pago #{{ payment.id }}</h3>
                            <p class="m-0 mt-1 break-words font-semibold">
                                {{ formatPaymentMoney(payment.monto, payment.moneda) }}
                                <span class="text-sm font-normal text-slate-600">
                                    declarado {{ formatInstant(payment.fecha) }}
                                </span>
                            </p>
                        </div>
                        <button type="button"
                            class="min-h-11 rounded-md border border-[#145A8D] bg-white px-3 py-2 text-sm font-semibold text-[#145A8D] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                            :aria-label="`Ver detalle del pago ${payment.id}`" @click="openDetail(payment.id)">
                            Ver detalle
                        </button>
                    </div>

                    <div class="mt-3">
                        <PaymentStatusBadges :payment="payment" />
                    </div>

                    <dl class="m-0 mt-3 grid gap-2 text-sm sm:grid-cols-2">
                        <div>
                            <dt class="inline font-medium text-slate-600">Comprobante: </dt>
                            <dd class="m-0 inline">
                                <a v-if="payment.comprobanteId" class="font-semibold text-[#145A8D] underline focus-visible:outline-2 focus-visible:outline-[#145A8D]"
                                    :href="'/api' + accountReceiptsPath + '/' + payment.comprobanteId">
                                    Descargar
                                </a>
                                <span v-else>No adjunto</span>
                            </dd>
                        </div>
                        <div>
                            <dt class="inline font-medium text-slate-600">Revisión documental: </dt>
                            <dd class="m-0 inline">{{ payment.revisadoEn ? formatInstant(payment.revisadoEn) : 'Sin revisión' }}</dd>
                        </div>
                        <div v-if="payment.acreditadoEn">
                            <dt class="inline font-medium text-slate-600">Acreditado: </dt>
                            <dd class="m-0 inline">{{ formatInstant(payment.acreditadoEn) }}</dd>
                        </div>
                        <div v-if="paymentFinancialState(payment) === 'ACREDITADO'">
                            <dt class="inline font-medium text-slate-600">Importe USD acreditado: </dt>
                            <dd class="m-0 inline font-semibold">
                                {{ formatPaymentMoney(payment.montoUsd, 'USD') }}
                            </dd>
                        </div>
                        <div v-else-if="payment.moneda === 'ARS'" class="sm:col-span-2">
                            <dt class="inline font-medium text-slate-600">Equivalente USD: </dt>
                            <dd class="m-0 inline">Se determina al acreditar con cotización verificada.</dd>
                        </div>
                        <div v-if="payment.motivoRevision" class="min-w-0 sm:col-span-2">
                            <dt class="inline font-medium text-slate-600">Motivo informado: </dt>
                            <dd class="m-0 inline whitespace-pre-wrap break-words">{{ payment.motivoRevision }}</dd>
                        </div>
                    </dl>
                </li>
            </ul>

            <div v-if="page > 1 || data?.paginaSiguiente" class="mt-4 flex flex-wrap items-center gap-2">
                <button v-if="page > 1" type="button"
                    class="min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-[#0B2438] hover:bg-slate-50 disabled:opacity-60"
                    :disabled="loading" @click="loadPage(page - 1)">
                    Pagos anteriores
                </button>
                <span class="text-sm text-slate-600">Página {{ page }}</span>
                <button v-if="data?.paginaSiguiente" type="button"
                    class="min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-[#0B2438] hover:bg-slate-50 disabled:opacity-60"
                    :disabled="loading" @click="loadPage(data.paginaSiguiente)">
                    Más pagos
                </button>
            </div>
        </template>

        <PaymentDetailDialog v-if="detailVisible"
            :payment="detailPayment" :loading="detailLoading" :error="detailError"
            @close="closeDetail" @retry="detailId !== null && loadDetail(detailId)" />
    </section>
</template>
