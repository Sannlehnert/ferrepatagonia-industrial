<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import axios from 'axios'
import AdminCreditAccountControls from '@/components/AdminCreditAccountControls.vue'
import AdminCreditCompanies from '@/components/AdminCreditCompanies.vue'
import AdminCreditRequestDecision from '@/components/AdminCreditRequestDecision.vue'
import AdminCreditRequests from '@/components/AdminCreditRequests.vue'
import { useAuthStore } from '@/stores/auth'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import { accountMoney } from '@/services/adminAccountDto'
import { getAdminAccount, getAdminAccountDetail, getAdminAccounts } from '@/services/adminAccountService'
import { getAdminCreditCompany, listAdminCreditEvents } from '@/services/adminCreditCompanyService'
import { listAdminCreditRequests, type AdminCreditRequest } from '@/services/adminCreditService'
import type { AccountDetail, AccountFilters, AccountList, AccountQuery, Due, Movement } from '@/types/adminAccount'
import type { AdminCreditCompany, AdminCreditEvent } from '@/types/adminCreditCompany'

const auth = useAuthStore()
const allowed = () => auth.rol === 'ADMIN' && !auth.loggingOut && !auth.loggingIn
const identity = () => `${auth.user?.id}:${auth.rol}:${auth.sessionVersion}`
const list = usePrivateAccountRead<AccountList>(identity, allowed)
type Detail = { summary: AccountQuery; movements: AccountDetail<Movement>; dues: AccountDetail<Due> }
const detail = usePrivateAccountRead<Detail>(identity, allowed)
const companyRead = usePrivateAccountRead<AdminCreditCompany>(identity, allowed)
const historyRead = usePrivateAccountRead<{
  requests: AdminCreditRequest[]
  events: AdminCreditEvent[]
}>(identity, allowed)
const activeTab = ref<'empresas' | 'contable'>('empresas')
const companyListRef = ref<{ refresh: () => Promise<void> | void } | null>(null)
const detailSectionRef = ref<HTMLElement | null>(null)
const highlightDetail = ref(false)
const clientInput = ref(''), enabledInput = ref(''), selected = ref<number | null>(null), validation = ref('')
let filters: AccountFilters = {}
let detailSequence = 0
let highlightTimer: ReturnType<typeof setTimeout> | null = null

function clearHighlightTimer() {
  if (highlightTimer !== null) {
    clearTimeout(highlightTimer)
    highlightTimer = null
  }
}

function triggerDetailHighlight() {
  clearHighlightTimer()
  highlightDetail.value = true
  highlightTimer = setTimeout(() => {
    highlightDetail.value = false
    highlightTimer = null
  }, 1200)
}
const selectedCompany = computed(() => companyRead.data.value)
const creditRequests = computed(() => historyRead.data.value?.requests ?? [])
const creditEvents = computed(() => historyRead.data.value?.events ?? [])
const latestRequest = computed(() => creditRequests.value[0] ?? selectedCompany.value?.solicitudCredito ?? null)
const accounts = computed(() => list.data.value)
const selectedData = computed(() => detail.data.value)
const summary = computed(() => selectedData.value?.summary)
const movements = computed(() => selectedData.value?.movements)
const dues = computed(() => selectedData.value?.dues)
const outdated = () => Object.assign(new Error(), { response: { status: 409 } })
function message(error: unknown) {
  const status = axios.isAxiosError(error) ? error.response?.status : (error as { response?: { status?: number } })?.response?.status
  if (status === 409) return 'La consulta cambió o venció. Reiniciá desde la primera página.'
  if (status === 404) return 'El cliente no existe.'
  if (status === 503) return 'La consulta de cuentas corrientes no está disponible. Intentá nuevamente más tarde.'
  if (status === 400) return 'Los parámetros de la consulta no son válidos. Reiniciá la consulta.'
  if (status === 401 || status === 403) return 'La sesión actual no permite consultar estas cuentas.'
  return 'No pudimos consultar las cuentas. Intentá nuevamente.'
}
function resetDetailState() {
  detailSequence += 1
  clearHighlightTimer()
  highlightDetail.value = false
  creditFeedback.value = ''
  detail.reset()
  companyRead.reset()
  historyRead.reset()
  selected.value = null
}

function closeDetail() {
  resetDetailState()
  window.scrollTo?.({ top: 0, behavior: 'smooth' })
}

