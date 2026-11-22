<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import PaymentReviewDialog from '@/components/PaymentReviewDialog.vue'
import {
    accountReceiptsPath,
    listPaymentReceipts,
    type PaymentReceipt,
} from '@/services/paymentReceiptService'
import {
    declareClientPayment,
    findClientPaymentByReceipt,
    isUncertainDeclarationError,
    paymentErrorCode,
    paymentErrorMessage,
} from '@/services/paymentService'
import { useAuthStore } from '@/stores/auth'
import type { DeclarePaymentPayload, PaymentCurrency } from '@/types/payment'
import { formatInstant } from '@/utils/cuentaCorriente'
import {
    formatPaymentMoney,
    isIdempotencyKey,
    isValidPaymentAmount,
    newIdempotencyKey,
    receiptReviewStatusLabel,
} from '@/utils/payment'

const props = defineProps<{ refreshVersion: number }>()
const emit = defineEmits<{ declared: [paymentId: number | null] }>()

const auth = useAuthStore()
const receipts = ref<PaymentReceipt[]>([])
const receiptsPage = ref(1)
const receiptsNext = ref<number | null>(null)
const receiptsLoading = ref(false)
const receiptsError = ref('')
const selectedReceiptId = ref('')
const selectedReceipt = ref<PaymentReceipt | null>(null)
const monto = ref('')
const moneda = ref<PaymentCurrency>('USD')
const observaciones = ref('')
const formError = ref('')
const notice = ref('')
const submitting = ref(false)
const checking = ref(false)
const uncertain = ref(false)
const reviewed = ref<{ payload: DeclarePaymentPayload; receipt: PaymentReceipt } | null>(null)
const reviewVisible = ref(false)
const checked = ref(false)
const idempotencyKey = ref<string | null>(null)

let receiptsRequest = 0
let receiptsController: AbortController | undefined
let declarationRequest = 0
let declarationController: AbortController | undefined

const identity = () => [
    auth.user?.id ?? '',
    auth.rol ?? '',
    auth.user?.tipo_cliente ?? '',
    auth.sessionVersion,
].join(':')
const allowed = () => auth.rol === 'CLIENTE' && auth.user?.tipo_cliente === 'EMPRESA'
    && !auth.loggingIn && !auth.loggingOut

const receiptTypeLabels: Record<string, string> = {
    'application/pdf': 'PDF',
    'image/jpeg': 'JPG',
    'image/png': 'PNG',
}

const canReview = computed(() =>
    allowed() &&
    !submitting.value &&
    !checking.value &&
    !uncertain.value &&
    selectedReceiptId.value.length > 0 &&
    monto.value.trim().length > 0,
)

const uncertaintyActive = computed(() => uncertain.value && reviewed.value !== null)
const reviewValue = computed(() => reviewed.value?.payload ?? null)
const reviewReceipt = computed(() => reviewed.value?.receipt ?? null)

function abortDeclarations() {
    declarationRequest += 1
    declarationController?.abort()
    declarationController = undefined
    submitting.value = false
    checking.value = false
}

function resetDraft() {
    abortDeclarations()
    selectedReceiptId.value = ''
    selectedReceipt.value = null
    monto.value = ''
    moneda.value = 'USD'
    observaciones.value = ''
    formError.value = ''
    notice.value = ''
    uncertain.value = false
    reviewed.value = null
    reviewVisible.value = false
    checked.value = false
    idempotencyKey.value = null
}

async function loadReceipts(page = 1) {
    const current = ++receiptsRequest
    receiptsController?.abort()
    receiptsError.value = ''
    if (!allowed()) {
        receipts.value = []
        receiptsLoading.value = false
        return
    }

    const startedIdentity = identity()
    const controller = new AbortController()
    receiptsController = controller
    receiptsLoading.value = true
    try {
        const result = await listPaymentReceipts(accountReceiptsPath, page, controller.signal)
        if (current !== receiptsRequest || controller.signal.aborted ||
            startedIdentity !== identity() || !allowed()) return
        receipts.value = result.items
        receiptsPage.value = page
        receiptsNext.value = result.paginaSiguiente
        if (selectedReceiptId.value && !result.items.some(item => item.id === selectedReceiptId.value)) {
            selectedReceiptId.value = ''
            selectedReceipt.value = null
        }
    } catch (error: unknown) {
        if (current !== receiptsRequest || controller.signal.aborted) return
        receipts.value = []
        receiptsError.value = paymentErrorMessage(
            error,
            'No pudimos cargar tus comprobantes. Reintentá la consulta.',
        )
    } finally {
        if (current === receiptsRequest && !controller.signal.aborted) receiptsLoading.value = false
    }
}

