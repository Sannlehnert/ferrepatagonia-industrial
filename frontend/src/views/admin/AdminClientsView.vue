<script setup lang="ts">
import axios from 'axios'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AdminClientCreditStatus from '@/components/AdminClientCreditStatus.vue'
import AdminClientStatusDialog from '@/components/AdminClientStatusDialog.vue'
import { useAdminClientCredit } from '@/composables/useAdminClientCredit'
import AdminPriceListsPanel from './AdminPriceListsPanel.vue'
import {
    getAdminClients,
    getAdminClientPage,
    getAdminClientPriceLists,
    saveAdminClientPriceList,
    updateAdminCompanyApproval,
} from '@/services/adminClientService'
import { isMutationResultUncertain } from '@/services/adminMutationError'
import { useAuthStore } from '@/stores/auth'
import type {
    AdminClient,
    AdminClientPage,
    AdminClientPriceList,
    AdminClientType,
    AdminPriceListOption,
    CompanyApprovalStatus,
} from '@/types/adminClient'

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300
const SEARCH_MAX_LENGTH = 200
const STATUSES: CompanyApprovalStatus[] = ['PENDIENTE', 'APROBADA', 'RECHAZADA']
const APPROVAL_TIMEOUT_MS = 15_000

// Clases compartidas por los controles de esta vista; no modifica estilos globales.
const clientButtonClass = "box-border min-h-11 min-w-11 cursor-pointer rounded-lg border border-solid border-[#cbd5e1] bg-white px-3 py-2.5 [font-family:inherit] text-sm font-semibold leading-5 text-[#103a5c] enabled:hover:bg-[#f1f5f9] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[3px] focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-50"
const companyBadgeClass = "box-border inline-flex w-44 min-h-7 items-center justify-center gap-[7px] whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold leading-5 before:size-1.5 before:shrink-0 before:rounded-full before:bg-current before:content-['']"

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const identity = () => `${auth.user?.id ?? ''}:${auth.rol ?? ''}:${auth.sessionVersion}`
const allowed = () => Boolean(auth.user) && auth.rol === 'ADMIN'
    && !auth.loggingIn && !auth.loggingOut && auth.isAuthenticated !== false

const sessionKey = ref('')
const pageData = ref<AdminClientPage | null>(null)
const isLoading = ref(true)
const loadError = ref('')
const isSessionExpired = ref(false)
const searchQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const previousPageButton = ref<HTMLButtonElement | null>(null)
const nextPageButton = ref<HTMLButtonElement | null>(null)
const tableRegion = ref<HTMLElement | null>(null)
const reloadButton = ref<HTMLButtonElement | null>(null)

const clients = computed(() => pageData.value?.clientes ?? [])
const credit = useAdminClientCredit(() => clients.value)
const selectedClientId = ref<number | null>(null)
const approvalTarget = ref<CompanyApprovalStatus | null>(null)
const selectedClient = computed(() =>
    clients.value.find(client => client.id === selectedClientId.value) ?? null,
)

const priceLists = ref<AdminPriceListOption[]>([])
const assignments = ref<Record<number, AdminClientPriceList | null>>({})
const selections = ref<Record<number, number | ''>>({})
const feedback = ref<Record<number, { text: string; error: boolean }>>({})
const approvalFeedback = ref<Record<number, { text: string; error: boolean }>>({})
const updatingApprovalClientIds = ref<Record<number, boolean>>({})
const uncertainApprovalClientIds = ref<Record<number, boolean>>({})
const reconcilingApprovalClientIds = ref<Record<number, boolean>>({})
const priceListsLoading = ref(true)
const priceListsError = ref<string | null>(null)
const uncertainPriceListClientIds = ref<Record<number, boolean>>({})
const savingClientId = ref<number | null>(null)
const managingPriceLists = ref(false)

const approvalRequests = new Set<AbortController>()
// Marca cuándo un estado de empresa fue actualizado o verificado localmente para
// que una respuesta paginada iniciada antes no lo pise al llegar tarde.
const approvalUpdatedAt: Record<number, number> = {}

let searchTimer: ReturnType<typeof setTimeout> | undefined
let currentRequest: AbortController | undefined
let listQueryKey = ''
let lastRouteKey = ''
let lastRouteSearch = ''
let lastIdentity = ''
let priceListsRequest = 0
let unmounted = false

class ApprovalTimeoutError extends Error {}

const dateFormatter = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' })

function formatDate(value: string): string {
    const date = new Date(value)

    return Number.isNaN(date.getTime())
        ? 'Fecha no disponible'
        : dateFormatter.format(date)
}

function cancelApprovalRequests() {
    for (const request of approvalRequests) request.abort()
    approvalRequests.clear()
}