function loadList(cursor?: string) {
  resetDetailState()
  return list.load(signal => getAdminAccounts({ ...filters, cursor }, signal))
}
function applyFilters() {
  validation.value = ''
  const raw = clientInput.value.trim()
  if (raw && (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > 2147483647)) {
    validation.value = 'Ingresá un ID de cliente entero entre 1 y 2147483647.'
    list.reset(); resetDetailState()
    return
  }
  filters = { ...(raw ? { clienteId: Number(raw) } : {}),
    ...(enabledInput.value ? { habilitada: enabledInput.value === 'true' } : {}) }
  void loadList()
}
function lookupClient() {
  const raw = clientInput.value.trim()
  if (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > 2147483647) {
    validation.value = 'Ingresá un ID de cliente entero entre 1 y 2147483647.'
    resetDetailState()
    return
  }
  validation.value = ''
  void loadDetail(Number(raw))
}
const creditFeedback = ref('')

function approvalText(value: AdminCreditCompany['estadoAprobacionEmpresa']): string {
  if (value === 'APROBADA') return 'Aprobada. La aprobación empresarial no crea ni habilita crédito.'
  if (value === 'PENDIENTE') return 'Pendiente. La empresa todavía no puede solicitar crédito.'
  if (value === 'RECHAZADA') return 'Rechazada. No puede solicitar crédito en este estado.'
  return 'No determinable.'
}

function requestStatusText(value: string | null | undefined): string {
  if (value === 'PENDIENTE') return 'Pendiente de resolución. Todavía no autoriza límite ni habilitación.'
  if (value === 'APROBADA') return 'Aprobada. Autoriza un límite y un plazo, pero no habilita la cuenta.'
  if (value === 'RECHAZADA') return 'Rechazada. Debe presentarse una nueva solicitud para volver a evaluar.'
  return 'Sin solicitudes de crédito registradas.'
}

function accountStatusText(): string {
  if (detail.error.value) return 'No se pudo consultar la cuenta corriente.'
  if (!summary.value) return 'Consultando la cuenta corriente…'
  if (summary.value.estado === 'SIN_CUENTA') return 'Sin cuenta corriente asignada.'
  return summary.value.estado === 'HABILITADA'
    ? 'Habilitada. Participa en la validación de compras a crédito.'
    : 'Inhabilitada. No permite nuevas compras a crédito.'
}

function eligibilityText(): string {
  if (detail.error.value) return 'No se pudo determinar la elegibilidad.'
  if (!summary.value) return 'Se determina al consultar la cuenta corriente.'
  if (summary.value.estado === 'SIN_CUENTA') return 'No hay una cuenta corriente para operar a crédito.'
  if (summary.value.estadoCredito === 'DISPONIBLE') return 'Crédito disponible según la cuenta. Cada compra se revalida.'
  if (summary.value.estadoCredito === 'BLOQUEADO') return 'Crédito bloqueado por una restricción comercial conocida.'
  return 'No determinable con la información actual. No se debe asumir que la compra será aceptada.'
}

function loadCompany(clientId: number) {
  return companyRead.load(signal => getAdminCreditCompany(clientId, signal))
}

function loadHistory(clientId: number) {
  return historyRead.load(async signal => {
    const requests = await listAdminCreditRequests({ clienteId: clientId, limite: 100 }, signal)
    const events = await listAdminCreditEvents({ clienteId: clientId, limite: 100 }, signal)
    return { requests: requests.items, events: events.items }
  })
}

async function onCreditUpdated(clientId: number, message: string) {
  if (!allowed() || selected.value !== clientId) return
  creditFeedback.value = message
  await loadDetail(clientId, undefined, undefined, { preserveFeedback: true })
  if (!allowed() || selected.value !== clientId) return
  if (activeTab.value === 'empresas') {
    await companyListRef.value?.refresh()
  } else {
    await list.load(signal => getAdminAccounts(filters, signal))
  }
}

function onCreditResolved(message: string) {
  if (selected.value === null) return
  void onCreditUpdated(selected.value, message)
}

function retryHistory() {
  if (selected.value !== null) void loadHistory(selected.value)
}