function selectReceipt(receipt: PaymentReceipt) {
    if (submitting.value || uncertain.value) return
    selectedReceiptId.value = receipt.id
    selectedReceipt.value = receipt
    formError.value = ''
    notice.value = ''
}

function validateDraft(): DeclarePaymentPayload | null {
    formError.value = ''
    notice.value = ''
    const amount = monto.value.trim()
    if (!selectedReceiptId.value || !selectedReceipt.value) {
        formError.value = 'Seleccioná un comprobante propio ya cargado.'
        return null
    }
    if (!isValidPaymentAmount(amount)) {
        formError.value = 'Ingresá un importe mayor a cero, con hasta dos decimales.'
        return null
    }
    if (observaciones.value.length > 1000) {
        formError.value = 'Las observaciones deben contener hasta 1000 caracteres.'
        return null
    }
    const trimmed = observaciones.value.trim()
    return {
        monto: amount,
        moneda: moneda.value,
        comprobanteId: selectedReceiptId.value,
        ...(trimmed ? { observaciones: trimmed } : {}),
    }
}

function reviewDeclaration() {
    if (!canReview.value) return
    const payload = validateDraft()
    if (!payload || !selectedReceipt.value) return
    if (!isIdempotencyKey(idempotencyKey.value)) {
        try {
            idempotencyKey.value = newIdempotencyKey()
        } catch {
            formError.value = 'No se pudo generar una clave segura para la declaración. Recargá la página.'
            return
        }
    }
    reviewed.value = { payload, receipt: selectedReceipt.value }
    checked.value = false
    reviewVisible.value = true
}

function closeReview() {
    if (submitting.value) return
    if (uncertain.value) {
        reviewVisible.value = false
        return
    }
    idempotencyKey.value = null
    reviewed.value = null
    checked.value = false
    reviewVisible.value = false
}

function reopenUncertain() {
    if (!reviewed.value) return
    reviewVisible.value = true
}

function declarationFailed(error: unknown): string {
    const fallback = 'No se pudo registrar la declaración. Reintentá en unos instantes.'
    const message = paymentErrorMessage(error, fallback)
    if (!isUncertainDeclarationError(error)) {
        // Un rechazo definitivo no debe quedar atrapado en el estado incierto anterior.
        uncertain.value = false
        return message
    }
    uncertain.value = true
    return `${message} No generamos una nueva declaración: conservá esta clave y consultá el estado o reintentá.`
}

async function sendDeclaration() {
    const attempt = reviewed.value
    const key = idempotencyKey.value
    if (!attempt || submitting.value || checking.value) return
    if (!uncertain.value && !checked.value) return
    if (!isIdempotencyKey(key)) {
        formError.value = 'La clave de idempotencia no es válida. Volvé a revisar la declaración.'
        return
    }

    const current = ++declarationRequest
    declarationController?.abort()
    const controller = new AbortController()
    declarationController = controller
    const startedIdentity = identity()
    const valid = () => current === declarationRequest && !controller.signal.aborted &&
        startedIdentity === identity() && allowed()

    submitting.value = true
    formError.value = ''
    notice.value = ''
    try {
        const result = await declareClientPayment(attempt.payload, key, controller.signal)
        if (!valid()) return
        const message = result.replay
            ? 'La declaración ya estaba registrada. No se creó un pago duplicado.'
            : 'Declaración registrada. Queda pendiente de revisión y todavía no acredita dinero.'
        resetDraft()
        notice.value = message
        emit('declared', result.payment.id)
        void loadReceipts(1)
    } catch (error: unknown) {
        if (!valid()) return
        formError.value = declarationFailed(error)
        if (!uncertain.value) {
            idempotencyKey.value = null
            reviewed.value = null
            checked.value = false
            reviewVisible.value = false
            if (paymentErrorCode(error) === 'COMPROBANTE_YA_DECLARADO') {
                emit('declared', null)
            }
        }
    } finally {
        if (valid()) submitting.value = false
    }
}

