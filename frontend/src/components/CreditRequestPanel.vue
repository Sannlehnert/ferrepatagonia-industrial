<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import {
    createClientCreditRequest,
    creditRequestErrorMessage,
    getClientCreditRequests,
    isDefinitiveCreditRequestRejection,
    isPendingCreditRequestConflict,
} from '@/services/creditRequestService'
import type { CreateCreditRequestPayload, CreditRequest } from '@/types/creditRequest'
import { formatInstant, formatUsd } from '@/utils/cuentaCorriente'

const props = defineProps<{ refreshVersion: number }>()
const auth = useAuthStore()
const requests = ref<CreditRequest[]>([])
const loading = ref(false)
const loadError = ref('')
const submitError = ref('')
const successMessage = ref('')
const submitting = ref(false)
const montoSolicitado = ref('')
const plazoDias = ref<30 | 60>(30)
const observaciones = ref('')
const retrySubmission = ref<{ key: string; payload: CreateCreditRequestPayload } | null>(null)
let loadId = 0
let submitId = 0

const isCompany = computed(() => auth.user?.tipo_cliente === 'EMPRESA')
const approvalStatus = computed(() => auth.user?.estadoAprobacionEmpresa)
const canRequest = computed(() => auth.rol === 'CLIENTE' && !auth.loggingIn && !auth.loggingOut &&
    isCompany.value && approvalStatus.value === 'APROBADA')
const identity = () => `${auth.user?.id ?? ''}:${auth.sessionVersion}:${canRequest.value}`
const pendingRequest = computed(() => requests.value.some(request => request.estado === 'PENDIENTE'))

async function loadRequests() {
    const currentLoad = ++loadId
    loadError.value = ''
    requests.value = []
    if (!canRequest.value) {
        loading.value = false
        return
    }

    loading.value = true
    try {
        const result = await getClientCreditRequests()
        if (currentLoad === loadId) requests.value = result
    } catch (error: unknown) {
        if (currentLoad === loadId) loadError.value = creditRequestErrorMessage(error)
    } finally {
        if (currentLoad === loadId) loading.value = false
    }
}

watch(
    identity,
    () => {
        submitId += 1
        submitting.value = false
        retrySubmission.value = null
        submitError.value = ''
        successMessage.value = ''
        montoSolicitado.value = ''
        plazoDias.value = 30
        observaciones.value = ''
        void loadRequests()
    },
    { immediate: true, flush: 'sync' },
)

watch(() => props.refreshVersion, () => void loadRequests())

onBeforeUnmount(() => {
    loadId += 1
    submitId += 1
})

function requestStatusLabel(status: CreditRequest['estado']): string {
    if (status === 'PENDIENTE') return 'Pendiente'
    if (status === 'APROBADA') return 'Aprobada'
    return 'Rechazada'
}

function requestStatusClasses(status: CreditRequest['estado']): string {
    if (status === 'PENDIENTE') return 'border-amber-300 bg-amber-50 text-amber-900'
    if (status === 'APROBADA') return 'border-green-300 bg-green-50 text-green-900'
    return 'border-red-300 bg-red-50 text-red-900'
}

function requestStatusMessage(status: CreditRequest['estado']): string {
    if (status === 'PENDIENTE') {
        return 'Está en revisión. La solicitud pendiente no implica aprobación ni habilitación automática de la cuenta.'
    }
    if (status === 'APROBADA') {
        return 'El equipo comercial aprobó la solicitud. Consultá el estado comercial para verificar si la cuenta está habilitada.'
    }
    return 'La solicitud fue rechazada. Podés volver a solicitar crédito o contactar al equipo comercial.'
}

async function submitRequest() {
    if (!canRequest.value || pendingRequest.value || submitting.value) return

    if (!retrySubmission.value) {
        const amount = montoSolicitado.value.trim()
        if (/^0(?:\.0{1,2})?$/.test(amount)) {
            submitError.value = 'El monto solicitado debe ser mayor a cero.'
            return
        }
        const payload: CreateCreditRequestPayload = {
            montoSolicitado: amount,
            plazoDias: plazoDias.value,
            ...(observaciones.value.trim() ? { observaciones: observaciones.value.trim() } : {}),
        }
        retrySubmission.value = { key: crypto.randomUUID(), payload }
    }

    submitting.value = true
    submitError.value = ''
    successMessage.value = ''
    const currentSubmit = ++submitId
    const currentIdentity = identity()
    const valid = () => currentSubmit === submitId && currentIdentity === identity() && canRequest.value
    const attempt = retrySubmission.value
    try {
        const created = await createClientCreditRequest(
            attempt.payload,
            attempt.key,
        )
        if (!valid()) return
        loadId += 1
        loading.value = false
        loadError.value = ''
        requests.value = [created, ...requests.value.filter(request => request.id !== created.id)]
        retrySubmission.value = null
        montoSolicitado.value = ''
        observaciones.value = ''
        successMessage.value = 'Solicitud registrada. El equipo comercial debe revisarla; no se aprobó automáticamente.'
    } catch (error: unknown) {
        if (!valid()) return
        submitError.value = creditRequestErrorMessage(error)
        if (isDefinitiveCreditRequestRejection(error)) retrySubmission.value = null
        if (isPendingCreditRequestConflict(error)) void loadRequests()
    } finally {
        if (valid()) submitting.value = false
    }
}
</script>