async function loadDetail(
  clientId: number,
  kind?: 'movimientos' | 'vencimientos',
  cursor?: string,
  options: { preserveFeedback?: boolean } = {},
) {
  const current = ++detailSequence
  if (!options.preserveFeedback) creditFeedback.value = ''
  const changed = selected.value !== clientId
  const shouldScrollAndHighlight = kind === undefined && !options.preserveFeedback
  selected.value = clientId
  const refreshContext = changed || kind === undefined
  if (changed) {
    companyRead.reset()
    historyRead.reset()
  }
  if (shouldScrollAndHighlight) {
    triggerDetailHighlight()
    await nextTick()
    if (current !== detailSequence || selected.value !== clientId || !allowed()) return
    detailSectionRef.value?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }
  const previous = selectedData.value
  await detail.load(async signal => {
    // La recarga del listado también consulta la BD; evitar ráfagas de autenticación y lecturas.
    const summary = await getAdminAccount(clientId, signal)
    const movements = await getAdminAccountDetail(clientId, 'movimientos', kind === 'movimientos' ? cursor : undefined, signal)
    const dues = await getAdminAccountDetail(clientId, 'vencimientos', kind === 'vencimientos' ? cursor : undefined, signal)
    if (summary.revision !== movements.revision || summary.revision !== dues.revision ||
      (cursor && previous?.summary.revision !== summary.revision) ||
      [movements, dues].some(page => (page.estado === 'SIN_CUENTA') !== (summary.estado === 'SIN_CUENTA')) ||
      (cursor && kind && previous && (kind === 'movimientos' ? previous.movements.corte !== movements.corte : previous.dues.corte !== dues.corte))) throw outdated()
    return { summary, movements, dues }
  })
  if (!refreshContext || current !== detailSequence || selected.value !== clientId || !allowed()) return
  await loadCompany(clientId)
  if (current !== detailSequence || selected.value !== clientId || !allowed()) return
  await loadHistory(clientId)
}
watch(() => [identity(), auth.loggingOut, auth.loggingIn], () => {
  list.reset()
  resetDetailState()
  clientInput.value = ''; enabledInput.value = ''; filters = {}; validation.value = ''
  if (allowed() && activeTab.value === 'contable') void loadList()
}, { flush: 'sync' })
watch(activeTab, tab => {
  if (!allowed()) return
  if (tab === 'contable' && !accounts.value && !list.loading.value) void loadList()
  if (tab === 'empresas') companyListRef.value?.refresh()
})
onMounted(() => {
  if (activeTab.value === 'contable') void loadList()
})
onUnmounted(() => {
  clearHighlightTimer()
})
</script>