async function withApprovalDeadline<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const request = new AbortController()
    approvalRequests.add(request)
    let rejectWait!: (reason: Error) => void
    const interrupted = new Promise<never>((_, reject) => { rejectWait = reject })
    const cancel = () => rejectWait(new Error('Consulta cancelada.'))
    request.signal.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(() => {
        rejectWait(new ApprovalTimeoutError('El servidor no respondió a tiempo.'))
        request.abort()
    }, APPROVAL_TIMEOUT_MS)
    try {
        return await Promise.race([work(request.signal), interrupted])
    } finally {
        clearTimeout(timer)
        request.signal.removeEventListener('abort', cancel)
        approvalRequests.delete(request)
    }
}

function isCurrent(token: string) {
    return !unmounted && token === identity() && allowed()
}

function normalizeSearch(value: unknown): string {
    if (typeof value !== 'string') return ''
    const trimmed = value.trim()
    return [...trimmed].length <= SEARCH_MAX_LENGTH && !/[\u0000-\u001f\u007f]/u.test(trimmed)
        ? trimmed
        : ''
}

function normalizePage(value: unknown): number {
    return typeof value === 'string' && /^[1-9][0-9]{0,6}$/.test(value) && Number(value) <= 1000000
        ? Number(value)
        : 1
}

function normalizeTipo(value: unknown): AdminClientType | '' {
    if (typeof value !== 'string') return ''
    const normalized = value.trim().toUpperCase()
    return normalized === 'PARTICULAR' || normalized === 'EMPRESA' ? normalized : ''
}

function normalizeEstado(value: unknown): CompanyApprovalStatus | '' {
    if (typeof value !== 'string') return ''
    const normalized = value.trim().toUpperCase()
    return STATUSES.includes(normalized as CompanyApprovalStatus)
        ? normalized as CompanyApprovalStatus
        : ''
}

const rawTipo = computed(() => normalizeTipo(route.query.tipo))
const rawEstado = computed(() => normalizeEstado(route.query.estadoEmpresa))
const appliedEstado = computed<CompanyApprovalStatus | ''>(() =>
    rawTipo.value === 'PARTICULAR' ? '' : rawEstado.value,
)
const appliedTipo = computed<AdminClientType | ''>(() =>
    rawTipo.value || (appliedEstado.value ? 'EMPRESA' : ''),
)
const appliedSearch = computed(() => normalizeSearch(route.query.busqueda))
const requestedPage = computed(() => normalizePage(route.query.page))

const searchPending = computed(() => normalizeSearch(searchQuery.value) !== appliedSearch.value)
const hasActiveFilters = computed(() => Boolean(appliedSearch.value || appliedTipo.value || appliedEstado.value))
const totalPages = computed(() => pageData.value?.totalPages ?? 0)
const total = computed(() => pageData.value?.total ?? 0)
const pageNumber = computed(() => pageData.value?.page ?? 1)
const from = computed(() => total.value === 0 ? 0 : (pageNumber.value - 1) * PAGE_SIZE + 1)
const to = computed(() => total.value === 0 ? 0 : Math.min(pageNumber.value * PAGE_SIZE, total.value))
const approvalBusy = computed(() =>
    Object.values(updatingApprovalClientIds.value).some(Boolean)
    || Object.values(reconcilingApprovalClientIds.value).some(Boolean),
)
const pagingUnavailable = computed(() => isLoading.value || Boolean(loadError.value) || approvalBusy.value)

function queryKey(page: number, search: string, tipo: AdminClientType | '', estado: CompanyApprovalStatus | '') {
    return JSON.stringify([page, search, tipo, estado])
}

function listLocation(overrides: {
    page?: number
    search?: string
    tipo?: AdminClientType | ''
    estado?: CompanyApprovalStatus | ''
} = {}) {
    const query = { ...route.query }
    delete query.page
    delete query.busqueda
    delete query.tipo
    delete query.estadoEmpresa

    const page = overrides.page ?? requestedPage.value
    const search = overrides.search ?? appliedSearch.value
    const tipo = overrides.tipo ?? appliedTipo.value
    const estado = overrides.estado ?? appliedEstado.value

    if (page !== 1) query.page = String(page)
    if (search) query.busqueda = search
    if (tipo) query.tipo = tipo
    if (estado) query.estadoEmpresa = estado

    return { query, hash: route.hash }
}

function currentQueryKey() {
    return queryKey(requestedPage.value, appliedSearch.value, appliedTipo.value, appliedEstado.value)
}

function clearNoticeMaps() {
    feedback.value = {}
    approvalFeedback.value = {}
    uncertainApprovalClientIds.value = {}
    uncertainPriceListClientIds.value = {}
}

function resetPrivateData() {
    currentRequest?.abort()
    currentRequest = undefined
    cancelApprovalRequests()
    listQueryKey = ''
    lastRouteKey = ''
    lastRouteSearch = ''
    pageData.value = null
    loadError.value = ''
    isSessionExpired.value = false
    isLoading.value = allowed()
    priceLists.value = []
    assignments.value = {}
    selections.value = {}
    priceListsError.value = null
    priceListsLoading.value = allowed()
    savingClientId.value = null
    managingPriceLists.value = false
    updatingApprovalClientIds.value = {}
    reconcilingApprovalClientIds.value = {}
    selectedClientId.value = null
    approvalTarget.value = null
    for (const key of Object.keys(approvalUpdatedAt)) delete approvalUpdatedAt[Number(key)]
    clearNoticeMaps()
}

