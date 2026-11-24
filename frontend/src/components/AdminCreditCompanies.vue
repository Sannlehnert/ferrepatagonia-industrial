<script setup lang="ts">
import axios from 'axios'
import { computed, onMounted, ref, watch } from 'vue'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import { accountMoney } from '@/services/adminAccountDto'
import { listAdminCreditCompanies } from '@/services/adminCreditCompanyService'
import { useAuthStore } from '@/stores/auth'
import type {
  AdminCreditCompany,
  AdminCreditCompanyFilters,
  AdminCreditCompanyPage,
  CreditCompanyAccountFilter,
  CreditCompanyApproval,
  CreditCompanyRequestFilter,
} from '@/types/adminCreditCompany'

const emit = defineEmits<{ select: [company: AdminCreditCompany] }>()

const PAGE_SIZE = 10
const SEARCH_MAX_LENGTH = 200
const APPROVALS: CreditCompanyApproval[] = ['PENDIENTE', 'APROBADA', 'RECHAZADA']
const REQUESTS: CreditCompanyRequestFilter[] = [
  'PENDIENTE', 'APROBADA', 'RECHAZADA', 'SIN_SOLICITUD',
]
const ACCOUNTS: CreditCompanyAccountFilter[] = ['HABILITADA', 'INHABILITADA', 'SIN_CUENTA']

const auth = useAuthStore()
const allowed = () => auth.rol === 'ADMIN' && !auth.loggingIn && !auth.loggingOut
const identity = () => `${auth.user?.id ?? ''}:${auth.rol ?? ''}:${auth.sessionVersion}`
const page = usePrivateAccountRead<AdminCreditCompanyPage>(identity, allowed)

const search = ref('')
const approval = ref<CreditCompanyApproval | ''>('')
const requestState = ref<CreditCompanyRequestFilter | ''>('')
const accountState = ref<CreditCompanyAccountFilter | ''>('')
const applied = ref<AdminCreditCompanyFilters>({})
const currentPage = ref(1)
const validation = ref('')

const companies = computed(() => page.data.value?.empresas ?? [])
const pagination = computed(() => page.data.value?.paginacion ?? null)
const hasFilters = computed(() => Boolean(
  applied.value.busqueda || applied.value.estadoEmpresa ||
  applied.value.estadoSolicitud || applied.value.cuenta,
))
const totalPages = computed(() => pagination.value?.totalPages ?? 0)
const from = computed(() => {
  if (!pagination.value || pagination.value.total === 0) return 0
  return (pagination.value.page - 1) * pagination.value.limit + 1
})
const to = computed(() => {
  if (!pagination.value) return 0
  return Math.min(pagination.value.page * pagination.value.limit, pagination.value.total)
})

function message(error: unknown): string {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined
  if (status === 400) return 'Los filtros de la consulta no son válidos. Revisalos e intentá nuevamente.'
  if (status === 401) return 'La sesión expiró. Iniciá sesión nuevamente.'
  if (status === 403) return 'No tenés permisos para consultar empresas y crédito.'
  if (status === 503) return 'La consulta de empresas no está disponible en este momento. Reintentá más tarde.'
  return 'No pudimos consultar las empresas. Intentá nuevamente.'
}

function load(nextPage = 1) {
  currentPage.value = nextPage
  return page.load(async signal => {
    const result = await listAdminCreditCompanies({
      ...applied.value,
      page: nextPage,
      limit: PAGE_SIZE,
    }, signal)
    if (result.paginacion.page !== nextPage) currentPage.value = result.paginacion.page
    return result
  })
}

function applyFilters() {
  const value = search.value.trim()
  if ([...value].length > SEARCH_MAX_LENGTH || /[\u0000-\u001f\u007f]/u.test(value)) {
    validation.value = 'La búsqueda debe ser texto de hasta 200 caracteres sin caracteres de control.'
    return
  }
  validation.value = ''
  search.value = value
  applied.value = {
    ...(value ? { busqueda: value } : {}),
    ...(approval.value ? { estadoEmpresa: approval.value } : {}),
    ...(requestState.value ? { estadoSolicitud: requestState.value } : {}),
    ...(accountState.value ? { cuenta: accountState.value } : {}),
  }
  void load(1)
}

function clearFilters() {
  validation.value = ''
  search.value = ''
  approval.value = ''
  requestState.value = ''
  accountState.value = ''
  applied.value = {}
  void load(1)
}

function changePage(delta: number) {
  if (page.loading.value || !pagination.value) return
  const target = pagination.value.page + delta
  if (target < 1 || target > pagination.value.totalPages) return
  void load(target)
}