<template>
  <section v-if="allowed()" class="accounts" aria-labelledby="accounts-title">
    <header class="accounts-header">
      <div>
        <p class="eyebrow">Crédito comercial</p>
        <h1 id="accounts-title">Gestión de crédito y cuentas corrientes</h1>
        <p>Revisá solicitudes, habilitá cuentas y consultá la situación financiera de cada empresa.</p>
      </div>
      <a href="#solicitudes-pendientes" class="header-action">Revisar solicitudes pendientes</a>
    </header>
    <AdminCreditRequests id="solicitudes-pendientes" />

    <div class="tabs" role="tablist" aria-label="Secciones de cuentas corrientes">
      <button
        id="tab-empresas"
        type="button"
        role="tab"
        :aria-selected="activeTab === 'empresas'"
        aria-controls="panel-empresas"
        @click="activeTab = 'empresas'"
      >
        Empresas y crédito
      </button>
      <button
        id="tab-contable"
        type="button"
        role="tab"
        :aria-selected="activeTab === 'contable'"
        aria-controls="panel-contable"
        @click="activeTab = 'contable'"
      >
        Consulta contable
      </button>
    </div>

    <section
      v-if="activeTab === 'empresas'"
      id="panel-empresas"
      role="tabpanel"
      aria-labelledby="tab-empresas"
      tabindex="0"
      class="tab-panel"
    >
      <AdminCreditCompanies ref="companyListRef" @select="loadDetail($event.clienteId)" />
    </section>

    <section
      v-else
      id="panel-contable"
      role="tabpanel"
      aria-labelledby="tab-contable"
      tabindex="0"
      class="tab-panel"
    >
      <h2 class="panel-title">Consulta contable por cliente</h2>
      <form class="filters" @submit.prevent="applyFilters">
        <label>ID de cliente<input v-model="clientInput" inputmode="numeric" autocomplete="off" /></label>
        <label>Habilitación<select v-model="enabledInput"><option value="">Todas</option><option value="true">Habilitadas</option><option value="false">Inhabilitadas</option></select></label>
        <button type="submit">Aplicar filtros</button>
        <button type="button" @click="lookupClient">Consultar cliente por ID</button>
      </form>
      <p v-if="validation" role="alert">{{ validation }}</p>
      <p v-if="list.loading.value" role="status">Cargando cuentas…</p>
      <div v-else-if="list.error.value" class="notice"><p role="alert">{{ message(list.error.value) }}</p><button @click="loadList()">Reintentar desde la primera página</button></div>
      <template v-else-if="accounts">
        <p v-if="!accounts.items.length" role="status">No hay cuentas para estos filtros.</p>
        <div v-else class="table-wrap" role="region" aria-label="Cuentas corrientes" tabindex="0">
          <table><thead><tr><th>Cliente</th><th>Estado</th><th>Saldo</th><th>Límite</th><th>Cobertura</th><th>Consulta</th></tr></thead>
            <tbody><tr v-for="account in accounts.items" :key="account.clienteId">
              <td>{{ account.clienteId }} <strong v-if="account.origen === 'DEMO'">DEMO</strong></td><td>{{ account.estado }}</td>
              <td>{{ accountMoney(account.saldo) }}</td><td>{{ accountMoney(account.limite) }}</td><td>{{ account.cobertura }}</td>
              <td><button :aria-label="`Consultar cliente ${account.clienteId}`" @click="loadDetail(account.clienteId)">Consultar</button></td>
            </tr></tbody></table>
        </div>
        <button v-if="accounts.siguienteCursor" @click="loadList(accounts.siguienteCursor)">Siguiente página de cuentas</button>
      </template>
    </section>
    <section
      v-if="selected"
      ref="detailSectionRef"
      aria-labelledby="account-detail-title"
      class="detail rounded-xl transition-all duration-300"
      :class="{ 'ring-2 ring-[#145A8D]': highlightDetail }"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h2 id="account-detail-title" class="m-0">Cliente {{ selected }}</h2>
          <div v-if="selectedCompany" class="company-summary">
            <p class="company-name">{{ selectedCompany.nombreRazonSocial }}</p>
            <p>
              ID #{{ selectedCompany.clienteId }}
              <span v-if="selectedCompany.cuit"> · CUIT {{ selectedCompany.cuit }}</span>
              <span> · {{ selectedCompany.email }}</span>
              <span> · {{ selectedCompany.activo ? 'Empresa activa' : 'Empresa inactiva' }}</span>
            </p>
          </div>
          <p v-else-if="companyRead.error.value && !detail.error.value" class="muted">
            No se pudo cargar la identidad comercial de la empresa.
          </p>
        </div>
        <button
          type="button"
          class="detail-close box-border inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-solid border-slate-300 bg-white px-3.5 py-2 font-[inherit] text-sm font-semibold text-[#0B2438] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
          @click="closeDetail"
        >
          Cerrar detalle
        </button>
      </div>

      <nav class="detail-nav" aria-label="Secciones del detalle de la empresa">
        <a href="#resumen-empresa">Resumen</a>
        <a href="#solicitudes-empresa">Solicitudes y decisiones</a>
        <a href="#configuracion-credito">Configuración de crédito</a>
        <a href="#movimientos-empresa">Movimientos y vencimientos</a>
        <a href="#auditoria-empresa">Auditoría</a>
      </nav>

      <h3 id="resumen-empresa" class="section-title">Resumen financiero y comercial</h3>
      <div v-if="selectedCompany" class="concepts" aria-label="Situación comercial de la empresa">
        <article>
          <h4>Aprobación empresarial</h4>
          <p>{{ approvalText(selectedCompany.estadoAprobacionEmpresa) }}</p>
        </article>
        <article>
          <h4>Solicitud de crédito</h4>
          <p>{{ requestStatusText(latestRequest?.estado) }}</p>
          <p v-if="latestRequest" class="small">
            Última solicitud #{{ latestRequest.id }} · {{ accountMoney(latestRequest.montoSolicitado) }}
            · {{ latestRequest.plazoDias }} días.
          </p>
        </article>
        <article>
          <h4>Habilitación de la cuenta</h4>
          <p>{{ accountStatusText() }}</p>
        </article>
        <article>
          <h4>Elegibilidad de compra</h4>
          <p>{{ eligibilityText() }}</p>
        </article>
      </div>

      <p v-if="creditFeedback" role="status" class="text-emerald-800">
        {{ creditFeedback }}
      </p>
      <p v-if="detail.loading.value" role="status">Cargando detalle…</p>
      <div v-else-if="detail.error.value" class="notice"><p role="alert">{{ message(detail.error.value) }}</p><button @click="loadDetail(selected)">Reiniciar detalle</button></div>
      <template v-else-if="summary">
        <p v-if="summary.estado === 'SIN_CUENTA'" role="status">El cliente no tiene cuenta corriente asignada.</p>
        <template v-else>
          <div class="status-chips">
            <span class="chip">{{ summary.estado === 'HABILITADA' ? 'Cuenta habilitada' : 'Cuenta inhabilitada' }}</span>
            <span class="chip">Cobertura {{ summary.cobertura }}</span>
            <span class="chip">Crédito {{ summary.estadoCredito }}</span>
            <span v-if="summary.origen === 'DEMO'" class="chip demo">DEMO</span>
          </div>
          <p v-if="summary.estado === 'INHABILITADA'">Cuenta inhabilitada. El historial sigue disponible para consulta.</p>
          <dl class="summary">
            <div><dt>Saldo</dt><dd>{{ accountMoney(summary.saldo) }}</dd></div>
            <div><dt>Límite</dt><dd>{{ accountMoney(summary.limite) }}</dd></div>
            <div><dt>Utilizado</dt><dd>{{ accountMoney(summary.utilizado) }}</dd></div>
            <div><dt>Disponible</dt><dd>{{ accountMoney(summary.disponible) }}</dd></div>
            <div><dt>Plazo actual</dt><dd>{{ summary.plazoDias ? `${summary.plazoDias} días` : 'No acreditado' }}</dd></div>
          </dl>
          <details class="summary-detail">
            <summary>Detalle de deuda</summary>
            <dl class="summary">
              <div><dt>Deuda vencida</dt><dd>{{ accountMoney(summary.deudaVencidaTotal) }}</dd></div>
              <div><dt>Vencida a 30 días</dt><dd>{{ accountMoney(summary.deudaVencida30Dias) }}</dd></div>
              <div><dt>Vencida a 60 días</dt><dd>{{ accountMoney(summary.deudaVencida60Dias) }}</dd></div>
              <div><dt>Por vencer</dt><dd>{{ accountMoney(summary.deudaPorVencerTotal) }}</dd></div>
            </dl>
          </details>

          <h3 id="configuracion-credito" class="section-title">Configuración de crédito</h3>
          <AdminCreditAccountControls
            :key="`${identity()}:${selected}`"
            :client-id="selected"
            :account="summary"
            @updated="onCreditUpdated"
          />
          <h3 id="movimientos-empresa" class="section-title">Movimientos y vencimientos</h3>
          <h4>Movimientos</h4>
          <template v-if="movements && movements.estado !== 'SIN_CUENTA'">
            <p v-if="movements.cobertura !== 'COMPLETA'">Historial incompleto: no acredita el saldo total.</p>
            <p v-if="!movements.items.length" role="status">{{ movements.cobertura === 'COMPLETA' ? 'Sin movimientos.' : 'Sin movimientos acreditados para mostrar. La información es incompleta.' }}</p>
            <div v-else class="table-wrap" role="region" aria-label="Movimientos" tabindex="0"><table>
              <thead><tr><th>Fecha UTC</th><th>Concepto</th><th>Tipo / estado</th><th>Importe</th><th>Saldo resultante</th><th>Vence el</th></tr></thead>
              <tbody><tr v-for="item in movements.items" :key="item.id"><td>{{ item.fechaOperacion }}</td><td>{{ item.concepto }} <strong v-if="item.origen === 'DEMO'">DEMO</strong></td><td>{{ item.tipo }} / {{ item.estado }}</td><td>{{ accountMoney(item.importe) }}</td><td>{{ accountMoney(item.saldoResultante) }}</td><td>{{ item.venceEl ?? 'No acreditado' }}</td></tr></tbody>
            </table></div>
            <button v-if="movements.siguienteCursor" @click="loadDetail(selected, 'movimientos', movements.siguienteCursor)">Siguiente página de movimientos</button>
          </template>
          <h4>Vencimientos</h4>
          <template v-if="dues && dues.estado !== 'SIN_CUENTA'">
            <p v-if="dues.cobertura !== 'COMPLETA'">Vencimientos con cobertura {{ dues.cobertura }}. Los importes no acreditados permanecen desconocidos.</p>
            <p v-if="!dues.items.length" role="status">{{ dues.cobertura === 'COMPLETA' ? 'Sin vencimientos abiertos.' : 'Sin fechas acreditadas para mostrar.' }}</p>
            <div v-else class="table-wrap" role="region" aria-label="Vencimientos" tabindex="0"><table>
              <thead><tr><th>Movimiento</th><th>Fecha civil (Buenos Aires)</th><th>Plazo histórico</th><th>Pendiente</th><th>Estado</th></tr></thead>
              <tbody><tr v-for="item in dues.items" :key="item.movimientoId"><td>{{ item.movimientoId }} <strong v-if="item.origen === 'DEMO'">DEMO</strong></td><td>{{ item.venceEl }}</td><td>{{ item.plazoDias ? `${item.plazoDias} días` : 'No acreditado' }}</td><td>{{ accountMoney(item.pendiente) }}</td><td>{{ item.estado }}</td></tr></tbody>
            </table></div>
            <p>Evaluados al {{ dues.corte }}.</p>
            <button v-if="dues.siguienteCursor" @click="loadDetail(selected, 'vencimientos', dues.siguienteCursor)">Siguiente página de vencimientos</button>
          </template>
        </template>
      </template>

      <section v-if="selectedCompany || historyRead.data.value" class="history" aria-labelledby="credit-history-title">
        <h3 id="credit-history-title">Historial de solicitudes y decisiones</h3>
        <p v-if="historyRead.loading.value" role="status">Cargando historial de crédito…</p>
        <div v-else-if="historyRead.error.value" class="notice">
          <p role="status">No se pudo cargar el historial de solicitudes y decisiones.</p>
          <button type="button" @click="retryHistory">Reintentar historial</button>
        </div>
        <template v-else-if="historyRead.data.value">
          <h4 id="solicitudes-empresa">Solicitudes</h4>
          <p v-if="!creditRequests.length" role="status">Sin solicitudes registradas.</p>
          <ul v-else class="history-list">
            <li v-for="request in creditRequests" :key="request.id">
              <p><strong>Solicitud #{{ request.id }} · {{ request.estado }}</strong></p>
              <p>
                {{ accountMoney(request.montoSolicitado) }} · {{ request.plazoDias }} días
                · Solicitada {{ request.fechaSolicitud ?? 'sin fecha' }}
              </p>
              <p v-if="request.fechaResolucion">
                Resuelta {{ request.fechaResolucion }}
                <template v-if="request.limiteAutorizado"> · Límite {{ accountMoney(request.limiteAutorizado) }}</template>
                <template v-if="request.plazoAutorizado"> · Plazo {{ request.plazoAutorizado }} días</template>
              </p>
              <p v-if="request.motivoResolucion">Motivo: {{ request.motivoResolucion }}</p>
              <p v-if="request.evidenciaResolucion">Evidencia: {{ request.evidenciaResolucion }}</p>
              <AdminCreditRequestDecision
                v-if="request.estado === 'PENDIENTE'"
                :key="`detail:${identity()}:${request.id}`"
                :request="request"
                @resolved="onCreditResolved"
              />
            </li>
          </ul>
          <h4 id="auditoria-empresa">Auditoría de crédito</h4>
          <p v-if="!creditEvents.length" role="status">Sin eventos de crédito registrados.</p>
          <ul v-else class="history-list">
            <li v-for="event in creditEvents" :key="event.id">
              <p><strong>{{ event.tipo }}</strong> · {{ event.fechaEvento }}</p>
              <p>
                {{ event.rolActor }} #{{ event.actorUsuarioId }}
                <template v-if="event.estadoAnterior"> · {{ event.estadoAnterior }} → {{ event.estadoNuevo }}</template>
                <template v-else> · {{ event.estadoNuevo }}</template>
              </p>
              <p v-if="event.limiteNuevo !== null">
                Límite {{ event.limiteAnterior === null ? 'sin límite previo' : accountMoney(event.limiteAnterior) }}
                → {{ accountMoney(event.limiteNuevo) }}
              </p>
              <p v-if="event.motivo">Motivo: {{ event.motivo }}</p>
              <p v-if="event.evidencia">Evidencia: {{ event.evidencia }}</p>
            </li>
          </ul>
        </template>
      </section>
    </section>
  </section>