<template>
    <section v-if="isCompany" aria-labelledby="credit-request-title"
        class="mb-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 id="credit-request-title" class="m-0 mb-2 text-xl font-semibold">Solicitud de crédito</h2>
        <template v-if="approvalStatus !== 'APROBADA'">
            <p v-if="approvalStatus === 'PENDIENTE'" role="status" class="m-0 text-slate-700">
                Tu empresa todavía no es elegible para solicitar crédito: la aprobación comercial está pendiente.
                Una vez aprobada, podrás enviar una solicitud para evaluación.
            </p>
            <p v-else-if="approvalStatus === 'RECHAZADA'" role="status"
                class="m-0 text-slate-700">
                Tu empresa no es elegible para solicitar crédito porque su aprobación comercial fue rechazada.
                Contactá al equipo comercial para recibir asistencia.
            </p>
            <p v-else role="status" class="m-0 text-slate-700">
                No podemos determinar si tu empresa es elegible para solicitar crédito. Actualizá tu sesión o contactá al equipo comercial.
            </p>
        </template>
        <template v-else>
            <p class="mb-4 text-slate-600">
                Enviá el monto y plazo que necesitás. La solicitud queda pendiente de evaluación y no habilita crédito automáticamente.
            </p>
            <p v-if="submitError" role="alert"
                class="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-red-800">
                {{ submitError }}
            </p>
            <p v-if="loading" role="status" class="mb-4">Consultando tus solicitudes de crédito…</p>
            <div v-else-if="loadError" class="mb-4 rounded-md border border-red-200 bg-red-50 p-3">
                <p role="alert" class="m-0 mb-2">{{ loadError }}</p>
                <button type="button" class="box-border min-h-11 cursor-pointer rounded-md border border-solid border-red-300 bg-white px-3 py-2 font-[inherit] text-sm font-semibold text-[#0B2438] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                    @click="loadRequests">Reintentar consulta</button>
            </div>
            <template v-else>
                <ul v-if="requests.length" class="mb-5 grid list-none gap-3 p-0">
                    <li v-for="request in requests" :key="request.id"
                        class="rounded-md border p-4" :class="requestStatusClasses(request.estado)">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <h3 class="m-0 font-semibold">
                                Solicitud #{{ request.id }} · {{ requestStatusLabel(request.estado) }}
                            </h3>
                            <span class="text-sm">{{ formatInstant(request.fechaSolicitud) }}</span>
                        </div>
                        <p class="mb-1 mt-2">
                            Monto solicitado: {{ formatUsd(request.montoSolicitado) }} · Plazo: {{ request.plazoDias }} días
                        </p>
                        <p v-if="request.estado === 'APROBADA' && request.limiteAutorizado"
                            class="mb-1 mt-0">
                            Límite autorizado: {{ formatUsd(request.limiteAutorizado) }}
                            <span v-if="request.plazoAutorizado"> · Plazo autorizado: {{ request.plazoAutorizado }} días</span>
                        </p>
                        <p class="m-0 text-sm">{{ requestStatusMessage(request.estado) }}</p>
                    </li>
                </ul>
                <p v-else class="mb-5 text-slate-600">Todavía no tenés solicitudes de crédito.</p>

                <p v-if="pendingRequest" role="status"
                    class="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                    Ya hay una solicitud pendiente. Podrás enviar otra cuando se resuelva.
                </p>
                <form v-else class="grid gap-4 sm:grid-cols-2" @submit.prevent="submitRequest">
                    <p v-if="retrySubmission" role="status" class="m-0 text-sm text-slate-700 sm:col-span-2">
                        El resultado del envío no está confirmado. Reintentá con los mismos datos para evitar solicitudes duplicadas.
                    </p>
                    <label class="grid min-w-0 gap-1 text-sm font-medium" for="credit-amount">
                        Monto solicitado (USD)
                        <input id="credit-amount" v-model="montoSolicitado" required
                            inputmode="decimal" pattern="(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,2})?"
                            :disabled="submitting || retrySubmission !== null"
                            class="box-border min-h-11 w-full min-w-0 rounded-md border border-solid border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm font-normal text-[#0B2438] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                            aria-describedby="credit-amount-help">
                        <span id="credit-amount-help" class="font-normal text-slate-600">
                            Ingresá un importe mayor a cero, con hasta dos decimales.
                        </span>
                    </label>
                    <label class="grid min-w-0 content-start gap-1 text-sm font-medium" for="credit-term">
                        Plazo solicitado
                        <select id="credit-term" v-model.number="plazoDias"
                            :disabled="submitting || retrySubmission !== null"
                            class="box-border min-h-11 w-full min-w-0 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm font-normal text-[#0B2438] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]">
                            <option :value="30">30 días</option>
                            <option :value="60">60 días</option>
                        </select>
                    </label>
                    <label class="grid min-w-0 gap-1 text-sm font-medium sm:col-span-2" for="credit-notes">
                        Observaciones (opcional)
                        <textarea id="credit-notes" v-model="observaciones" maxlength="1000" rows="3"
                            :disabled="submitting || retrySubmission !== null"
                            class="box-border w-full min-w-0 rounded-md border border-solid border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm font-normal text-[#0B2438] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"></textarea>
                    </label>
                    <p v-if="successMessage" role="status"
                        class="m-0 rounded-md border border-green-200 bg-green-50 p-3 text-green-800 sm:col-span-2">
                        {{ successMessage }}
                    </p>
                    <div class="flex flex-wrap items-center gap-3 sm:col-span-2">
                        <button type="submit"
                            class="box-border min-h-11 cursor-pointer rounded-md border-0 bg-[#103A5C] px-4 py-2 font-[inherit] text-sm font-semibold text-white hover:bg-[#145A8D] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                            :disabled="submitting">
                            {{ submitting ? 'Enviando…' : retrySubmission ? 'Reintentar envío' : 'Solicitar crédito' }}
                        </button>
                        <p class="m-0 text-sm text-slate-600">
                            El envío no garantiza aprobación ni habilitación de la cuenta.
                        </p>
                    </div>
                </form>
            </template>
        </template>
    </section>
</template>