async function checkDeclarationStatus() {
    const attempt = reviewed.value
    if (!attempt || checking.value || submitting.value) return

    const current = ++declarationRequest
    declarationController?.abort()
    const controller = new AbortController()
    declarationController = controller
    const startedIdentity = identity()
    const valid = () => current === declarationRequest && !controller.signal.aborted &&
        startedIdentity === identity() && allowed()

    checking.value = true
    formError.value = ''
    notice.value = ''
    try {
        const found = await findClientPaymentByReceipt(
            attempt.payload.comprobanteId,
            controller.signal,
        )
        if (!valid()) return
        if (!found) {
            formError.value = 'No encontramos una declaración para ese comprobante. El resultado sigue sin confirmarse; podés reintentar con la misma clave.'
            return
        }
        const message = found.estado === 'ACREDITADO'
            ? 'La declaración existe y el pago figura acreditado.'
            : 'La declaración existe y su estado fue confirmado por el servidor.'
        resetDraft()
        notice.value = message
        emit('declared', found.id)
    } catch (error: unknown) {
        if (!valid()) return
        formError.value = paymentErrorMessage(
            error,
            'No pudimos consultar el estado de la declaración. Reintentá la consulta.',
        )
    } finally {
        if (valid()) checking.value = false
    }
}

watch(identity, () => {
    receiptsRequest += 1
    receiptsController?.abort()
    receiptsController = undefined
    resetDraft()
    void loadReceipts(1)
}, { flush: 'sync', immediate: true })

watch(() => props.refreshVersion, () => {
    if (!allowed()) return
    void loadReceipts(1)
})

onBeforeUnmount(() => {
    receiptsRequest += 1
    receiptsController?.abort()
    abortDeclarations()
})
</script>

