<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useCuentaCorrienteStore } from '@/stores/cuentaCorriente'
import type { CuentaCorrienteVencimiento } from '@/types/cuentaCorriente'
import {
    coverageMessage,
    formatCivilDate,
    formatInstant,
    formatUsd,
} from '@/utils/cuentaCorriente'

const auth = useAuthStore()
const cuenta = useCuentaCorrienteStore()
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
const demoDataBlocked = computed(() => !import.meta.env.DEV && (
    resumen.value?.origen === 'DEMO' ||
    movimientos.value.some(item => item.origen === 'DEMO') ||
    vencimientos.value.some(item => item.origen === 'DEMO')
))

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

function emptyMessage(coverage: string): string {
    return coverage === 'COMPLETA'
        ? 'No hay movimientos registrados en esta cuenta.'
        : 'No hay movimientos suficientes para mostrar un historial completo.'
}

onMounted(() => void cuenta.load())
watch(() => auth.sessionVersion, () => void cuenta.load())
onBeforeRouteLeave(() => cuenta.clear())
</script>

<template>
    <section aria-labelledby="current-account-title" class="min-w-0 text-[#0b2438]">
        <header class="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
                <h1 id="current-account-title" class="m-0 mb-2 text-[28px] font-semibold">Cuenta corriente</h1>
                <p class="m-0 leading-6 text-slate-600">Saldo, límite de crédito y movimientos de tu cuenta.</p>
            </div>
            <button type="button" class="min-h-11 rounded-md border border-slate-300 px-4 py-2 hover:bg-slate-50"
                :disabled="cuenta.consultaCargando" @click="cuenta.load()">
                {{ cuenta.consultaCargando ? 'Actualizando…' : 'Actualizar' }}
            </button>
        </header>

        <p v-if="cuenta.consultaCargando" role="status" class="rounded-md bg-slate-50 p-4">
            Consultando la cuenta corriente…
        </p>
        <div v-else-if="cuenta.consultaError" class="rounded-md border border-red-200 bg-red-50 p-4">
            <p role="alert" class="m-0 mb-3">{{ cuenta.consultaError }}</p>
            <button type="button" class="min-h-11 rounded-md border border-red-300 px-4 py-2"
                @click="cuenta.load()">Reintentar</button>
        </div>
        <p v-else-if="cuenta.consulta?.estado === 'SIN_CUENTA'" role="status"
            class="rounded-md border border-slate-200 bg-slate-50 p-4">
            No tenés una cuenta corriente asociada.
        </p>
        <p v-else-if="demoDataBlocked" role="alert"
            class="rounded-md border border-amber-300 bg-amber-50 p-4">
            Se recibió información de demostración y no se mostrará fuera del entorno de pruebas.
        </p>

        <template v-else-if="resumen && !demoDataBlocked">
            <p v-if="resumen.estado === 'INHABILITADA'" role="status"
                class="mb-5 rounded-md border border-amber-300 bg-amber-50 p-4">
                La cuenta está inhabilitada. Podés consultar el saldo acreditado y su historial, pero no operar a crédito.
            </p>

            <p v-if="resumen.origen === 'DEMO'" role="note"
                class="mb-5 rounded-md border border-amber-300 bg-amber-50 p-4">
                Datos de demostración. No representan una cuenta real.
            </p>

            <section aria-label="Resumen de la cuenta" class="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <article class="rounded-lg border border-slate-200 bg-white p-4">
                    <h2 class="m-0 mb-2 text-sm font-medium text-slate-600">Saldo actual (USD)</h2>
                    <p class="m-0 text-xl font-semibold">{{ formatUsd(resumen.saldo) }}</p>
                </article>
                <article class="rounded-lg border border-slate-200 bg-white p-4">
                    <h2 class="m-0 mb-2 text-sm font-medium text-slate-600">Límite de crédito (USD)</h2>
                    <p class="m-0 text-xl font-semibold">{{ formatUsd(resumen.limite) }}</p>
                </article>
                <article class="rounded-lg border border-slate-200 bg-white p-4">
                    <h2 class="m-0 mb-2 text-sm font-medium text-slate-600">Crédito utilizado (USD)</h2>
                    <p class="m-0 text-xl font-semibold">{{ formatUsd(resumen.utilizado) }}</p>
                </article>
                <article class="rounded-lg border border-slate-200 bg-white p-4">
                    <h2 class="m-0 mb-2 text-sm font-medium text-slate-600">Crédito disponible (USD)</h2>
                    <p class="m-0 text-xl font-semibold">{{ formatUsd(resumen.disponible) }}</p>
                </article>
            </section>

            <p class="mb-5 text-sm text-slate-600">
                {{ coverageMessage(resumen.cobertura) }}
                <span v-if="resumen.plazoDias">Plazo actual: {{ resumen.plazoDias }} días.</span>
                Corte: {{ formatInstant(resumen.corte) }}.
            </p>

            <section aria-labelledby="due-dates-title" class="mb-8">
                <h2 id="due-dates-title" class="mb-3 text-xl font-semibold">Vencimientos</h2>
                <p v-if="cuenta.vencimientosCargando" role="status">Cargando vencimientos…</p>
                <div v-else-if="cuenta.vencimientosError" class="mb-3 rounded-md border border-red-200 bg-red-50 p-4">
                    <p role="alert" class="m-0 mb-2">{{ cuenta.vencimientosError }}</p>
                    <button type="button" class="min-h-11 rounded-md border border-red-300 px-3 py-2"
                        @click="cuenta.load()">Actualizar vencimientos</button>
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
                        class="mt-3 min-h-11 rounded-md border border-slate-300 px-4 py-2 disabled:opacity-60"
                        :disabled="cuenta.vencimientosMasCargando" @click="cuenta.loadMoreVencimientos()">
                        {{ cuenta.vencimientosMasCargando ? 'Cargando…' : 'Ver más vencimientos' }}
                    </button>
                </template>
            </section>

            <section aria-labelledby="movements-title">
                <h2 id="movements-title" class="mb-3 text-xl font-semibold">Movimientos</h2>
                <p v-if="cuenta.movimientosCargando" role="status">Cargando movimientos…</p>
                <div v-else-if="cuenta.movimientosError" class="mb-3 rounded-md border border-red-200 bg-red-50 p-4">
                    <p role="alert" class="m-0 mb-2">{{ cuenta.movimientosError }}</p>
                    <button type="button" class="min-h-11 rounded-md border border-red-300 px-3 py-2"
                        @click="cuenta.load()">Actualizar movimientos</button>
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
                                        {{ movement.tipo === 'CARGO' ? '− ' : '+ ' }}{{ formatUsd(movement.importe) }}
                                    </td>
                                    <td class="border-t border-slate-200 p-3">
                                        {{ movement.venceEl ? formatCivilDate(movement.venceEl) : '—' }}
                                        <span v-if="movement.plazoDias" class="block text-xs">Plazo {{ movement.plazoDias }} días</span>
                                    </td>
                                    <td class="border-t border-slate-200 p-3">{{ formatUsd(movement.saldoResultante) }}</td>
                                    <td class="border-t border-slate-200 p-3">{{ movement.estado === 'VIGENTE' ? 'Vigente' : 'Anulado' }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <button v-if="cuenta.movimientos.siguienteCursor" type="button"
                        class="mt-3 min-h-11 rounded-md border border-slate-300 px-4 py-2 disabled:opacity-60"
                        :disabled="cuenta.movimientosMasCargando" @click="cuenta.loadMoreMovimientos()">
                        {{ cuenta.movimientosMasCargando ? 'Cargando…' : 'Ver más movimientos' }}
                    </button>
                </template>
            </section>
        </template>
    </section>
</template>
