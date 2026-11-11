<script setup lang="ts">
import { onMounted, ref } from 'vue'
import axios from 'axios'
import AdminPriceListsPanel from './AdminPriceListsPanel.vue'
import {
    getAdminClients,
    getAdminClientPriceLists,
    saveAdminClientPriceList,
    updateAdminCompanyApproval,
} from '@/services/adminClientService'
import type {
    AdminClient,
    AdminClientPriceList,
    AdminPriceListOption,
    CompanyApprovalStatus,
} from '@/types/adminClient'

const clients = ref<AdminClient[]>([])
const isLoading = ref(true)
const errorMessage = ref<string | null>(null)
const priceLists = ref<AdminPriceListOption[]>([])
const assignments = ref<Record<number, AdminClientPriceList | null>>({})
const selections = ref<Record<number, number | ''>>({})
const feedback = ref<Record<number, { text: string; error: boolean }>>({})
const approvalFeedback = ref<Record<number, { text: string; error: boolean }>>({})
const updatingApprovalClientId = ref<number | null>(null)
const priceListsLoading = ref(true)
const priceListsError = ref<string | null>(null)
const savingClientId = ref<number | null>(null)
const managingPriceLists = ref(false)

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
})

function formatDate(value: string): string {
    const date = new Date(value)

    return Number.isNaN(date.getTime())
        ? 'Fecha no disponible'
        : dateFormatter.format(date)
}

async function loadPriceLists() {
    priceListsLoading.value = true
    try {
        const data = await getAdminClientPriceLists()
        priceLists.value = data.listas
        assignments.value = Object.fromEntries(data.asignaciones.map(item => [item.idCliente, item]))
        selections.value = Object.fromEntries(data.asignaciones.map(item => [item.idCliente, item.idListaPrecio]))
        feedback.value = {}
        priceListsError.value = null
    } catch {
        priceListsError.value = 'No pudimos consultar las listas y asignaciones. Volvé a cargar para continuar.'
    } finally {
        priceListsLoading.value = false
    }
}

function hasAvailableList(id: number) {
    return priceLists.value.some(list => list.id === id)
}

function selectedList(id: number) {
    return selections.value[id] || null
}

function canSavePriceList(id: number) {
    const selected = selectedList(id)
    return savingClientId.value === null && !managingPriceLists.value && !priceListsLoading.value && !priceListsError.value &&
        selected !== (assignments.value[id]?.idListaPrecio ?? null) &&
        (selected === null || hasAvailableList(selected))
}

async function savePriceList(id: number) {
    if (!canSavePriceList(id)) return
    savingClientId.value = id
    delete feedback.value[id]
    delete approvalFeedback.value[id]
    try {
        const list = await saveAdminClientPriceList(id, selectedList(id))
        assignments.value[id] = list
        selections.value[id] = list?.idListaPrecio ?? ''
        feedback.value[id] = { text: list ? 'Lista asignada.' : 'Asignación retirada.', error: false }
    } catch (error: unknown) {
        const response = axios.isAxiosError<{ message?: string }>(error) ? error.response : undefined
        if (!response || response.status >= 500) {
            priceListsError.value = 'No pudimos confirmar el cambio. Volvé a cargar las asignaciones para ver el resultado.'
        } else {
            feedback.value[id] = { text: response.data?.message ?? 'No se pudo guardar la asignación.', error: true }
        }
    } finally {
        savingClientId.value = null
    }
}

async function setCompanyApproval(client: AdminClient, newStatus: CompanyApprovalStatus) {
    if (
        updatingApprovalClientId.value !== null ||
        client.tipoCliente !== 'EMPRESA' ||
        client.estadoAprobacionEmpresa === newStatus
    ) return
    updatingApprovalClientId.value = client.id
    delete approvalFeedback.value[client.id]
    delete feedback.value[client.id]
    try {
        const updated = await updateAdminCompanyApproval(client.id, newStatus)
        client.estadoAprobacionEmpresa = updated.estadoAprobacionEmpresa ?? newStatus
        approvalFeedback.value[client.id] = {
            text: newStatus === 'APROBADA' ? 'Empresa aprobada.' : 'Empresa rechazada.',
            error: false,
        }
    } catch (error: unknown) {
        const response = axios.isAxiosError<{ message?: string }>(error) ? error.response : undefined
        if (!response || response.status >= 500) {
            approvalFeedback.value[client.id] = {
                text: 'No se pudo actualizar el estado de la empresa.',
                error: true,
            }
        } else {
            approvalFeedback.value[client.id] = {
                text: response.data?.message ?? 'No se pudo actualizar el estado de la empresa.',
                error: true,
            }
        }
    } finally {
        updatingApprovalClientId.value = null
    }
}

