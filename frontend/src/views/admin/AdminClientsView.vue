<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useAdminClientCredit } from '@/composables/useAdminClientCredit'
import AdminClientCreditStatus from '@/components/AdminClientCreditStatus.vue'
import AdminClientStatusDialog from '@/components/AdminClientStatusDialog.vue'
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


// Clases compartidas por los controles de esta vista; no modifica estilos globales.
const clientButtonClass = "box-border min-h-11 min-w-11 cursor-pointer rounded-lg border border-solid border-[#cbd5e1] bg-white px-3 py-2.5 [font-family:inherit] text-sm font-semibold leading-5 text-[#103a5c] enabled:hover:bg-[#f1f5f9] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[3px] focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-50"
const companyBadgeClass = "box-border inline-flex w-44 min-h-7 items-center justify-center gap-[7px] whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold leading-5 before:size-1.5 before:shrink-0 before:rounded-full before:bg-current before:content-['']"

const auth = useAuthStore()
const allowed = () => auth.rol === 'ADMIN' && !auth.loggingIn && !auth.loggingOut
const identity = () => [auth.user?.id, auth.rol, auth.sessionVersion].join(':')
let generation = 0
let active = true
const isCurrent = (token: number) => active && generation === token && allowed()
onBeforeUnmount(() => { active = false; generation++ })
const clients = ref<AdminClient[]>([])
const credit = useAdminClientCredit(() => clients.value)
const selectedClientId = ref<number | null>(null)
const approvalTarget = ref<CompanyApprovalStatus | null>(null)
const selectedClient = computed(() => clients.value.find(client => client.id === selectedClientId.value) ?? null)
function openClient(client: AdminClient, target: CompanyApprovalStatus | null = null) {
    if (!allowed()) return
    selectedClientId.value = client.id
    approvalTarget.value = target
}
function closeClient() {
    if (updatingApprovalClientId.value !== null || reconcilingApprovalClientId.value !== null) return
    selectedClientId.value = null
    approvalTarget.value = null
}
function confirmApproval() {
    if (selectedClient.value && approvalTarget.value) {
        return setCompanyApproval(selectedClient.value, approvalTarget.value)
    }
}
const isLoading = ref(true)
const errorMessage = ref<string | null>(null)
const priceLists = ref<AdminPriceListOption[]>([])
const assignments = ref<Record<number, AdminClientPriceList | null>>({})
const selections = ref<Record<number, number | ''>>({})
const feedback = ref<Record<number, { text: string; error: boolean }>>({})
const approvalFeedback = ref<Record<number, { text: string; error: boolean }>>({})
const updatingApprovalClientId = ref<number | null>(null)
const uncertainApprovalClientIds = ref<Record<number, boolean>>({})
const reconcilingApprovalClientId = ref<number | null>(null)
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
    if (!allowed()) return
    const token = generation
    priceListsLoading.value = true
    try {
        const data = await getAdminClientPriceLists()
        if (!isCurrent(token)) return
        priceLists.value = data.listas
        assignments.value = Object.fromEntries(data.asignaciones.map(item => [item.idCliente, item]))
        selections.value = Object.fromEntries(data.asignaciones.map(item => [item.idCliente, item.idListaPrecio]))
        feedback.value = {}
        priceListsError.value = null
    } catch {
        if (!isCurrent(token)) return
        priceListsError.value = 'No pudimos consultar las listas y asignaciones. Volvé a cargar para continuar.'
    } finally {
        if (isCurrent(token)) priceListsLoading.value = false
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
    return allowed() && savingClientId.value === null && !managingPriceLists.value && !priceListsLoading.value && !priceListsError.value &&
        selected !== (assignments.value[id]?.idListaPrecio ?? null) &&
        (selected === null || hasAvailableList(selected))
}

async function savePriceList(id: number) {
    if (!canSavePriceList(id)) return
    const token = generation
    savingClientId.value = id
    delete feedback.value[id]
    delete approvalFeedback.value[id]
    try {
        const list = await saveAdminClientPriceList(id, selectedList(id))
        if (!isCurrent(token)) return
        assignments.value[id] = list
        selections.value[id] = list?.idListaPrecio ?? ''
        feedback.value[id] = { text: list ? 'Lista asignada.' : 'Asignación retirada.', error: false }
    } catch (error: unknown) {
        if (!isCurrent(token)) return
        const response = axios.isAxiosError<{ message?: string }>(error) ? error.response : undefined
        if (!response || response.status >= 500) {
            priceListsError.value = 'No pudimos confirmar el cambio. Volvé a cargar las asignaciones para ver el resultado.'
        } else {
            feedback.value[id] = { text: response.data?.message ?? 'No se pudo guardar la asignación.', error: true }
        }
    } finally {
        if (isCurrent(token)) savingClientId.value = null
    }
}