function approvalLabel(value: CreditCompanyApproval | null): string {
  if (value === 'APROBADA') return 'Aprobada'
  if (value === 'PENDIENTE') return 'Pendiente'
  if (value === 'RECHAZADA') return 'Rechazada'
  return 'No determinable'
}

function requestLabel(company: AdminCreditCompany): string {
  const request = company.solicitudCredito
  if (!request) return 'Sin solicitudes'
  if (request.estado === 'PENDIENTE') return 'Pendiente de resolución'
  if (request.estado === 'APROBADA') return 'Aprobada'
  return 'Rechazada'
}

function requestDetail(company: AdminCreditCompany): string {
  const request = company.solicitudCredito
  if (!request) return 'La empresa todavía no solicitó crédito.'
  const amount = accountMoney(request.montoSolicitado)
  return `${amount} · ${request.plazoDias} días${request.limiteAutorizado
    ? ` · Límite ${accountMoney(request.limiteAutorizado)}`
    : ''}`
}

function accountLabel(company: AdminCreditCompany): string {
  if (!company.cuentaCorriente) return 'Sin cuenta corriente'
  return company.cuentaCorriente.estado === 'HABILITADA' ? 'Habilitada' : 'Inhabilitada'
}

function accountDetail(company: AdminCreditCompany): string {
  const account = company.cuentaCorriente
  if (!account) return 'Puede solicitar crédito si la empresa está aprobada.'
  const limit = account.limite === null ? 'límite no acreditado' : `límite ${accountMoney(account.limite)}`
  const term = account.plazoDias === null ? 'plazo no acreditado' : `${account.plazoDias} días`
  return `${limit} · ${term}${account.origen === 'DEMO' ? ' · Datos DEMO' : ''}`
}

function select(company: AdminCreditCompany) {
  if (!allowed()) return
  emit('select', company)
}

watch(() => [identity(), auth.loggingIn, auth.loggingOut], () => {
  search.value = ''
  approval.value = ''
  requestState.value = ''
  accountState.value = ''
  applied.value = {}
  currentPage.value = 1
  validation.value = ''
  page.reset()
  if (allowed()) void load(1)
}, { flush: 'sync' })

defineExpose({ refresh: () => load(currentPage.value) })

onMounted(() => { void load(1) })
</script>