function mergeApprovalState(freshClients: AdminClient[], startedAt: number): AdminClient[] {
    const localById = new Map(clients.value.map(client => [client.id, client]))
    return freshClients.map(fresh => {
        const local = localById.get(fresh.id)
        if (!local) return fresh

        const pending = Boolean(
            updatingApprovalClientIds.value[fresh.id]
            || reconcilingApprovalClientIds.value[fresh.id]
            || uncertainApprovalClientIds.value[fresh.id],
        )
        const locallyNewer = (approvalUpdatedAt[fresh.id] ?? 0) >= startedAt
        if (!pending && !locallyNewer) {
            if (local.estadoAprobacionEmpresa === fresh.estadoAprobacionEmpresa) {
                delete approvalUpdatedAt[fresh.id]
            }
            return fresh
        }

        return { ...fresh, estadoAprobacionEmpresa: local.estadoAprobacionEmpresa }
    })
}

async function fetchClients() {
    if (unmounted || !allowed()) return

    const page = requestedPage.value
    const search = appliedSearch.value
    const tipo = appliedTipo.value
    const estado = appliedEstado.value
    const key = queryKey(page, search, tipo, estado)
    const session = identity()
    const restoreReloadFocus = reloadButton.value?.matches(':focus') ?? false

    currentRequest?.abort()
    const controller = new AbortController()
    currentRequest = controller
    listQueryKey = key
    isLoading.value = true
    loadError.value = ''
    isSessionExpired.value = false
    const startedAt = Date.now()

    try {
        const response = await getAdminClientPage({
            page,
            limit: PAGE_SIZE,
            ...(search ? { busqueda: search } : {}),
            ...(tipo ? { tipo } : {}),
            ...(estado ? { estadoEmpresa: estado } : {}),
        }, controller.signal)

        if (controller.signal.aborted || session !== identity() || !allowed()) return
        if (key !== currentQueryKey()) return

        pageData.value = { ...response, clientes: mergeApprovalState(response.clientes, startedAt) }
        listQueryKey = key
        void restorePagerFocus(response)

        if (response.page !== page) {
            const nextKey = queryKey(response.page, search, tipo, estado)
            listQueryKey = nextKey
            void router.replace(listLocation({ page: response.page, search, tipo, estado }))
        }
    } catch (error: unknown) {
        if (controller.signal.aborted || session !== identity()) return

        const status = axios.isAxiosError(error) ? error.response?.status : undefined
        isSessionExpired.value = status === 401
        pageData.value = null
        loadError.value = status === 401
            ? 'La sesión expiró. Iniciá sesión nuevamente.'
            : status === 403
                ? 'No tenés permisos para ver clientes.'
                : axios.isAxiosError(error)
                    ? error.response?.data?.message || error.response?.data?.error || error.message
                    : 'No pudimos cargar los clientes. Intentá nuevamente.'
    } finally {
        if (!controller.signal.aborted && session === identity()) {
            isLoading.value = false
            if (restoreReloadFocus) {
                await nextTick()
                if (!loadError.value && !unmounted) {
                    searchInput.value?.focus({ preventScroll: true })
                }
            }
        }
    }
}

async function restorePagerFocus(page: AdminClientPage) {
    const previous = previousPageButton.value
    const next = nextPageButton.value
    const focused = [previous, next].find(button => button?.matches(':focus'))
    if (!focused || (page.totalPages > 0
        && (focused === previous ? page.page > 1 : page.page < page.totalPages))) return

    await nextTick()
    if (typeof document === 'undefined') return
    const { activeElement, body } = document
    if (activeElement !== focused && activeElement !== body) return
    const target = page.totalPages <= 1 ? searchInput.value : focused === previous ? next : previous
    target?.focus({ preventScroll: true })
}

async function restoreRowFocus(clientId: number) {
    await nextTick()
    if (unmounted) return
    const row = tableRegion.value?.querySelector<HTMLElement>(`[data-client-row="${clientId}"]`)
    const target = row?.querySelector<HTMLElement>('button:not([disabled]), select:not([disabled])')
    target?.focus({ preventScroll: true })
}

function isSearchFocused() {
    return (typeof document !== 'undefined' && document.activeElement === searchInput.value)
        || (searchInput.value?.matches?.(':focus') ?? false)
}

function scheduleSearch() {
    clearTimeout(searchTimer)
    if (!searchPending.value) return

    searchTimer = setTimeout(() => {
        if (unmounted) return
        const search = normalizeSearch(searchQuery.value)
        if (!isSearchFocused()) {
            searchQuery.value = search
        }
        if (search !== appliedSearch.value) {
            void router.replace(listLocation({ page: 1, search }))
        }
    }, SEARCH_DEBOUNCE_MS)
}

