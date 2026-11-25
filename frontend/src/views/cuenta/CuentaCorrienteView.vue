<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, onBeforeRouteLeave } from 'vue-router'
import CompanyStatus from '@/components/CompanyStatus.vue'
import CreditRequestPanel from '@/components/CreditRequestPanel.vue'
import PaymentDeclarationForm from '@/components/PaymentDeclarationForm.vue'
import PaymentHistory from '@/components/PaymentHistory.vue'
import PaymentReceipts from '@/components/PaymentReceipts.vue'
import { accountReceiptsPath } from '@/services/paymentReceiptService'
import { onRealtime } from '@/services/realtime'
import { useAuthStore } from '@/stores/auth'
import { useCuentaCorrienteStore } from '@/stores/cuentaCorriente'
import type { CreditRequestSnapshot } from '@/types/creditRequest'
import type { CuentaCorrienteResumen, CuentaCorrienteVencimiento } from '@/types/cuentaCorriente'
import { creditMessage } from '@/utils/companyStatus'
import { clientCreditExperience, type CreditExperienceTone } from '@/utils/creditExperience'
import {
    coverageMessage,
    formatCivilDate,
    formatInstant,
    formatUsd,
} from '@/utils/cuentaCorriente'
import { STATE_BADGE_TONES, sumExactDecimals } from '@/utils/payment'

const auth = useAuthStore()
const cuenta = useCuentaCorrienteStore()
const creditRefreshVersion = ref(0)
const receiptRefreshVersion = ref(0)
const paymentHistoryVersion = ref(0)
const requestState = ref<CreditRequestSnapshot>({
    requests: [],
    loading: true,
    pending: false,
    canRequest: false,
})

async function refreshAccount() {
    creditRefreshVersion.value += 1
    try {
        await auth.fetchSession()
    } catch {
        // La consulta financiera se reintenta igual; el estado de sesión conserva su último valor válido.
    }
    await cuenta.load()
}

function handleReceiptsUpdated() {
    receiptRefreshVersion.value += 1
}

function handlePaymentDeclared() {
    paymentHistoryVersion.value += 1
}

const resumen = computed(() => {
    const consulta = cuenta.consulta
    return consulta && consulta.estado !== 'SIN_CUENTA'
        ? consulta
        : null
})

const movimientos = computed(() => cuenta.movimientos && 'items' in cuenta.movimientos
    ? cuenta.movimientos.items
    : [])

const vencimientos = computed(() => cuenta.vencimientos && 'items' in cuenta.vencimientos
    ? cuenta.vencimientos.items
    : [])

const financialDataReady = computed(() =>
    Boolean(
        resumen.value &&
        cuenta.movimientos && 'items' in cuenta.movimientos &&
        cuenta.vencimientos && 'items' in cuenta.vencimientos &&
        !cuenta.consultaCargando &&
        !cuenta.movimientosCargando &&
        !cuenta.vencimientosCargando &&
        !cuenta.consultaError &&
        !cuenta.movimientosError &&
        !cuenta.vencimientosError &&
        cuenta.movimientos.revision === cuenta.consulta?.revision &&
        cuenta.vencimientos.revision === cuenta.consulta?.revision
    ),
)

const demoDataBlocked = computed(() => financialDataReady.value && !import.meta.env.DEV && (
    resumen.value?.origen === 'DEMO' ||
    movimientos.value.some(item => item.origen === 'DEMO') ||
    vencimientos.value.some(item => item.origen === 'DEMO')
))

const movementTotals = computed<{ cargos: string; abonos: string } | null>(() => {
    if (!resumen.value || resumen.value.cobertura !== 'COMPLETA') return null
    const page = cuenta.movimientos
    if (!page || !('items' in page) || page.siguienteCursor !== null) return null
    if (page.revision !== cuenta.consulta?.revision) return null
    const active = page.items.filter(item => item.estado === 'VIGENTE' && item.moneda === 'USD')
    const cargos = sumExactDecimals(active.filter(item => item.tipo === 'CARGO').map(item => item.importe))
    const abonos = sumExactDecimals(active.filter(item => item.tipo === 'ABONO').map(item => item.importe))
    return cargos !== null && abonos !== null ? { cargos, abonos } : null
})