async function loadClients(): Promise<void> {
    isLoading.value = true
    errorMessage.value = null

    try {
        clients.value = await getAdminClients()
    } catch (error: unknown) {
        const status = axios.isAxiosError(error)
            ? error.response?.status
            : undefined

        errorMessage.value =
            status === 401 || status === 403
                ? 'No se pudo acceder al listado con la sesión actual.'
                : 'No pudimos cargar los clientes. Intentá nuevamente.'
    } finally {
        isLoading.value = false
    }
}

onMounted(() => {
    void loadClients()
    void loadPriceLists()
})
</script>

<template>
    <section class="min-w-0 text-[#0b2438]" aria-labelledby="clients-title">
        <header class="mb-6">
            <h1 id="clients-title" class="m-0 mb-3 text-[28px] font-semibold">Clientes</h1>
            <p class="m-0 leading-6 text-slate-600">Listado de clientes particulares y empresas registrados.</p>
        </header>

        <AdminPriceListsPanel :disabled="savingClientId !== null" @changed="loadPriceLists" @busy="managingPriceLists = $event" />

        <p v-if="isLoading" role="status" class="text-slate-600">Cargando clientes…</p>

        <div v-else-if="errorMessage" class="rounded-lg border border-slate-200 bg-slate-50 p-5">
            <p class="m-0 mb-4 leading-6" role="alert">{{ errorMessage }}</p>
            <button class="min-h-11 rounded-md border-0 bg-[#145a8d] px-5 py-2 font-bold text-white hover:bg-[#103a5c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]" type="button" @click="loadClients">
                Reintentar
            </button>
        </div>

        <p v-else-if="clients.length === 0" class="text-slate-600" role="status">
            Todavía no hay clientes registrados.
        </p>

        <div
            v-else
            class="overflow-x-auto rounded-lg border border-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
            role="region"
            aria-label="Listado de clientes; desplazamiento horizontal disponible"
            tabindex="0"
        >
            <p v-if="priceListsLoading" role="status" class="px-4 text-slate-600">Cargando listas de precios…</p>
            <div v-else-if="priceListsError" class="p-4">
                <p role="alert" class="mb-2">{{ priceListsError }}</p>
                <button type="button" class="min-h-11 rounded-md border border-slate-300 px-3" @click="loadPriceLists">
                    Recargar listas y asignaciones
                </button>
            </div>
            <table class="w-full min-w-[950px] border-collapse text-left">
                <caption class="p-4 text-left font-bold">
                    Clientes registrados: {{ clients.length }}
                </caption>
                <thead>
                    <tr>
                        <th class="bg-[#f4f7fa] p-4 text-left align-top leading-6" scope="col">Nombre o razón social</th>
                        <th class="bg-[#f4f7fa] p-4 text-left align-top leading-6" scope="col">Tipo</th>
                        <th class="bg-[#f4f7fa] p-4 text-left align-top leading-6" scope="col">Email</th>
                        <th class="bg-[#f4f7fa] p-4 text-left align-top leading-6" scope="col">Fecha de registro</th>
                        <th class="bg-[#f4f7fa] p-4 text-left align-top leading-6" scope="col">Estado de empresa</th>
                        <th class="bg-[#f4f7fa] p-4 text-left align-top leading-6" scope="col">Lista de precios</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="client in clients" :key="client.id">
                        <td class="break-words border-b border-slate-200 p-4 align-top leading-6">
                            <span class="font-medium">{{ client.nombreRazonSocial }}</span>
                            <span v-if="client.cuit" class="block text-xs text-slate-500">CUIT: {{ client.cuit }}</span>
                        </td>
                        <td class="border-b border-slate-200 p-4 align-top leading-6">
                            <span
                                class="inline-block rounded px-2 py-0.5 text-xs font-semibold"
                                :class="client.tipoCliente === 'EMPRESA' ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-700'"
                            >
                                {{ client.tipoCliente === 'EMPRESA' ? 'Empresa' : 'Particular' }}
                            </span>
                        </td>
                        <td class="break-words border-b border-slate-200 p-4 align-top leading-6">{{ client.email }}</td>
                        <td class="break-words border-b border-slate-200 p-4 align-top leading-6">{{ formatDate(client.fechaRegistro) }}</td>
                        <td class="border-b border-slate-200 p-4 align-top leading-6">
                            <div v-if="client.tipoCliente === 'EMPRESA'" class="flex flex-col gap-2">
                                <span
                                    class="inline-block w-fit rounded px-2 py-0.5 text-xs font-semibold"
                                    :class="{
                                        'bg-emerald-100 text-emerald-800': client.estadoAprobacionEmpresa === 'APROBADA',
                                        'bg-rose-100 text-rose-800': client.estadoAprobacionEmpresa === 'RECHAZADA',
                                        'bg-amber-100 text-amber-800': client.estadoAprobacionEmpresa === 'PENDIENTE' || !client.estadoAprobacionEmpresa,
                                    }"
                                >
                                    {{ client.estadoAprobacionEmpresa === 'APROBADA' ? 'Aprobada' : client.estadoAprobacionEmpresa === 'RECHAZADA' ? 'Rechazada' : 'Pendiente' }}
                                </span>
                                <div class="flex flex-wrap gap-1">
                                    <button
                                        type="button"
                                        :disabled="updatingApprovalClientId !== null || client.estadoAprobacionEmpresa === 'APROBADA'"
                                        class="rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                                        :aria-label="`Aprobar cuenta empresa de ${client.nombreRazonSocial}`"
                                        @click="setCompanyApproval(client, 'APROBADA')"
                                    >
                                        {{ updatingApprovalClientId === client.id ? '…' : 'Aprobar' }}
                                    </button>
                                    <button
                                        type="button"
                                        :disabled="updatingApprovalClientId !== null || client.estadoAprobacionEmpresa === 'RECHAZADA'"
                                        class="rounded bg-rose-600 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
                                        :aria-label="`Rechazar cuenta empresa de ${client.nombreRazonSocial}`"
                                        @click="setCompanyApproval(client, 'RECHAZADA')"
                                    >
                                        {{ updatingApprovalClientId === client.id ? '…' : 'Rechazar' }}
                                    </button>
                                </div>
                                <p
                                    v-if="approvalFeedback[client.id]"
                                    class="m-0 text-xs"
                                    :class="approvalFeedback[client.id]!.error ? 'text-rose-600' : 'text-emerald-700'"
                                    :role="approvalFeedback[client.id]!.error ? 'alert' : 'status'"
                                >
                                    {{ approvalFeedback[client.id]!.text }}
                                </p>
                            </div>
                            <span v-else class="text-slate-400">—</span>
                        </td>
                        <td class="min-w-64 border-b border-slate-200 p-4 align-top">
                            <div v-if="!priceListsLoading && !priceListsError">
                                <p class="mb-2 text-sm text-slate-600">
                                    {{ assignments[client.id]?.nombre ?? 'Sin lista asignada' }}
                                    <span v-if="assignments[client.id]?.activa === false">(inactiva)</span>
                                </p>
                                <div class="flex flex-wrap gap-2">
                                    <select
                                        :value="selections[client.id] ?? ''"
                                        :aria-label="`Lista de precios de ${client.nombreRazonSocial}`"
                                        :disabled="savingClientId !== null || managingPriceLists"
                                        class="min-h-11 min-w-0 rounded-md border border-slate-300 px-2"
                                        @change="selections[client.id] = Number(($event.target as HTMLSelectElement).value) || ''"
                                    >
                                        <option value="">Sin lista</option>
                                        <option v-for="list in priceLists" :key="list.id" :value="list.id">
                                            {{ list.nombre }} ({{ list.porcentajeDescuento }} %)
                                        </option>
                                        <option
                                            v-if="assignments[client.id] && !hasAvailableList(assignments[client.id]!.idListaPrecio)"
                                            :value="assignments[client.id]!.idListaPrecio"
                                            disabled
                                        >
                                            {{ assignments[client.id]!.nombre }} (no disponible)
                                        </option>
                                    </select>
                                    <button
                                        type="button"
                                        :disabled="!canSavePriceList(client.id)"
                                        class="min-h-11 rounded-md border-0 bg-[#145a8d] px-3 font-bold text-white disabled:opacity-50"
                                        @click="savePriceList(client.id)"
                                    >
                                        {{ savingClientId === client.id ? 'Guardando…' : 'Guardar lista' }}
                                    </button>
                                </div>
                                <p v-if="feedback[client.id]" class="mt-2 text-sm" :role="feedback[client.id]!.error ? 'alert' : 'status'">
                                    {{ feedback[client.id]!.text }}
                                </p>
                            </div>
                            <span v-else class="text-slate-600">—</span>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </section>
</template>