function applySearch() {
    clearTimeout(searchTimer)
    const search = normalizeSearch(searchQuery.value)
    searchQuery.value = search
    if (search !== appliedSearch.value) {
        void router.replace(listLocation({ page: 1, search }))
    }
}

function clearSearch() {
    clearTimeout(searchTimer)
    searchQuery.value = ''
    void router.replace(listLocation({ page: 1, search: '' }))
}

function changeTipo(event: Event) {
    const tipo = normalizeTipo((event.target as HTMLSelectElement).value)
    const estado = tipo === 'EMPRESA' ? appliedEstado.value : ''
    const search = normalizeSearch(searchQuery.value)
    void router.push(listLocation({ page: 1, search, tipo, estado }))
}

function changeEstado(event: Event) {
    const estado = normalizeEstado((event.target as HTMLSelectElement).value)
    const tipo = estado ? 'EMPRESA' : (appliedTipo.value === 'EMPRESA' ? '' : appliedTipo.value)
    const search = normalizeSearch(searchQuery.value)
    void router.push(listLocation({ page: 1, search, tipo, estado }))
}

function clearFilters() {
    clearTimeout(searchTimer)
    searchQuery.value = ''
    void router.push(listLocation({ page: 1, search: '', tipo: '', estado: '' }))
    void nextTick(() => searchInput.value?.focus({ preventScroll: true }))
}

function changePage(offset: number) {
    if (pagingUnavailable.value || !pageData.value) return
    const target = pageData.value.page + offset
    if (target < 1 || target > pageData.value.totalPages) return
    void router.push(listLocation({ page: target }))
}

function openClient(client: AdminClient, target: CompanyApprovalStatus | null = null) {
    if (!allowed()) return
    selectedClientId.value = client.id
    approvalTarget.value = target
}

function closeClient() {
    if (selectedClientId.value !== null
        && (updatingApprovalClientIds.value[selectedClientId.value]
            || reconcilingApprovalClientIds.value[selectedClientId.value])) return
    selectedClientId.value = null
    approvalTarget.value = null
}

function confirmApproval() {
    const client = selectedClient.value
    const target = approvalTarget.value
    if (client && target) return setCompanyApproval(client, target)
}

function hasAvailableList(id: number) {
    return priceLists.value.some(list => list.id === id)
}

function selectedList(id: number) {
    return selections.value[id] || null
}

function canSavePriceList(id: number) {
    const selected = selectedList(id)
    return savingClientId.value === null && !managingPriceLists.value && !priceListsLoading.value
        && !priceListsError.value && !uncertainPriceListClientIds.value[id] && !loadError.value
        && selected !== (assignments.value[id]?.idListaPrecio ?? null)
        && (selected === null || hasAvailableList(selected))
}

async function loadPriceLists(preserveDrafts = false) {
    if (unmounted || !allowed()) return
    const request = ++priceListsRequest
    const session = identity()
    const previousAssignments = assignments.value
    const previousSelections = selections.value
    priceListsLoading.value = true
    try {
        const data = await getAdminClientPriceLists()
        if (unmounted || request !== priceListsRequest || session !== identity()) return
        priceLists.value = data.listas
        const nextAssignments = Object.fromEntries(data.asignaciones.map(item => [item.idCliente, item]))
        const nextSelections: Record<number, number | ''> = Object.fromEntries(
            data.asignaciones.map(item => [item.idCliente, item.idListaPrecio]),
        )
        if (preserveDrafts) {
            const availableLists = new Set(data.listas.map(list => list.id))
            for (const [rawId, previousSelection] of Object.entries(previousSelections)) {
                const id = Number(rawId)
                const previousAssigned = previousAssignments[id]?.idListaPrecio ?? null
                if (previousSelection === previousAssigned) continue
                const selected = previousSelection === '' ? null : Number(previousSelection)
                if (selected === null || availableLists.has(selected)) {
                    nextSelections[id] = previousSelection
                }
            }
        }
        assignments.value = nextAssignments
        selections.value = nextSelections
        feedback.value = {}
        uncertainPriceListClientIds.value = {}
        priceListsError.value = null
    } catch {
        if (unmounted || request !== priceListsRequest || session !== identity()) return
        priceListsError.value = 'No pudimos consultar las listas y asignaciones. Volvé a cargar para continuar.'
    } finally {
        if (!unmounted && request === priceListsRequest && session === identity()) {
            priceListsLoading.value = false
        }
    }
}