async function reconcileCompanyApproval(clientId: number): Promise<void> {
    if (!allowed() || reconcilingApprovalClientId.value !== null) return
    const token = generation
    reconcilingApprovalClientId.value = clientId
    try {
        const freshClients = await getAdminClients()
        if (!isCurrent(token)) return
        const fresh = freshClients.find(c => c.id === clientId)
        const current = clients.value.find(c => c.id === clientId)
        if (!fresh || !current || fresh.tipoCliente !== 'EMPRESA' || !['APROBADA', 'RECHAZADA', 'PENDIENTE'].includes(fresh.estadoAprobacionEmpresa ?? '')) throw new Error('El cliente ya no está disponible en el listado.')
        if (fresh && current) {
            current.estadoAprobacionEmpresa = fresh.estadoAprobacionEmpresa
            current.nombreRazonSocial = fresh.nombreRazonSocial
            current.tipoCliente = fresh.tipoCliente
            current.cuit = fresh.cuit
            current.docCliente = fresh.docCliente
            current.email = fresh.email
            current.fechaRegistro = fresh.fechaRegistro
        }
        delete uncertainApprovalClientIds.value[clientId]
        approvalFeedback.value[clientId] = {
            text: 'Estado verificado con el servidor.',
            error: false,
        }
    } catch {
        if (!isCurrent(token)) return
        uncertainApprovalClientIds.value[clientId] = true
        approvalFeedback.value[clientId] = {
            text: 'No pudimos verificar el estado con el servidor. El resultado es incierto.',
            error: true,
        }
    } finally {
        if (isCurrent(token)) reconcilingApprovalClientId.value = null
    }
}

async function setCompanyApproval(client: AdminClient, newStatus: CompanyApprovalStatus) {
    if (
        !allowed() ||
        updatingApprovalClientId.value !== null ||
        reconcilingApprovalClientId.value !== null ||
        uncertainApprovalClientIds.value[client.id] ||
        client.tipoCliente !== 'EMPRESA' ||
        client.estadoAprobacionEmpresa === newStatus
    ) return
    const token = generation
    updatingApprovalClientId.value = client.id
    delete approvalFeedback.value[client.id]
    delete feedback.value[client.id]
    try {
        const updated = await updateAdminCompanyApproval(client.id, newStatus)
        if (!isCurrent(token)) return
        if (updated.estadoAprobacionEmpresa !== newStatus || updated.id !== client.id) throw new Error('Respuesta de aprobación incompleta.')
        client.estadoAprobacionEmpresa = updated.estadoAprobacionEmpresa
        delete uncertainApprovalClientIds.value[client.id]
        approvalFeedback.value[client.id] = {
            text: newStatus === 'APROBADA' ? 'Empresa aprobada.' : 'Empresa rechazada.',
            error: false,
        }
    } catch (error: unknown) {
        if (!isCurrent(token)) return
        const response = axios.isAxiosError<{ message?: string }>(error) ? error.response : undefined
        if (!response || response.status >= 500) {
            uncertainApprovalClientIds.value[client.id] = true
            approvalFeedback.value[client.id] = {
                text: 'No pudimos confirmar el cambio en el servidor. Verificando estado actual…',
                error: true,
            }
            await reconcileCompanyApproval(client.id)
        } else {
            delete uncertainApprovalClientIds.value[client.id]
            approvalFeedback.value[client.id] = {
                text: response.data?.message ?? 'No se pudo actualizar el estado de la empresa.',
                error: true,
            }
        }
    } finally {
        if (isCurrent(token)) updatingApprovalClientId.value = null
    }
}

async function loadClients(): Promise<void> {
    if (!allowed()) return
    const token = generation
    isLoading.value = true
    errorMessage.value = null

    try {
        const fresh = await getAdminClients()
        if (!isCurrent(token)) return
        clients.value = fresh
        uncertainApprovalClientIds.value = {}
    } catch (error: unknown) {
        if (!isCurrent(token)) return
        const status = axios.isAxiosError(error)
            ? error.response?.status
            : undefined

        errorMessage.value =
            status === 401 || status === 403
                ? 'No se pudo acceder al listado con la sesión actual.'
                : 'No pudimos cargar los clientes. Intentá nuevamente.'
    } finally {
        if (isCurrent(token)) isLoading.value = false
    }
}