</template>

<style scoped>
.accounts { color: #0b2438; min-width: 0; } h1 { font-size: 28px; font-weight: 600; } header { margin-bottom: 24px; } p { margin: 12px 0; line-height: 1.6; }
.accounts-header { display: flex; flex-wrap: wrap; align-items: start; justify-content: space-between; gap: 16px; }
.eyebrow { margin: 0 0 4px; color: #475569; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.header-action { display: inline-flex; align-items: center; min-height: 44px; border-radius: 8px; background: #145a8d; color: white; padding: 8px 16px; font-weight: 600; text-decoration: none; }
.header-action:focus-visible { outline: 2px solid #145a8d; outline-offset: 3px; }
.detail-nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 20px; }
.detail-nav a { display: inline-flex; align-items: center; min-height: 44px; border: 1px solid #cbd5e1; border-radius: 999px; padding: 6px 14px; color: #103a5c; font-size: 14px; font-weight: 600; text-decoration: none; background: white; }
.detail-nav a:hover { background: #f1f5f9; }
.detail-nav a:focus-visible { outline: 2px solid #145a8d; outline-offset: 2px; }
.section-title { margin: 28px 0 12px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 20px; font-weight: 600; }
.status-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.chip { display: inline-flex; align-items: center; border: 1px solid #cbd5e1; border-radius: 999px; background: #f8fafc; padding: 3px 10px; font-size: 13px; font-weight: 600; }
.chip.demo { border-color: #fde68a; background: #fffbeb; color: #78350f; }
.summary-detail { margin: 12px 0; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
.summary-detail summary { cursor: pointer; font-weight: 600; }
.summary-detail summary:focus-visible { outline: 2px solid #145a8d; outline-offset: 3px; }
.filters { display: flex; flex-wrap: wrap; align-items: end; gap: 16px; margin: 24px 0; } label { display: grid; gap: 6px; }
input, select, button:not(.detail-close) { min-height: 44px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; max-width: 100%; }
button:not(.detail-close) { cursor: pointer; background: #145a8d; color: white; } button:not(.detail-close):focus-visible, input:focus-visible, select:focus-visible, .table-wrap:focus-visible { outline: 2px solid #145a8d; outline-offset: 3px; }
.notice { background: #f4f7fa; padding: 20px; border-radius: 8px; } .table-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; margin: 16px 0; }
table { width: 100%; border-collapse: collapse; text-align: left; } th, td { padding: 16px; border-bottom: 1px solid #e2e8f0; vertical-align: top; } th { background: #f4f7fa; } td { overflow-wrap: anywhere; min-width: 110px; }
.detail { margin-top: 32px; border-top: 1px solid #cbd5e1; padding-top: 16px; } .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 24px 0; } dt { color: #475569; } dd { margin: 8px 0; font-weight: 600; }
.tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0 4px; border-bottom: 1px solid #cbd5e1; padding-bottom: 8px; }
.tabs button { background: white; color: #103a5c; }
.tabs button[aria-selected="true"] { background: #103a5c; color: white; border-color: #103a5c; }
.tab-panel:focus-visible { outline: 2px solid #145a8d; outline-offset: 4px; }
.panel-title { font-size: 20px; font-weight: 600; margin: 16px 0 0; }
.company-summary { margin: 8px 0 12px; }
.company-summary p { margin: 2px 0; overflow-wrap: anywhere; }
.company-name { font-weight: 700; font-size: 17px; }
.muted { color: #64748b; }
.concepts { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 16px 0 20px; }
.concepts article { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #f8fafc; }
.concepts h4 { margin: 0 0 6px; font-size: 14px; font-weight: 700; }
.concepts p { margin: 0; font-size: 14px; }
.concepts .small { margin-top: 4px; color: #475569; font-size: 13px; }
.history { margin-top: 28px; border-top: 1px solid #e2e8f0; padding-top: 16px; }
.history h4 { margin: 18px 0 8px; font-size: 15px; font-weight: 700; }
.history-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.history-list li { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; overflow-wrap: anywhere; }
.history-list p { margin: 2px 0; }
@media (max-width: 600px) { .filters label, .filters button { width: 100%; } th, td { padding: 10px; } .tabs button { flex: 1 1 100%; } }
</style>