<template>
  <section v-if="allowed()" class="credit-companies" aria-labelledby="credit-companies-title">
    <header>
      <h2 id="credit-companies-title">Empresas y crédito</h2>
      <p>
        Buscá una empresa por razón social, nombre, CUIT, email o ID para consultar su
        aprobación, solicitud de crédito, cuenta corriente y elegibilidad.
      </p>
    </header>

    <form class="filters" aria-label="Filtros de empresas y crédito" @submit.prevent="applyFilters">
      <label for="credit-company-search">
        Buscar empresa
        <input
          id="credit-company-search"
          v-model="search"
          type="search"
          autocomplete="off"
          maxlength="200"
          placeholder="Razón social, CUIT, email o #ID"
          aria-label="Buscar empresa"
          aria-describedby="credit-company-search-help"
        />
        <span id="credit-company-search-help" class="hint">
          Podés escribir el ID con #, por ejemplo #42.
        </span>
      </label>
      <label for="credit-company-approval">
        Estado comercial
        <select id="credit-company-approval" v-model="approval" aria-label="Estado comercial">
          <option value="">Todos</option>
          <option v-for="value in APPROVALS" :key="value" :value="value">{{ value }}</option>
        </select>
      </label>
      <label for="credit-company-request">
        Estado de solicitud
        <select id="credit-company-request" v-model="requestState" aria-label="Estado de solicitud">
          <option value="">Todas</option>
          <option v-for="value in REQUESTS" :key="value" :value="value">{{ value }}</option>
        </select>
      </label>
      <label for="credit-company-account">
        Cuenta corriente
        <select id="credit-company-account" v-model="accountState" aria-label="Cuenta corriente">
          <option value="">Todas</option>
          <option v-for="value in ACCOUNTS" :key="value" :value="value">{{ value }}</option>
        </select>
      </label>
      <div class="filter-actions">
        <button type="submit">Buscar empresas</button>
        <button type="button" class="secondary" @click="clearFilters">Limpiar filtros</button>
      </div>
    </form>

    <p v-if="validation" role="alert">{{ validation }}</p>
    <p v-if="page.loading.value" role="status">Cargando empresas…</p>
    <div v-else-if="page.error.value" class="notice">
      <p role="alert">{{ message(page.error.value) }}</p>
      <button type="button" @click="load(currentPage)">Reintentar consulta de empresas</button>
    </div>
    <template v-else-if="page.data.value">
      <p v-if="!companies.length" role="status">
        {{ hasFilters ? 'No hay empresas para estos filtros.' : 'No hay empresas registradas.' }}
      </p>
      <template v-else>
        <p class="summary" role="status">
          Mostrando {{ from }}–{{ to }} de {{ pagination?.total }} empresas.
          Página {{ pagination?.page }} de {{ totalPages }}.
        </p>
        <ul class="company-list">
          <li v-for="company in companies" :key="company.clienteId" class="company-card">
            <div class="identity">
              <h3>{{ company.nombreRazonSocial }}</h3>
              <p>
                ID #{{ company.clienteId }}
                <span v-if="company.cuit"> · CUIT {{ company.cuit }}</span>
                <span> · {{ company.email }}</span>
              </p>
              <p class="small">
                {{ company.activo ? 'Empresa activa' : 'Empresa inactiva' }}
              </p>
            </div>
            <dl class="states">
              <div>
                <dt>Aprobación empresarial</dt>
                <dd>{{ approvalLabel(company.estadoAprobacionEmpresa) }}</dd>
              </div>
              <div>
                <dt>Solicitud de crédito</dt>
                <dd>{{ requestLabel(company) }}</dd>
                <p class="small">{{ requestDetail(company) }}</p>
              </div>
              <div>
                <dt>Cuenta corriente</dt>
                <dd>{{ accountLabel(company) }}</dd>
                <p class="small">{{ accountDetail(company) }}</p>
              </div>
            </dl>
            <button
              type="button"
              :aria-label="`Ver detalle de ${company.nombreRazonSocial}`"
              @click="select(company)"
            >
              Ver detalle
            </button>
          </li>
        </ul>
        <div class="pagination">
          <button
            type="button"
            :disabled="page.loading.value || (pagination?.page ?? 1) <= 1"
            @click="changePage(-1)"
          >
            Página anterior de empresas
          </button>
          <span>Página {{ pagination?.page }} de {{ totalPages }}</span>
          <button
            type="button"
            :disabled="page.loading.value || (pagination?.page ?? 0) >= totalPages"
            @click="changePage(1)"
          >
            Página siguiente de empresas
          </button>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.credit-companies, .credit-companies * { box-sizing: border-box; min-width: 0; }
.credit-companies { max-width: 100%; color: #0b2438; }
.credit-companies header { margin-bottom: 16px; }
.credit-companies h2 { margin: 0 0 6px; font-size: 20px; font-weight: 600; }
.credit-companies header p { margin: 0; line-height: 1.6; color: #475569; }
.filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); align-items: start; gap: 14px; margin: 16px 0; }
.filters label { display: grid; gap: 6px; font-size: 14px; font-weight: 600; }
.credit-companies :is(button, input, select) { min-height: 44px; max-width: 100%; font: inherit; font-size: 14px; }
.credit-companies :is(input, select) { width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; background: white; color: #0b2438; padding: 8px 12px; }
.credit-companies button { min-width: 44px; cursor: pointer; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 14px; background: #145a8d; color: white; font-weight: 600; }
.credit-companies button.secondary { background: white; color: #103a5c; }
.credit-companies button:hover:not(:disabled) { filter: brightness(.96); }
.credit-companies :is(button, input, select):focus-visible { outline: 2px solid #145a8d; outline-offset: 2px; }
.credit-companies button:disabled { cursor: not-allowed; opacity: .55; }
.filter-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.hint { font-weight: 400; color: #64748b; font-size: 12px; }
.summary { margin: 12px 0; color: #475569; }
.company-list { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.company-card { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.6fr) auto; align-items: start; gap: 16px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; background: white; }
.company-card h3 { margin: 0 0 4px; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.company-card p { margin: 0; line-height: 1.5; overflow-wrap: anywhere; }
.company-card .small { color: #475569; font-size: 13px; margin-top: 2px; }
.states { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 0; }
.states dt { font-size: 12px; color: #475569; font-weight: 600; }
.states dd { margin: 3px 0 0; font-weight: 600; }
.notice { background: #f4f7fa; border-radius: 8px; padding: 16px; }
.notice p { margin: 0 0 10px; }
.pagination { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 16px; }
@media (max-width: 800px) {
  .company-card { grid-template-columns: minmax(0, 1fr); }
  .company-card > button { justify-self: start; }
}
@media (max-width: 600px) {
  .filters label, .filter-actions { width: 100%; }
  .filter-actions button { flex: 1 1 100%; }
}
</style>