async function reconcilePriceListAssignments(clientId: number) {
    const session = identity()
    const requested = selectedList(clientId)
    try {
        const data = await getAdminClientPriceLists()
        if (session !== identity() || !allowed()) return

        priceLists.value = data.listas
        assignments.value = Object.fromEntries(data.asignaciones.map(item => [item.idCliente, item]))
        for (const [id, assignment] of Object.entries(assignments.value)) {
            if (assignment && Number(id) !== clientId) {
                selections.value[Number(id)] = assignment.idListaPrecio
            }
        }
        selections.value[clientId] = assignments.value[clientId]?.idListaPrecio ?? ''
        delete uncertainPriceListClientIds.value[clientId]

        const applied = requested === (assignments.value[clientId]?.idListaPrecio ?? null)
        feedback.value[clientId] = applied
            ? { text: 'Cambio confirmado con el servidor.', error: false }
            : { text: 'El servidor conserva la asignación anterior.', error: true }
    } catch {
        if (session !== identity()) return
        uncertainPriceListClientIds.value[clientId] = true
        priceListsError.value = 'No pudimos verificar las asignaciones. Recargá las listas antes de volver a guardar.'
        feedback.value[clientId] = {
            text: 'No pudimos verificar el resultado. La asignación quedó bloqueada.',
            error: true,
        }
    }
}

async function savePriceList(id: number) {
    if (!canSavePriceList(id)) return
    const session = identity()
    savingClientId.value = id
    delete feedback.value[id]
    delete approvalFeedback.value[id]

    try {
        const list = await saveAdminClientPriceList(id, selectedList(id))
        if (session !== identity()) return
        assignments.value[id] = list
        selections.value[id] = list?.idListaPrecio ?? ''
        feedback.value[id] = { text: list ? 'Lista asignada.' : 'Asignación retirada.', error: false }
    } catch (error: unknown) {
        if (session !== identity()) return
        if (isMutationResultUncertain(error)) {
            feedback.value[id] = {
                text: 'No pudimos confirmar el cambio. Verificando el estado actual…',
                error: true,
            }
            await reconcilePriceListAssignments(id)
        } else {
            const response = axios.isAxiosError<{ message?: string }>(error) ? error.response : undefined
            feedback.value[id] = {
                text: response?.data?.message ?? 'No se pudo guardar la asignación.',
                error: true,
            }
        }
    } finally {
        if (session === identity()) {
            savingClientId.value = null
            await restoreRowFocus(id)
        }
    }
}

async function reconcileCompanyApproval(clientId: number): Promise<void> {
    if (!allowed() || reconcilingApprovalClientIds.value[clientId]) return
    const token = identity()
    reconcilingApprovalClientIds.value[clientId] = true
    try {
        const freshClients = await withApprovalDeadline(signal => getAdminClients(signal))
        if (!isCurrent(token)) return
        const fresh = freshClients.find(client => client.id === clientId)
        const current = clients.value.find(client => client.id === clientId)

        if (!fresh || !current || fresh.tipoCliente !== 'EMPRESA'
            || !STATUSES.includes(fresh.estadoAprobacionEmpresa ?? '' as CompanyApprovalStatus)) {
            throw new Error('El cliente ya no está disponible en el listado.')
        }

        Object.assign(current, fresh)
        approvalUpdatedAt[clientId] = Date.now()
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
        if (isCurrent(token)) {
            delete reconcilingApprovalClientIds.value[clientId]
            await restoreRowFocus(clientId)
        }
    }
}