const totalsNote = computed(() =>
    movementTotals.value
        ? ''
        : 'Los totales no se muestran porque la API no expone agregados y el historial cargado no cubre toda la cuenta.',
)

const financialDataUnavailable = computed(() =>
    !cuenta.consultaCargando &&
    !cuenta.movimientosCargando &&
    !cuenta.vencimientosCargando &&
    Boolean(cuenta.movimientosError || cuenta.vencimientosError),
)

const experience = computed(() => clientCreditExperience({
    approval: auth.user?.estadoAprobacionEmpresa,
    account: cuenta.consulta,
    accountKnown: Boolean(cuenta.consulta),
    accountFailed: Boolean(cuenta.consultaError),
    latestRequest: requestState.value.requests[0] ?? null,
    requestsLoading: requestState.value.loading,
}))

const TONE_CLASSES: Record<CreditExperienceTone, string> = {
    positive: 'border-[#BBF7D0] bg-[#F0FDF4]',
    warning: 'border-[#FDE68A] bg-[#FFFBEB]',
    danger: 'border-[#FECACA] bg-[#FEF2F2]',
    neutral: 'border-slate-200 bg-slate-50',
    info: 'border-[#BFDBFE] bg-[#EFF6FF]',
}

const utilization = computed<{ percent: number; label: string } | null>(() => {
    const account = resumen.value
    if (!account || account.cobertura !== 'COMPLETA') return null
    const values = [account.limite, account.utilizado, account.disponible]
    if (values.some(value => value === null || !/^\d{1,13}(?:\.\d{1,2})?$/.test(value))) return null
    const limit = Number(account.limite)
    const used = Number(account.utilizado)
    if (!Number.isFinite(limit) || !Number.isFinite(used) || limit <= 0 || used < 0) return null
    const percent = Math.min(100, Math.max(0, Math.round((used / limit) * 100)))
    return { percent, label: `Uso del límite autorizado: ${percent}%.` }
})

type StepState = 'done' | 'current' | 'pending' | 'blocked'

const processSteps = computed<Array<{ label: string; detail: string; state: StepState }>>(() => {
    const approval = auth.user?.estadoAprobacionEmpresa
    const approved = approval === 'APROBADA'
    const rejected = approval === 'RECHAZADA'
    const request = requestState.value.requests[0] ?? null
    const account = resumen.value
    const enabled = account?.estado === 'HABILITADA'
    return [
        {
            label: 'Aprobación empresarial',
            detail: approved ? 'Empresa aprobada' : rejected ? 'Empresa rechazada' : 'Pendiente o no determinable',
            state: approved ? 'done' : rejected ? 'blocked' : 'current',
        },
        {
            label: 'Solicitud de crédito',
            detail: request ? `Solicitud #${request.id} registrada` : approved ? 'Todavía sin solicitud' : 'Requiere aprobación previa',
            state: !approved ? 'pending' : request ? 'done' : 'current',
        },
        {
            label: 'Resolución',
            detail: request?.estado === 'APROBADA' ? 'Solicitud aprobada'
                : request?.estado === 'RECHAZADA' ? 'Solicitud rechazada'
                    : request?.estado === 'PENDIENTE' ? 'En revisión' : 'Sin resolución',
            state: request?.estado === 'APROBADA' ? 'done'
                : request?.estado === 'RECHAZADA' ? 'blocked'
                    : request?.estado === 'PENDIENTE' ? 'current' : 'pending',
        },
        {
            label: 'Habilitación de la cuenta',
            detail: enabled ? 'Cuenta habilitada' : account ? 'Cuenta inhabilitada' : 'Sin cuenta corriente',
            state: enabled ? 'done' : account ? 'current' : 'pending',
        },
    ]
})

const eligibilityNote = computed(() => {
    const account = resumen.value
    if (!account) return ''
    if (account.estado === 'INHABILITADA') {
        return 'Una cuenta inhabilitada conserva su historial, pero no permite nuevas compras a crédito.'
    }
    if (account.estadoCredito === 'BLOQUEADO') {
        return 'La cuenta está habilitada, pero la elegibilidad efectiva de compra está bloqueada en este momento.'
    }
    if (account.estadoCredito === 'DISPONIBLE') {
        return 'La habilitación no garantiza cada compra: el límite, la cobertura y las restricciones se revalidan al confirmar.'
    }
    return 'No se puede confirmar la elegibilidad efectiva con la información actual.'
})