watch([identity, allowed], () => {
    generation++
    clients.value = []
    priceLists.value = []
    assignments.value = {}
    selections.value = {}
    feedback.value = {}
    approvalFeedback.value = {}
    uncertainApprovalClientIds.value = {}
    updatingApprovalClientId.value = null
    reconcilingApprovalClientId.value = null
    savingClientId.value = null
    selectedClientId.value = null
    approvalTarget.value = null
    errorMessage.value = null
    priceListsError.value = null
    if (allowed()) {
        void loadClients()
        void loadPriceLists()
    }
}, { immediate: true, flush: 'sync' })
</script>

<template>
    <section v-if="allowed()" class="admin-clients min-w-0 text-sm leading-normal text-[#13293a]" aria-labelledby="clients-title">
        <header class="mb-6">
            <h1 id="clients-title" class="m-0 mb-3 text-[28px] font-semibold leading-[1.3] max-[541px]:text-[26px]">Clientes</h1>
            <p class="m-0 text-sm leading-6 text-[#475569]">Consultá los datos de tus clientes y gestioná su registro empresarial.</p>
        </header>

        <AdminPriceListsPanel class="client-price-lists [&_button]:box-border [&_button]:min-h-11 [&_button]:cursor-pointer [&_button]:rounded-lg [&_button]:border [&_button]:border-solid [&_button]:border-[#cbd5e1] [&_button]:bg-white [&_button]:px-3 [&_button]:py-2.5 [&_button]:[font-family:inherit] [&_button]:text-sm [&_button]:font-semibold [&_button]:leading-5 [&_button]:text-[#103a5c] [&_button:enabled:hover]:bg-[#f1f5f9] [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-solid [&_button:focus-visible]:outline-offset-[3px] [&_button:focus-visible]:outline-[#145a8d] [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-50 [&_button[type=submit]]:border-[#145a8d] [&_button[type=submit]]:bg-[#145a8d] [&_button[type=submit]]:text-white [&_button[type=submit]:enabled:hover]:bg-[#103a5c]" :disabled="savingClientId !== null" @changed="loadPriceLists" @busy="managingPriceLists = $event" />

        <p v-if="isLoading" role="status" class="text-slate-600">Cargando clientes…</p>

        <div v-else-if="errorMessage" class="rounded-lg border border-slate-200 bg-slate-50 p-5">
            <p class="m-0 mb-4 leading-6" role="alert">{{ errorMessage }}</p>
            <button :class="clientButtonClass" type="button" @click="loadClients">
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
                <button type="button" :class="clientButtonClass" @click="loadPriceLists">
                    Recargar listas y asignaciones
                </button>
            </div>
            <table class="clients-table w-full min-w-[1370px] border-collapse text-left [&_tbody>tr:last-child>td]:border-b-0 [&_tbody>tr:nth-child(even)]:bg-[#fbfdff]">
                <caption class="px-5 py-4 text-left text-base font-semibold text-[#0b2438]">
                    Clientes registrados: {{ clients.length }}
                </caption>
                <thead>
                    <tr>
                        <th class="border-y border-solid border-x-0 border-[#e2e8f0] bg-[#f8fafc] px-4 py-3.5 text-left align-middle text-xs font-semibold leading-5 whitespace-nowrap text-[#475569]" scope="col">Nombre o razón social</th>
                        <th class="border-y border-solid border-x-0 border-[#e2e8f0] bg-[#f8fafc] px-4 py-3.5 text-left align-middle text-xs font-semibold leading-5 whitespace-nowrap text-[#475569]" scope="col">Tipo</th>
                        <th class="border-y border-solid border-x-0 border-[#e2e8f0] bg-[#f8fafc] px-4 py-3.5 text-left align-middle text-xs font-semibold leading-5 whitespace-nowrap text-[#475569]" scope="col">Email</th>
                        <th class="border-y border-solid border-x-0 border-[#e2e8f0] bg-[#f8fafc] px-4 py-3.5 text-left align-middle text-xs font-semibold leading-5 whitespace-nowrap text-[#475569]" scope="col">Fecha de registro</th>
                        <th class="border-y border-solid border-x-0 border-[#e2e8f0] bg-[#f8fafc] px-4 py-3.5 text-left align-middle text-xs font-semibold leading-5 whitespace-nowrap text-[#475569]" scope="col">Registro empresarial</th>
                        <th class="border-y border-solid border-x-0 border-[#e2e8f0] bg-[#f8fafc] px-4 py-3.5 text-left align-middle text-xs font-semibold leading-5 whitespace-nowrap text-[#475569]" scope="col">Cuenta corriente y crédito</th>
                        <th class="border-y border-solid border-x-0 border-[#e2e8f0] bg-[#f8fafc] px-4 py-3.5 text-left align-middle text-xs font-semibold leading-5 whitespace-nowrap text-[#475569]" scope="col">Consulta</th>
                        <th class="border-y border-solid border-x-0 border-[#e2e8f0] bg-[#f8fafc] px-4 py-3.5 text-left align-middle text-xs font-semibold leading-5 whitespace-nowrap text-[#475569]" scope="col">Lista de precios</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="client in clients" :key="client.id">
                        <td class="border-x-0 border-t-0 border-b border-solid border-[#e2e8f0] p-4 align-top text-sm leading-normal text-[#13293a] min-w-[170px]">
                            <span class="font-medium">{{ client.nombreRazonSocial }}</span>
                            <span v-if="client.cuit" class="block text-xs text-slate-500">CUIT: {{ client.cuit }}</span>
                        </td>
                        <td class="border-x-0 border-t-0 border-b border-solid border-[#e2e8f0] p-4 align-top text-sm leading-normal text-[#13293a] ">
                            <span
                                class="inline-block p-0 text-xs font-normal text-[#64748b]"
                            >
                                {{ client.tipoCliente === 'EMPRESA' ? 'Empresa' : 'Particular' }}
                            </span>
                        </td>
                        <td class="border-x-0 border-t-0 border-b border-solid border-[#e2e8f0] p-4 align-top text-sm leading-normal text-[#13293a] min-w-[180px] [overflow-wrap:anywhere]">{{ client.email }}</td>
                        <td class="border-x-0 border-t-0 border-b border-solid border-[#e2e8f0] p-4 align-top text-sm leading-normal text-[#13293a] whitespace-nowrap !text-[#475569]">{{ formatDate(client.fechaRegistro) }}</td>
                        <td class="border-x-0 border-t-0 border-b border-solid border-[#e2e8f0] p-4 align-top text-sm leading-normal text-[#13293a] min-w-[196px]">
                            <div v-if="client.tipoCliente === 'EMPRESA'" class="flex flex-col gap-2">
                                <span
                                    :class="[companyBadgeClass, 'company-badge', {
                                        'bg-[#dcfce7] text-[#166534]': !uncertainApprovalClientIds[client.id] && client.estadoAprobacionEmpresa === 'APROBADA',
                                        'bg-[#fee2e2] text-[#991b1b]': !uncertainApprovalClientIds[client.id] && client.estadoAprobacionEmpresa === 'RECHAZADA',
                                        'bg-[#fef3c7] text-[#92400e]': uncertainApprovalClientIds[client.id] || client.estadoAprobacionEmpresa === 'PENDIENTE',
                                    }, !uncertainApprovalClientIds[client.id] && !['APROBADA', 'RECHAZADA', 'PENDIENTE'].includes(client.estadoAprobacionEmpresa ?? '') ? 'bg-[#f3f4f6] text-[#475569]' : '']"
                                >
                                    {{ uncertainApprovalClientIds[client.id] ? 'Por verificar' : client.estadoAprobacionEmpresa === 'APROBADA' ? 'Aprobada' : client.estadoAprobacionEmpresa === 'RECHAZADA' ? 'Rechazada' : client.estadoAprobacionEmpresa === 'PENDIENTE' ? 'Pendiente' : 'No informado' }}
                                </span>
                                <div class="approval-actions flex flex-wrap gap-2">
                                    <button
                                        v-if="client.estadoAprobacionEmpresa !== 'APROBADA'"
                                        type="button"
                                        :disabled="updatingApprovalClientId !== null || reconcilingApprovalClientId !== null || !!uncertainApprovalClientIds[client.id]"
                                        :class="[clientButtonClass, 'client-approve w-[88px] shrink-0 enabled:border-[#145a8d] enabled:text-[#103a5c] enabled:hover:bg-[#eff6ff] disabled:border-[#e2e8f0] disabled:bg-[#f3f4f6] disabled:text-[#64748b] disabled:opacity-100']"
                                        :aria-label="`Aprobar cuenta empresa de ${client.nombreRazonSocial}`"
                                        @click="openClient(client, 'APROBADA')"
                                    >
                                        {{ updatingApprovalClientId === client.id ? '…' : 'Aprobar' }}
                                    </button>
                                    <button
                                        v-if="client.estadoAprobacionEmpresa !== 'RECHAZADA'"
                                        type="button"
                                        :disabled="updatingApprovalClientId !== null || reconcilingApprovalClientId !== null || !!uncertainApprovalClientIds[client.id]"
                                        :class="[clientButtonClass, 'client-reject w-[88px] shrink-0 enabled:border-[#fecaca] enabled:text-[#991b1b] enabled:hover:bg-[#fee2e2] disabled:border-[#e2e8f0] disabled:bg-[#f3f4f6] disabled:text-[#64748b] disabled:opacity-100']"
                                        :aria-label="`Rechazar cuenta empresa de ${client.nombreRazonSocial}`"
                                        @click="openClient(client, 'RECHAZADA')"
                                    >
                                        {{ updatingApprovalClientId === client.id ? '…' : 'Rechazar' }}
                                    </button>
                                    <button
                                        v-if="uncertainApprovalClientIds[client.id]"
                                        type="button"
                                        :disabled="reconcilingApprovalClientId === client.id"
                                        :class="clientButtonClass"
                                        :aria-label="`Reintentar verificación de cuenta empresa de ${client.nombreRazonSocial}`"
                                        @click="reconcileCompanyApproval(client.id)"
                                    >
                                        {{ reconcilingApprovalClientId === client.id ? 'Verificando…' : 'Reintentar verificación' }}
                                    </button>
                                </div>
                                <p
                                    v-if="approvalFeedback[client.id]"
                                    class="m-0 mb-2 text-xs"
                                    :class="approvalFeedback[client.id]!.error ? 'text-rose-600' : 'text-emerald-700'"
                                    :role="approvalFeedback[client.id]!.error ? 'alert' : 'status'"
                                >
                                    {{ approvalFeedback[client.id]!.text }}
                                </p>
                            </div>
                            <span v-else class="text-slate-600">No aplica a particulares</span>
                        </td>
                        <td class="border-x-0 border-t-0 border-b border-solid border-[#e2e8f0] p-4 align-top text-sm leading-normal text-[#13293a] min-w-[210px]">
                            <AdminClientCreditStatus compact :company="client.tipoCliente === 'EMPRESA'" :credit="credit.status(client.id)" @retry="credit.refresh(client.id)" />
                        </td>
                        <td class="border-x-0 border-t-0 border-b border-solid border-[#e2e8f0] p-4 align-top text-sm leading-normal text-[#13293a] min-w-[120px]">
                            <button type="button" data-client-detail :class="clientButtonClass"
                                :aria-label="`Ver detalle de ${client.nombreRazonSocial}`" @click="openClient(client)">Ver detalle</button>
                        </td>
                        <td class="border-x-0 border-t-0 border-b border-solid border-[#e2e8f0] p-4 align-top text-sm leading-normal text-[#13293a] min-w-[240px] max-w-[280px]">
                            <div v-if="!priceListsLoading && !priceListsError">
                                <p class="m-0 mb-2 text-sm text-slate-600">
                                    {{ assignments[client.id]?.nombre ?? 'Sin lista asignada' }}
                                    <span v-if="assignments[client.id]?.activa === false">(inactiva)</span>
                                </p>
                                <div class="flex flex-wrap gap-2">
                                    <select
                                        :value="selections[client.id] ?? ''"
                                        :aria-label="`Lista de precios de ${client.nombreRazonSocial}`"
                                        :disabled="savingClientId !== null || managingPriceLists"
                                        class="box-border min-h-11 w-full min-w-0 max-w-full rounded-lg border border-solid border-[#cbd5e1] bg-white px-3 py-2.5 [font-family:inherit] text-sm font-normal leading-5 text-[#103a5c] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[3px] focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-50"
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
                                        :class="clientButtonClass"
                                        @click="savePriceList(client.id)"
                                    >
                                        {{ savingClientId === client.id ? 'Guardando…' : 'Guardar lista' }}
                                    </button>
                                </div>
                                <p v-if="feedback[client.id]" class="m-0 mb-2 text-sm" :role="feedback[client.id]!.error ? 'alert' : 'status'">
                                    {{ feedback[client.id]!.text }}
                                </p>
                            </div>
                            <span v-else class="text-slate-600">—</span>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <AdminClientStatusDialog v-if="selectedClient" :key="selectedClient.id" :client="selectedClient"
            :target="approvalTarget" :credit="credit.status(selectedClient.id)"
            :busy="updatingApprovalClientId !== null || reconcilingApprovalClientId !== null"
            :uncertain="!!uncertainApprovalClientIds[selectedClient.id]" :feedback="approvalFeedback[selectedClient.id]"
            @close="closeClient" @confirm="confirmApproval" @retry="reconcileCompanyApproval(selectedClient.id)" @refresh-credit="credit.refresh(selectedClient.id)" />
    </section>
</template>