async function setCompanyApproval(client: AdminClient, newStatus: CompanyApprovalStatus) {
    if (
        !allowed() ||
        updatingApprovalClientIds.value[client.id] ||
        reconcilingApprovalClientIds.value[client.id] ||
        uncertainApprovalClientIds.value[client.id] ||
        client.tipoCliente !== 'EMPRESA' ||
        client.estadoAprobacionEmpresa === newStatus
    ) return

    const token = identity()
    updatingApprovalClientIds.value[client.id] = true
    delete approvalFeedback.value[client.id]
    delete feedback.value[client.id]

    try {
        const updated = await withApprovalDeadline(signal =>
            updateAdminCompanyApproval(
                client.id,
                newStatus,
                signal,
                client.estadoAprobacionEmpresa ?? undefined,
            ),
        )
        if (!isCurrent(token)) return
        if (updated.id !== client.id || updated.estadoAprobacionEmpresa !== newStatus) {
            throw new Error('Respuesta de aprobación incompleta.')
        }
        Object.assign(client, updated)
        approvalUpdatedAt[client.id] = Date.now()
        delete uncertainApprovalClientIds.value[client.id]
        approvalFeedback.value[client.id] = {
            text: newStatus === 'APROBADA' ? 'Empresa aprobada.' : newStatus === 'RECHAZADA' ? 'Empresa rechazada.' : 'Empresa marcada como pendiente.',
            error: false,
        }
    } catch (error: unknown) {
        if (!isCurrent(token)) return
        const response = axios.isAxiosError<{ message?: string }>(error) ? error.response : undefined
        if (!response || response.status >= 500 || response.status === 409) {
            uncertainApprovalClientIds.value[client.id] = true
            approvalFeedback.value[client.id] = {
                text: error instanceof ApprovalTimeoutError
                    ? 'El servidor no respondió a tiempo. El resultado es incierto. Consultando el estado actual…'
                    : 'No pudimos confirmar el cambio en el servidor. Verificando estado actual…',
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
        if (isCurrent(token)) {
            delete updatingApprovalClientIds.value[client.id]
            await restoreRowFocus(client.id)
        }
    }
}

function applyRouteState() {
    const page = requestedPage.value
    const search = appliedSearch.value
    const tipo = appliedTipo.value
    const estado = appliedEstado.value
    const location = listLocation({ page, search, tipo, estado })

    if (route.query.page !== location.query.page
        || route.query.busqueda !== location.query.busqueda
        || route.query.tipo !== location.query.tipo
        || route.query.estadoEmpresa !== location.query.estadoEmpresa) {
        void router.replace(location)
    }

    const routeKey = queryKey(page, search, tipo, estado)
    if (routeKey !== lastRouteKey) {
        lastRouteKey = routeKey
        selectedClientId.value = null
        approvalTarget.value = null
        clearTimeout(searchTimer)
        if ((search !== lastRouteSearch || !searchPending.value)
            && !(isSearchFocused() && searchQuery.value.trim() === search)) {
            searchQuery.value = search
        }
        lastRouteSearch = search
    }

    if (allowed() && routeKey !== listQueryKey) {
        void fetchClients()
    }
}

watch(
    [
        () => route.query.page,
        () => route.query.busqueda,
        () => route.query.tipo,
        () => route.query.estadoEmpresa,
        identity,
    ],
    () => {
        const session = identity()
        if (session !== lastIdentity) {
            lastIdentity = session
            sessionKey.value = session
            resetPrivateData()
            if (allowed()) void loadPriceLists()
        }
        if (!allowed()) {
            isLoading.value = false
            priceListsLoading.value = false
            return
        }
        applyRouteState()
    },
    { immediate: true, flush: 'sync' },
)

watch(searchQuery, scheduleSearch)

onBeforeUnmount(() => {
    unmounted = true
    clearTimeout(searchTimer)
    currentRequest?.abort()
    cancelApprovalRequests()
})
</script>

<template>
    <section v-if="allowed()" class="min-w-0 text-sm leading-normal text-[#13293a]" aria-labelledby="clients-title">
        <header class="mb-6">
            <h1 id="clients-title" class="m-0 mb-3 text-[28px] font-semibold leading-[1.3] max-[541px]:text-[26px]">Clientes</h1>
            <p class="m-0 text-sm leading-6 text-[#475569]">Consultá los datos de tus clientes y gestioná su registro empresarial.</p>
        </header>

        <AdminPriceListsPanel
            :key="sessionKey"
            :disabled="!allowed() || savingClientId !== null"
            @changed="loadPriceLists(true)"
            @busy="managingPriceLists = $event"
        />

        <form role="search" class="mb-4 box-border rounded-lg border border-slate-200 bg-white p-4" novalidate @submit.prevent="applySearch">
            <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-start">
                <div class="min-w-0">
                    <label for="clients-search" class="mb-1 block text-sm font-medium">Buscar clientes</label>
                    <input
                        id="clients-search"
                        ref="searchInput"
                        v-model="searchQuery"
                        type="search"
                        maxlength="200"
                        autocomplete="off"
                        placeholder="Nombre, email, CUIT, documento o #ID"
                        aria-describedby="clients-search-hint"
                        class="box-border block min-h-11 w-full rounded-md border border-solid border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm text-[#0b2438] placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:bg-slate-100"
                    >
                    <p id="clients-search-hint" class="mt-1 text-xs text-slate-600">
                        Ignora mayúsculas y espacios externos. Para buscar por ID usá #123.
                    </p>
                </div>

                <div class="min-w-0">
                    <label for="clients-type" class="mb-1 block text-sm font-medium">Tipo</label>
                    <select
                        id="clients-type"
                        :value="appliedTipo"
                        class="box-border block min-h-11 w-full cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm text-[#0b2438] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:bg-slate-100"
                        @change="changeTipo"
                    >
                        <option value="">Todos</option>
                        <option value="PARTICULAR">Particular</option>
                        <option value="EMPRESA">Empresa</option>
                    </select>
                </div>

                <div class="min-w-0">
                    <label for="clients-company-status" class="mb-1 block text-sm font-medium">Estado de empresa</label>
                    <select
                        id="clients-company-status"
                        :value="appliedEstado"
                        :disabled="appliedTipo === 'PARTICULAR'"
                        aria-describedby="clients-company-status-hint"
                        class="box-border block min-h-11 w-full cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm text-[#0b2438] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                        @change="changeEstado"
                    >
                        <option value="">Todas</option>
                        <option value="PENDIENTE">Pendiente</option>
                        <option value="APROBADA">Aprobada</option>
                        <option value="RECHAZADA">Rechazada</option>
                    </select>
                    <p id="clients-company-status-hint" class="mt-1 text-xs text-slate-600">
                        Solo aplica a empresas.
                    </p>
                </div>

                <div class="flex flex-wrap items-center gap-2 xl:justify-end xl:pt-6">
                    <button
                        type="submit"
                        class="box-border min-h-11 cursor-pointer rounded-md border-0 bg-[#145a8d] px-4 font-[inherit] text-sm font-bold text-white hover:bg-[#103a5c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="isLoading"
                    >
                        Buscar
                    </button>
                    <button
                        v-if="searchQuery || appliedSearch"
                        type="button"
                        class="box-border min-h-11 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-4 font-[inherit] text-sm font-semibold text-[#0b2438] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-50"
                        @click="clearSearch"
                    >
                        Limpiar búsqueda
                    </button>
                    <button
                        v-if="hasActiveFilters"
                        type="button"
                        class="box-border min-h-11 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-4 font-[inherit] text-sm font-semibold text-[#0b2438] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-50"
                        @click="clearFilters"
                    >
                        Limpiar filtros
                    </button>
                </div>
            </div>
        </form>

        <p v-if="isLoading" role="status" aria-live="polite" class="text-slate-700">
            {{ pageData ? 'Actualizando clientes…' : 'Cargando clientes…' }}
        </p>

        <div v-if="loadError" class="rounded-lg border border-red-200 bg-red-50 p-5 text-red-800">
            <p class="m-0 mb-4 leading-6 wrap-anywhere" role="alert">{{ loadError }}</p>
            <button
                ref="reloadButton"
                type="button"
                class="box-border min-h-11 cursor-pointer rounded-md border-0 bg-[#145a8d] px-5 py-2 font-[inherit] font-bold text-white hover:bg-[#103a5c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="isLoading"
                @click="fetchClients"
            >
                Reintentar
            </button>
            <p v-if="isSessionExpired" class="mb-0 mt-3 text-sm">Volvé a iniciar sesión para continuar.</p>
        </div>

        <template v-else-if="pageData">
            <p
                v-if="pageData.total === 0"
                class="text-slate-700"
                role="status"
                aria-live="polite"
            >
                {{ hasActiveFilters ? 'No se encontraron clientes con los filtros aplicados.' : 'Todavía no hay clientes registrados.' }}
            </p>

            <template v-else>
                <p id="clients-summary" role="status" aria-live="polite" aria-atomic="true" class="mb-3 text-sm text-slate-700">
                    Mostrando {{ from }}–{{ to }} de {{ total }} clientes. Página {{ pageNumber }} de {{ totalPages }}.
                    <span v-if="searchPending"> Actualizando búsqueda…</span>
                </p>

                <div v-if="priceListsLoading" role="status" class="mb-3 text-slate-700">Cargando listas de precios…</div>
                <div v-else-if="priceListsError" class="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3">
                    <p role="alert" class="m-0 mb-2 text-amber-950 wrap-anywhere">{{ priceListsError }}</p>
                    <button
                        type="button"
                        class="min-h-11 cursor-pointer rounded-md border border-solid border-amber-600 bg-white px-3 font-[inherit] text-sm font-semibold text-amber-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="priceListsLoading"
                        @click="loadPriceLists()"
                    >
                        Recargar listas y asignaciones
                    </button>
                </div>

                <p id="clients-table-help" class="m-0 mb-2 text-xs text-slate-600">
                    En pantallas angostas, enfocá esta región y usá las flechas para recorrer las columnas.
                </p>

                <div
                    ref="tableRegion"
                    class="overflow-x-auto rounded-lg border border-slate-200 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
                    role="region"
                    aria-label="Listado de clientes; desplazamiento horizontal disponible si es necesario"
                    aria-describedby="clients-table-help"
                    :aria-busy="isLoading ? 'true' : 'false'"
                    tabindex="0"
                >
                    <table class="clients-table w-full min-w-[1370px] table-fixed border-collapse text-left [&_tbody>tr:last-child>td]:border-b-0 [&_tbody>tr:nth-child(even)]:bg-[#fbfdff]">
                        <colgroup>
                            <col style="width: 19%">
                            <col style="width: 8%">
                            <col style="width: 15%">
                            <col style="width: 9%">
                            <col style="width: 17%">
                            <col style="width: 12%">
                            <col style="width: 8%">
                            <col style="width: 12%">
                        </colgroup>
                        <caption class="px-5 py-4 text-left text-base font-semibold text-[#0b2438]">
                            Clientes registrados: {{ total }}
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
                            <tr v-for="client in clients" :key="client.id" :data-client-row="client.id">
                                <td class="border-x-0 border-t-0 border-b border-solid border-[#e2e8f0] p-4 align-top text-sm leading-normal text-[#13293a] min-w-[170px]">
                                    <span class="font-medium">{{ client.nombreRazonSocial }}</span>
                                    <span v-if="client.cuit" class="block text-xs text-slate-600">CUIT: {{ client.cuit }}</span>
                                    <span v-if="client.docCliente" class="block text-xs text-slate-600">Documento: {{ client.docCliente }}</span>
                                    <span class="block text-xs text-slate-600">ID: {{ client.id }}</span>
                                </td>
                                <td class="border-x-0 border-t-0 border-b border-solid border-[#e2e8f0] p-4 align-top text-sm leading-normal text-[#13293a]">
                                    <span class="inline-block p-0 text-xs font-normal text-[#64748b]">
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
                                                :disabled="!!updatingApprovalClientIds[client.id] || !!reconcilingApprovalClientIds[client.id] || !!uncertainApprovalClientIds[client.id]"
                                                :class="[clientButtonClass, 'client-approve w-[88px] shrink-0 enabled:border-[#145a8d] enabled:text-[#103a5c] enabled:hover:bg-[#eff6ff] disabled:border-[#e2e8f0] disabled:bg-[#f3f4f6] disabled:text-[#64748b] disabled:opacity-100']"
                                                :aria-label="`Aprobar cuenta empresa de ${client.nombreRazonSocial}`"
                                                @click="openClient(client, 'APROBADA')"
                                            >
                                                {{ updatingApprovalClientIds[client.id] ? '…' : 'Aprobar' }}
                                            </button>
                                            <button
                                                v-if="client.estadoAprobacionEmpresa !== 'RECHAZADA'"
                                                type="button"
                                                :disabled="!!updatingApprovalClientIds[client.id] || !!reconcilingApprovalClientIds[client.id] || !!uncertainApprovalClientIds[client.id]"
                                                :class="[clientButtonClass, 'client-reject w-[88px] shrink-0 enabled:border-[#fecaca] enabled:text-[#991b1b] enabled:hover:bg-[#fee2e2] disabled:border-[#e2e8f0] disabled:bg-[#f3f4f6] disabled:text-[#64748b] disabled:opacity-100']"
                                                :aria-label="`Rechazar cuenta empresa de ${client.nombreRazonSocial}`"
                                                @click="openClient(client, 'RECHAZADA')"
                                            >
                                                {{ updatingApprovalClientIds[client.id] ? '…' : 'Rechazar' }}
                                            </button>
                                            <button
                                                v-if="uncertainApprovalClientIds[client.id]"
                                                type="button"
                                                :disabled="reconcilingApprovalClientIds[client.id]"
                                                :class="clientButtonClass"
                                                :aria-label="`Reintentar verificación de cuenta empresa de ${client.nombreRazonSocial}`"
                                                @click="reconcileCompanyApproval(client.id)"
                                            >
                                                {{ reconcilingApprovalClientIds[client.id] ? 'Verificando…' : 'Reintentar verificación' }}
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
                                                :disabled="savingClientId !== null || managingPriceLists || !!uncertainPriceListClientIds[client.id]"
                                                class="box-border min-h-11 w-full min-w-0 max-w-full cursor-pointer rounded-lg border border-solid border-[#cbd5e1] bg-white px-3 py-2.5 [font-family:inherit] text-sm font-normal leading-5 text-[#103a5c] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[3px] focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-50"
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
                                        <p v-if="feedback[client.id]" class="m-0 mt-2 text-sm" :class="feedback[client.id]!.error ? 'text-rose-800' : 'text-emerald-800'" :role="feedback[client.id]!.error ? 'alert' : 'status'">
                                            {{ feedback[client.id]!.text }}
                                        </p>
                                    </div>
                                    <span v-else class="text-slate-600">—</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <nav
                    v-if="totalPages > 0"
                    aria-label="Paginación de clientes"
                    :aria-busy="isLoading ? 'true' : 'false'"
                    class="mt-4 flex flex-wrap items-center justify-center gap-3"
                >
                    <button
                        ref="previousPageButton"
                        type="button"
                        :disabled="pagingUnavailable || pageNumber <= 1"
                        class="box-border min-h-11 min-w-28 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-4 font-[inherit] text-sm font-semibold text-[#0b2438] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-50"
                        @click="changePage(-1)"
                    >
                        Anterior
                    </button>
                    <span class="text-sm font-medium" aria-hidden="true">Página {{ pageNumber }} de {{ totalPages }}</span>
                    <button
                        ref="nextPageButton"
                        type="button"
                        :disabled="pagingUnavailable || pageNumber >= totalPages"
                        class="box-border min-h-11 min-w-28 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-4 font-[inherit] text-sm font-semibold text-[#0b2438] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-50"
                        @click="changePage(1)"
                    >
                        Siguiente
                    </button>
                </nav>
            </template>
        </template>

        <AdminClientStatusDialog v-if="selectedClient" :key="selectedClient.id" :client="selectedClient"
            :target="approvalTarget" :credit="credit.status(selectedClient.id)"
            :busy="selectedClientId !== null && (!!updatingApprovalClientIds[selectedClientId] || !!reconcilingApprovalClientIds[selectedClientId])"
            :uncertain="!!uncertainApprovalClientIds[selectedClient.id]" :feedback="approvalFeedback[selectedClient.id]"
            @close="closeClient" @confirm="confirmApproval" @retry="reconcileCompanyApproval(selectedClient.id)" @refresh-credit="credit.refresh(selectedClient.id)" />
    </section>
</template>