const hasDueDates = computed(() => vencimientos.value.length > 0)
const hasOverdue = computed(() => vencimientos.value.some(item => item.estado === 'VENCIDO'))

function dueClasses(item: CuentaCorrienteVencimiento): string {
    if (item.estado === 'VENCIDO') return 'border-red-300 bg-red-50'
    if (item.plazoDias === 30) return 'border-amber-300 bg-amber-50'
    if (item.plazoDias === 60) return 'border-sky-300 bg-sky-50'
    return 'border-slate-200 bg-white'
}

function dueLabel(item: CuentaCorrienteVencimiento): string {
    if (item.estado === 'NO_DETERMINABLE') return 'Vencimiento no determinable'
    if (item.estado === 'VENCIDO') return 'Vencido'
    return 'Por vencer'
}

function accountStateLabel(estado: CuentaCorrienteResumen['estado']): string {
    return estado === 'HABILITADA' ? 'Habilitada' : 'Inhabilitada'
}

function coverageLabel(cobertura: CuentaCorrienteResumen['cobertura']): string {
    if (cobertura === 'COMPLETA') return 'Completa'
    if (cobertura === 'PARCIAL') return 'Parcial'
    return 'No acreditada'
}

function emptyMessage(coverage: string): string {
    return coverage === 'COMPLETA'
        ? 'No hay movimientos registrados en esta cuenta.'
        : 'No hay movimientos suficientes para mostrar un historial completo.'
}