<template>
    <section v-if="allowed()" aria-labelledby="payment-declaration-title"
        class="mt-8 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <header class="mb-4">
            <h2 id="payment-declaration-title" class="m-0 text-xl font-semibold text-[#0B2438]">
                Declarar un pago
            </h2>
            <p class="m-0 mt-1 text-sm text-slate-600">
                Elegí un comprobante propio ya cargado, indicá el importe y confirmá la declaración.
                La revisión y la acreditación se realizan después, por separado.
            </p>
        </header>

        <p v-if="notice" role="status" class="m-0 mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            {{ notice }}
        </p>
        <div v-if="uncertaintyActive" role="alert" class="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p class="m-0 mb-2">
                Hay una declaración con resultado incierto. No generes otra declaración nueva.
                Consultá el estado o reintentá con la misma clave.
            </p>
            <div class="flex flex-wrap gap-2">
                <button type="button" class="box-border min-h-11 cursor-pointer rounded-md border border-solid border-amber-700 bg-white px-3 py-2 font-[inherit] text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                    :disabled="checking || submitting" @click="reopenUncertain">
                    Revisar declaración incierta
                </button>
                <button type="button" class="box-border min-h-11 cursor-pointer rounded-md border-0 bg-[#145A8D] px-3 py-2 font-[inherit] text-sm font-semibold text-white hover:bg-[#103A5C] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                    :disabled="checking || submitting" @click="checkDeclarationStatus">
                    {{ checking ? 'Consultando…' : 'Consultar estado' }}
                </button>
            </div>
        </div>

        <p v-if="formError && !reviewVisible" role="alert" class="m-0 mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            {{ formError }}
        </p>

        <form class="grid gap-5" @submit.prevent="reviewDeclaration">
            <fieldset class="m-0 min-w-0 rounded-lg border border-slate-200 p-3 sm:p-4" :disabled="submitting || uncertain">
                <legend class="px-1 text-sm font-semibold text-[#0B2438]">Comprobante propio</legend>

                <p v-if="receiptsLoading" role="status" class="m-0 text-sm text-slate-600">
                    Cargando tus comprobantes…
                </p>
                <div v-else-if="receiptsError" class="grid gap-2">
                    <p role="alert" class="m-0 text-sm text-red-800">{{ receiptsError }}</p>
                    <button type="button" class="box-border min-h-11 w-fit cursor-pointer rounded-md border border-solid border-red-300 bg-white px-3 py-2 font-[inherit] text-sm font-semibold text-red-900 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                        @click="loadReceipts(receiptsPage)">
                        Reintentar comprobantes
                    </button>
                </div>
                <template v-else>
                    <p v-if="receipts.length === 0" role="status" class="m-0 text-sm text-slate-600">
                        Todavía no tenés comprobantes cargados. Subí uno en la sección
                        <strong>Comprobantes de pago</strong> y volvé a esta declaración.
                    </p>
                    <div v-else class="grid max-h-72 gap-2 overflow-y-auto pr-1">
                        <label v-for="receipt in receipts" :key="receipt.id"
                            class="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm"
                            :class="selectedReceiptId === receipt.id
                                ? 'border-[#145A8D] bg-sky-50'
                                : 'border-slate-200 bg-white hover:bg-slate-50'">
                            <input type="radio" name="payment-receipt" class="mt-0.5 box-border h-5 w-5 shrink-0 cursor-pointer accent-[#145A8D] disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                                :value="receipt.id" :checked="selectedReceiptId === receipt.id"
                                @change="selectReceipt(receipt)">
                            <span class="min-w-0">
                                <span class="block font-semibold text-[#0B2438]">
                                    {{ receiptTypeLabels[receipt.tipoMime] ?? 'Archivo' }} ·
                                    {{ receipt.pedidoId !== null ? `Pedido PED-${String(receipt.pedidoId).padStart(6, '0')}` : 'Saldo general de cuenta corriente' }}
                                </span>
                                <span class="block text-slate-600">
                                    Cargado {{ formatInstant(receipt.fecha) }} · {{ receiptReviewStatusLabel(receipt.estadoRevision) }}
                                </span>
                            </span>
                        </label>
                    </div>
                    <div v-if="receiptsPage > 1 || receiptsNext" class="mt-3 flex flex-wrap gap-2">
                        <button v-if="receiptsPage > 1" type="button"
                            class="box-border min-h-11 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm font-semibold text-[#0B2438] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                            @click="loadReceipts(receiptsPage - 1)">
                            Comprobantes anteriores
                        </button>
                        <button v-if="receiptsNext" type="button"
                            class="box-border min-h-11 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm font-semibold text-[#0B2438] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                            @click="loadReceipts(receiptsNext)">
                            Más comprobantes
                        </button>
                    </div>
                </template>
            </fieldset>

            <div class="grid gap-4 sm:grid-cols-2">
                <label class="grid min-w-0 content-start gap-1 text-sm font-medium" for="payment-amount">
                    Importe declarado
                    <input id="payment-amount" v-model="monto" inputmode="decimal" autocomplete="off"
                        placeholder="0.00" aria-describedby="payment-amount-help"
                        :disabled="submitting || uncertain"
                        class="box-border min-h-11 w-full min-w-0 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm text-[#0B2438] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]">
                    <span id="payment-amount-help" class="font-normal text-slate-600">
                        Mayor a cero, hasta dos decimales. No se convierte desde la interfaz.
                    </span>
                </label>
                <label class="grid min-w-0 content-start gap-1 text-sm font-medium" for="payment-currency">
                    Moneda
                    <select id="payment-currency" v-model="moneda" :disabled="submitting || uncertain"
                        class="box-border min-h-11 w-full min-w-0 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm text-[#0B2438] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]">
                        <option value="USD">USD — dólares</option>
                        <option value="ARS">ARS — pesos argentinos</option>
                    </select>
                </label>
            </div>

            <label class="grid min-w-0 gap-1 text-sm font-medium" for="payment-observations">
                Observaciones opcionales
                <textarea id="payment-observations" v-model="observaciones" rows="3" maxlength="1000"
                    :disabled="submitting || uncertain"
                    class="box-border w-full min-w-0 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm text-[#0B2438] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]" />
                <span class="font-normal text-slate-600">{{ observaciones.length }} / 1000 caracteres.</span>
            </label>

            <div class="flex flex-wrap items-center gap-3">
                <button type="submit"
                    class="box-border min-h-11 cursor-pointer rounded-md border-0 bg-[#145A8D] px-4 py-2 font-[inherit] text-sm font-semibold text-white hover:bg-[#103A5C] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                    :disabled="!canReview">
                    Revisar declaración
                </button>
                <p class="m-0 text-sm text-slate-600">
                    {{ formatPaymentMoney(monto.trim() || null, moneda) }}
                </p>
            </div>
        </form>

        <PaymentReviewDialog v-if="reviewVisible && reviewValue && reviewReceipt"
            :payload="reviewValue" :receipt="reviewReceipt" :busy="submitting"
            :uncertain="uncertain" :error="formError" :checked="checked"
            @update:checked="checked = $event" @confirm="sendDeclaration" @cancel="closeReview"
            @retry="sendDeclaration" @check-status="checkDeclarationStatus" />
    </section>
</template>