function scrollToSection(id: string) {
    if (typeof document === 'undefined') return
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

function runExperienceAction() {
    const action = experience.value.action
    if (action === 'actualizar') {
        void refreshAccount()
        return
    }
    if (action === 'solicitar' || action === 'ver-solicitud') scrollToSection('solicitud-credito')
    else if (action === 'vencimientos') scrollToSection('vencimientos')
    else if (action === 'movimientos') scrollToSection('movimientos')
    else if (action === 'comprobantes') scrollToSection('comprobantes')
}

onMounted(() => void cuenta.load())
onRealtime(change => {
    if (auth.loggingOut || !auth.user) return
    if (change.reconnect || change.payments || change.account) {
        paymentHistoryVersion.value += 1
        void cuenta.load()
    }
    if (change.reconnect || change.receipts) {
        receiptRefreshVersion.value += 1
    }
})
watch(() => auth.sessionVersion, () => {
    // Durante el cierre de sesión o sin usuario, consultar solo provoca un 401 y un redirect superpuesto.
    if (auth.loggingOut || !auth.user) return
    void cuenta.load()
})
onBeforeRouteLeave(() => cuenta.clear())
</script>

<template>
    <section aria-labelledby="current-account-title" class="min-w-0 text-[#0b2438]">
        <header class="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
                <p class="m-0 mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Mi cuenta</p>
                <h1 id="current-account-title" class="m-0 mb-2 text-[28px] font-semibold">Mi cuenta corriente</h1>
                <p class="m-0 max-w-2xl leading-6 text-slate-600">
                    Tu situación, el crédito disponible y las acciones disponibles en un solo lugar.
                </p>
            </div>
            <button type="button" class="box-border min-h-11 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-4 py-2 font-[inherit] text-sm font-semibold text-[#0B2438] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                :disabled="cuenta.consultaCargando" @click="refreshAccount()">
                {{ cuenta.consultaCargando ? 'Actualizando…' : 'Actualizar' }}
            </button>
        </header>

        <CompanyStatus
            class="mb-6"
            controlled
            :summary="cuenta.consulta"
            :summary-loading="cuenta.consultaCargando"
            :summary-error="Boolean(cuenta.consultaError)"
            :summary-demo-blocked="demoDataBlocked"
            @refresh="refreshAccount"
        />

        <article
            :class="TONE_CLASSES[experience.tone]"
            class="mb-6 rounded-[10px] border border-solid p-4 sm:p-5"
            aria-labelledby="credit-experience-title"
        >
            <h2 id="credit-experience-title" class="m-0 text-lg font-bold">{{ experience.title }}</h2>
            <p class="m-0 mt-2 text-sm leading-6 text-slate-700">{{ experience.description }}</p>
            <p class="m-0 mt-2 text-sm leading-6 text-slate-700">
                <strong>Próximo paso:</strong> {{ experience.nextStep }}
            </p>
            <div class="mt-3 flex flex-wrap items-center gap-3">
                <RouterLink
                    v-if="experience.action === 'catalogo'"
                    :to="{ name: 'catalogo' }"
                    class="box-border inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[8px] border border-transparent bg-[#15803D] px-4 py-2 font-[inherit] text-sm font-semibold text-white no-underline hover:bg-[#166534] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                >
                    {{ experience.actionLabel }}
                </RouterLink>
                <button
                    v-else
                    type="button"
                    class="box-border inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-[8px] border border-solid border-[#103A5C] bg-white px-4 py-2 font-[inherit] text-sm font-semibold text-[#103A5C] hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                    @click="runExperienceAction"
                >
                    {{ experience.actionLabel }}
                </button>
            </div>
        </article>

        <CreditRequestPanel
            :refresh-version="creditRefreshVersion"
            :account="cuenta.consulta"
            @state="requestState = $event"
        />

        <p v-if="cuenta.consultaCargando || cuenta.movimientosCargando || cuenta.vencimientosCargando" role="status"
            class="rounded-md bg-slate-50 p-4">
            Consultando la cuenta corriente…
        </p>
        <div v-else-if="cuenta.consultaError" class="rounded-md border border-red-200 bg-red-50 p-4">
            <p role="alert" class="m-0 mb-3">{{ cuenta.consultaError }}</p>
            <button type="button" class="box-border min-h-[44px] min-w-[44px] cursor-pointer rounded-md border border-solid border-red-300 bg-white px-4 py-2 font-[inherit] text-sm font-semibold text-red-900 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                @click="refreshAccount()">Reintentar</button>
        </div>
        <p v-else-if="cuenta.consulta?.estado === 'SIN_CUENTA'" role="status"
            class="rounded-md border border-slate-200 bg-slate-50 p-4">
            No tenés una cuenta corriente asociada. Cuando se apruebe y habilite tu crédito, acá vas a ver el resumen y las operaciones.
        </p>
        <div v-else-if="financialDataUnavailable || (resumen && !financialDataReady)"
            class="rounded-md border border-red-200 bg-red-50 p-4">
            <p role="alert" class="m-0 mb-3">
                No se pudieron verificar todos los datos financieros de la cuenta. No mostraremos cifras hasta completar la consulta.
                {{ cuenta.movimientosError }} {{ cuenta.vencimientosError }}
            </p>
            <button type="button" class="box-border min-h-[44px] min-w-[44px] cursor-pointer rounded-md border border-solid border-red-300 bg-white px-4 py-2 font-[inherit] text-sm font-semibold text-red-900 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                @click="refreshAccount()">Actualizar cuenta</button>
        </div>
        <p v-else-if="demoDataBlocked" role="alert"
            class="rounded-md border border-amber-300 bg-amber-50 p-4">
            Se recibió información de demostración y no se mostrará fuera del entorno de pruebas.
        </p>

        <template v-if="resumen && financialDataReady && !demoDataBlocked">
            <p v-if="resumen.estado === 'HABILITADA'" role="status"
                class="mb-5 rounded-md border border-slate-200 bg-slate-50 p-4">
                {{ creditMessage(resumen) }}
            </p>

            <p v-if="resumen.estado === 'INHABILITADA'" role="status"
                class="mb-5 rounded-md border border-amber-300 bg-amber-50 p-4">
                La cuenta está inhabilitada. Podés consultar el saldo acreditado y su historial, pero no operar a crédito.
            </p>

            <section aria-labelledby="credit-progress-title" class="mb-6 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
                <h2 id="credit-progress-title" class="m-0 text-lg font-semibold">Estado del proceso</h2>
                <ol class="m-0 mt-4 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-4">
                    <li v-for="(step, index) in processSteps" :key="step.label" class="min-w-0 rounded-md border border-slate-200 p-3">
                        <p class="m-0 text-xs font-semibold uppercase tracking-wide text-slate-500">Paso {{ index + 1 }}</p>
                        <p class="m-0 mt-1 font-semibold text-[#0B2438]">{{ step.label }}</p>
                        <p class="m-0 mt-1 text-sm text-slate-600">{{ step.detail }}</p>
                        <p class="m-0 mt-1 text-xs font-semibold"
                            :class="step.state === 'done' ? 'text-green-800'
                                : step.state === 'blocked' ? 'text-red-800'
                                    : step.state === 'current' ? 'text-amber-900' : 'text-slate-500'">
                            {{ step.state === 'done' ? 'Completado'
                                : step.state === 'blocked' ? 'Bloqueado'
                                    : step.state === 'current' ? 'En curso' : 'Pendiente' }}
                        </p>
                    </li>
                </ol>
                <p class="m-0 mt-3 text-sm leading-6 text-slate-700">{{ eligibilityNote }}</p>
            </section>

            <section aria-labelledby="financial-summary-title" class="mb-6">
                <h2 id="financial-summary-title" class="mb-3 text-xl font-semibold">Resumen financiero</h2>
                <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <article class="rounded-lg border border-slate-200 bg-white p-4 sm:col-span-2">
                        <h3 class="m-0 mb-2 text-sm font-medium text-slate-600">Crédito disponible (USD)</h3>
                        <p class="m-0 text-3xl font-semibold tracking-tight">{{ formatUsd(resumen.disponible) }}</p>
                        <p class="m-0 mt-1 text-xs text-slate-500">No es el saldo contable de la cuenta.</p>
                        <div v-if="utilization" class="mt-4">
                            <div
                                class="h-2 w-full overflow-hidden rounded-full bg-slate-200"
                                role="progressbar"
                                :aria-valuenow="utilization.percent"
                                aria-valuemin="0"
                                aria-valuemax="100"
                                :aria-label="utilization.label"
                            >
                                <div class="h-full rounded-full bg-[#145A8D]" :style="{ width: utilization.percent + '%' }" />
                            </div>
                            <p class="m-0 mt-1 text-xs text-slate-600">{{ utilization.label }}</p>
                        </div>
                        <p v-else class="m-0 mt-3 text-xs text-slate-500">
                            El indicador de utilización se muestra solo cuando la cobertura financiera es completa.
                        </p>
                    </article>
                    <article class="rounded-lg border border-slate-200 bg-white p-4">
                        <h3 class="m-0 mb-2 text-sm font-medium text-slate-600">Saldo actual / deuda vigente (USD)</h3>
                        <p class="m-0 text-xl font-semibold">{{ formatUsd(resumen.saldo) }}</p>
                    </article>
                    <article class="rounded-lg border border-slate-200 bg-white p-4">
                        <h3 class="m-0 mb-2 text-sm font-medium text-slate-600">Límite de crédito (USD)</h3>
                        <p class="m-0 text-xl font-semibold">{{ formatUsd(resumen.limite) }}</p>
                    </article>
                    <article class="rounded-lg border border-slate-200 bg-white p-4">
                        <h3 class="m-0 mb-2 text-sm font-medium text-slate-600">Crédito utilizado (USD)</h3>
                        <p class="m-0 text-xl font-semibold">{{ formatUsd(resumen.utilizado) }}</p>
                    </article>
                    <article class="rounded-lg border border-slate-200 bg-white p-4">
                        <h3 class="m-0 mb-2 text-sm font-medium text-slate-600">Plazo comercial</h3>
                        <p class="m-0 text-xl font-semibold">
                            {{ resumen.plazoDias ? `${resumen.plazoDias} días` : 'No determinable' }}
                        </p>
                    </article>
                </div>
                <p v-if="hasOverdue" role="alert" class="m-0 mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                    Tenés vencimientos vencidos. Regularizá la deuda para evitar restricciones en nuevas compras.
                </p>
                <p v-else-if="hasDueDates" class="m-0 mt-3 text-sm text-slate-600">
                    Tenés vencimientos registrados. Consultalos antes de operar.
                </p>
            </section>

            <section aria-labelledby="operations-title" class="mb-6 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
                <h2 id="operations-title" class="m-0 text-lg font-semibold">¿Qué podés hacer ahora?</h2>
                <div class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    <a href="#declarar-pago" class="box-border inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-solid border-slate-300 bg-white px-4 py-2 font-[inherit] text-sm font-semibold text-[#0B2438] no-underline hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]">
                        Declarar un pago
                    </a>
                    <a v-if="auth.user?.tipo_cliente === 'EMPRESA'" href="#comprobantes" class="box-border inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-solid border-slate-300 bg-white px-4 py-2 font-[inherit] text-sm font-semibold text-[#0B2438] no-underline hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]">
                        Adjuntar comprobante
                    </a>
                    <a href="#vencimientos" class="box-border inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-solid border-slate-300 bg-white px-4 py-2 font-[inherit] text-sm font-semibold text-[#0B2438] no-underline hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]">
                        Ver vencimientos
                    </a>
                    <a href="#movimientos" class="box-border inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-solid border-slate-300 bg-white px-4 py-2 font-[inherit] text-sm font-semibold text-[#0B2438] no-underline hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]">
                        Ver movimientos
                    </a>
                    <a href="#historial-pagos" class="box-border inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-solid border-slate-300 bg-white px-4 py-2 font-[inherit] text-sm font-semibold text-[#0B2438] no-underline hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]">
                        Historial de pagos
                    </a>
                </div>
            </section>

            <section aria-labelledby="account-status-title"
                class="mb-6 min-w-0 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
                <h2 id="account-status-title" class="m-0 mb-3 text-lg font-semibold">Estado de la cuenta</h2>
                <dl class="m-0 grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    <div class="min-w-0">
                        <dt class="font-medium text-slate-600">Habilitación</dt>
                        <dd class="m-0 mt-1 font-semibold">{{ accountStateLabel(resumen.estado) }}</dd>
                    </div>
                    <div class="min-w-0">
                        <dt class="font-medium text-slate-600">Cobertura financiera</dt>
                        <dd class="m-0 mt-1 font-semibold">{{ coverageLabel(resumen.cobertura) }}</dd>
                    </div>
                    <div class="min-w-0">
                        <dt class="font-medium text-slate-600">Plazo de pago</dt>
                        <dd class="m-0 mt-1 font-semibold">
                            {{ resumen.plazoDias ? `${resumen.plazoDias} días` : 'No determinable' }}
                        </dd>
                    </div>
                    <div class="min-w-0">
                        <dt class="font-medium text-slate-600">Situación del crédito</dt>
                        <dd class="m-0 mt-1 font-semibold">
                            {{ resumen.estadoCredito === 'DISPONIBLE' ? 'Disponible'
                                : resumen.estadoCredito === 'BLOQUEADO' ? 'Bloqueado' : 'No determinable' }}
                        </dd>
                    </div>
                </dl>
                <p class="m-0 mt-3 text-sm text-slate-600">
                    {{ coverageMessage(resumen.cobertura) }}
                </p>
                <details class="mt-3 text-sm text-slate-600">
                    <summary class="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]">
                        Detalles de la consulta
                    </summary>
                    <p class="m-0 mt-2">
                        Rev. {{ resumen.revision }} · Corte {{ formatInstant(resumen.corte) }}
                        <span v-if="resumen.origen === 'DEMO'"> · Datos de demostración</span>
                    </p>
                </details>
            </section>

            <p v-if="resumen.origen === 'DEMO'" role="note"
                class="mb-5 rounded-md border border-amber-300 bg-amber-50 p-4">
                Datos de demostración. No representan una cuenta real.
            </p>

            <section id="vencimientos" aria-labelledby="due-dates-title" class="mb-8 scroll-mt-24">
                <h2 id="due-dates-title" class="mb-3 text-xl font-semibold">Vencimientos</h2>
                <p v-if="cuenta.vencimientosCargando" role="status">Cargando vencimientos…</p>
                <div v-else-if="cuenta.vencimientosError" class="mb-3 rounded-md border border-red-200 bg-red-50 p-4">
                    <p role="alert" class="m-0 mb-2">{{ cuenta.vencimientosError }}</p>
                    <button type="button" class="box-border min-h-[44px] min-w-[44px] cursor-pointer rounded-md border border-solid border-red-300 bg-white px-3 py-2 font-[inherit] text-sm font-semibold text-red-900 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                        @click="refreshAccount()">Actualizar vencimientos</button>
                </div>
                <template v-else-if="cuenta.vencimientos && 'items' in cuenta.vencimientos">
                    <p v-if="vencimientos.length === 0 && cuenta.vencimientos.cobertura === 'COMPLETA'"
                        role="status" class="text-slate-600">
                        No hay vencimientos pendientes.
                    </p>
                    <p v-else-if="vencimientos.length === 0" role="status" class="text-slate-600">
                        No se pueden determinar todos los vencimientos porque la cobertura es incompleta.
                    </p>
                    <ul v-else class="m-0 grid list-none gap-3 p-0">
                        <li v-for="due in vencimientos" :key="due.movimientoId"
                            class="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                            :class="dueClasses(due)">
                            <div>
                                <p class="m-0 font-semibold">
                                    {{ dueLabel(due) }}
                                    <span v-if="due.plazoDias" class="ml-2 inline-flex rounded-full border border-current px-2 py-0.5 text-xs">
                                        Plazo {{ due.plazoDias }} días
                                    </span>
                                </p>
                                <p class="m-0 mt-1 text-sm">Vence: {{ formatCivilDate(due.venceEl) }}</p>
                            </div>
                            <p class="m-0 font-semibold">
                                {{ formatUsd(due.pendiente) }}
                                <span v-if="due.origen === 'DEMO'" class="ml-1 text-xs font-normal">(demo)</span>
                            </p>
                        </li>
                    </ul>
                    <button v-if="cuenta.vencimientos.siguienteCursor" type="button"
                        class="box-border mt-3 min-h-[44px] min-w-[44px] cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-4 py-2 font-[inherit] text-sm font-semibold text-[#0B2438] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                        :disabled="cuenta.vencimientosMasCargando" @click="cuenta.loadMoreVencimientos()">
                        {{ cuenta.vencimientosMasCargando ? 'Cargando…' : 'Ver más vencimientos' }}
                    </button>
                </template>
            </section>

            <section id="movimientos" aria-labelledby="movements-title" class="scroll-mt-24">
                <h2 id="movements-title" class="mb-3 text-xl font-semibold">Movimientos</h2>
                <div class="mb-4 grid gap-3 sm:grid-cols-2">
                    <article class="rounded-lg border border-slate-200 bg-white p-4">
                        <h3 class="m-0 mb-2 text-sm font-medium text-slate-600">Total de cargos (USD)</h3>
                        <p class="m-0 text-xl font-semibold">{{ formatUsd(movementTotals?.cargos) }}</p>
                    </article>
                    <article class="rounded-lg border border-slate-200 bg-white p-4">
                        <h3 class="m-0 mb-2 text-sm font-medium text-slate-600">Total de abonos (USD)</h3>
                        <p class="m-0 text-xl font-semibold">{{ formatUsd(movementTotals?.abonos) }}</p>
                    </article>
                </div>
                <p v-if="totalsNote" class="m-0 mb-3 text-xs text-slate-500">{{ totalsNote }}</p>
                <p v-if="cuenta.movimientosCargando" role="status">Cargando movimientos…</p>
                <div v-else-if="cuenta.movimientosError" class="mb-3 rounded-md border border-red-200 bg-red-50 p-4">
                    <p role="alert" class="m-0 mb-2">{{ cuenta.movimientosError }}</p>
                    <button type="button" class="box-border min-h-[44px] min-w-[44px] cursor-pointer rounded-md border border-solid border-red-300 bg-white px-3 py-2 font-[inherit] text-sm font-semibold text-red-900 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                        @click="refreshAccount()">Actualizar movimientos</button>
                </div>
                <template v-else-if="cuenta.movimientos && 'items' in cuenta.movimientos">
                    <p v-if="movimientos.length === 0" role="status" class="text-slate-600">
                        {{ emptyMessage(cuenta.movimientos.cobertura) }}
                    </p>
                    <div v-else class="overflow-x-auto rounded-lg border border-slate-200"
                        role="region" aria-label="Tabla de movimientos; desplazamiento horizontal disponible" tabindex="0">
                        <table class="w-full min-w-[760px] border-collapse text-left">
                            <caption class="p-3 text-left text-sm text-slate-600">
                                Movimientos en USD · {{ coverageMessage(cuenta.movimientos.cobertura) }}
                            </caption>
                            <thead>
                                <tr>
                                    <th scope="col" class="bg-slate-50 p-3">Fecha</th>
                                    <th scope="col" class="bg-slate-50 p-3">Concepto</th>
                                    <th scope="col" class="bg-slate-50 p-3">Tipo</th>
                                    <th scope="col" class="bg-slate-50 p-3">Importe</th>
                                    <th scope="col" class="bg-slate-50 p-3">Vencimiento</th>
                                    <th scope="col" class="bg-slate-50 p-3">Saldo resultante</th>
                                    <th scope="col" class="bg-slate-50 p-3">Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="movement in movimientos" :key="movement.id"
                                    :class="movement.estado === 'ANULADO' ? 'text-slate-500' : ''">
                                    <td class="border-t border-slate-200 p-3">{{ formatInstant(movement.fechaOperacion) }}</td>
                                    <td class="border-t border-slate-200 p-3">
                                        {{ movement.concepto }}
                                        <span v-if="movement.origen === 'DEMO'" class="block text-xs">(demo)</span>
                                    </td>
                                    <td class="border-t border-slate-200 p-3">{{ movement.tipo === 'CARGO' ? 'Cargo' : 'Abono' }}</td>
                                    <td class="border-t border-slate-200 p-3 font-medium">
                                        {{ formatUsd(movement.importe) }}
                                    </td>
                                    <td class="border-t border-slate-200 p-3">
                                        {{ movement.venceEl ? formatCivilDate(movement.venceEl) : '—' }}
                                        <span v-if="movement.plazoDias" class="block text-xs">Plazo {{ movement.plazoDias }} días</span>
                                    </td>
                                    <td class="border-t border-slate-200 p-3">{{ formatUsd(movement.saldoResultante) }}</td>
                                    <td class="border-t border-slate-200 p-3">
                                        <span
                                            class="box-border inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                                            :class="movement.estado === 'VIGENTE'
                                                ? STATE_BADGE_TONES.positive.badgeClasses
                                                : STATE_BADGE_TONES.danger.badgeClasses"
                                        >
                                            <span
                                                aria-hidden="true"
                                                class="h-1.5 w-1.5 shrink-0 rounded-full"
                                                :class="movement.estado === 'VIGENTE'
                                                    ? STATE_BADGE_TONES.positive.dotClasses
                                                    : STATE_BADGE_TONES.danger.dotClasses"
                                            />
                                            {{ movement.estado === 'VIGENTE' ? 'Vigente' : 'Anulado' }}
                                        </span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <button v-if="cuenta.movimientos.siguienteCursor" type="button"
                        class="box-border mt-3 min-h-[44px] min-w-[44px] cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-4 py-2 font-[inherit] text-sm font-semibold text-[#0B2438] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                        :disabled="cuenta.movimientosMasCargando" @click="cuenta.loadMoreMovimientos()">
                        {{ cuenta.movimientosMasCargando ? 'Cargando…' : 'Ver más movimientos' }}
                    </button>
                </template>
            </section>

            <section aria-labelledby="payments-title" class="mt-8">
                <h2 id="payments-title" class="mb-3 text-xl font-semibold">Pagos y comprobantes</h2>
                <div id="comprobantes" class="scroll-mt-24">
                    <PaymentReceipts v-if="auth.user?.tipo_cliente === 'EMPRESA'"
                        :path="accountReceiptsPath" mode="cuenta" @updated="handleReceiptsUpdated" />
                </div>
                <div id="declarar-pago" class="scroll-mt-24">
                    <PaymentDeclarationForm :refresh-version="receiptRefreshVersion" @declared="handlePaymentDeclared" />
                </div>
                <div id="historial-pagos" class="scroll-mt-24">
                    <PaymentHistory :refresh-version="paymentHistoryVersion" />
                </div>
            </section>
        </template>
    </section>
</template>
