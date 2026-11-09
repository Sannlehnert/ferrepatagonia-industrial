<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { useAuthStore } from '@/stores/auth'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import { accountMoney } from '@/services/adminAccountDto'
import { getAdminAccount, getAdminAccountDetail, getAdminAccounts } from '@/services/adminAccountService'
import type { AccountDetail, AccountFilters, AccountList, AccountQuery, Due, Movement } from '@/types/adminAccount'

const auth = useAuthStore()
const allowed = () => auth.rol === 'ADMIN' && !auth.loggingOut && !auth.loggingIn
const identity = () => `${auth.user?.id}:${auth.rol}:${auth.sessionVersion}`
const list = usePrivateAccountRead<AccountList>(identity, allowed)
type Detail = { summary: AccountQuery; movements: AccountDetail<Movement>; dues: AccountDetail<Due> }
const detail = usePrivateAccountRead<Detail>(identity, allowed)
const clientInput = ref(''), enabledInput = ref(''), selected = ref<number | null>(null), validation = ref('')
let filters: AccountFilters = {}
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
function loadList(cursor?: string) {
  detail.reset()
  selected.value = null
  return list.load(signal => getAdminAccounts({ ...filters, cursor }, signal))
}
function applyFilters() {
  validation.value = ''
  const raw = clientInput.value.trim()
  if (raw && (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > 2147483647)) {
    validation.value = 'Ingresá un ID de cliente entero entre 1 y 2147483647.'
    list.reset(); detail.reset(); selected.value = null
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
    detail.reset(); selected.value = null
    return
  }
  validation.value = ''
  void loadDetail(Number(raw))
}
function loadDetail(clientId: number, kind?: 'movimientos' | 'vencimientos', cursor?: string) {
  selected.value = clientId
  const previous = selectedData.value
  return detail.load(async signal => {
    const [summary, movements, dues] = await Promise.all([
      getAdminAccount(clientId, signal),
      getAdminAccountDetail(clientId, 'movimientos', kind === 'movimientos' ? cursor : undefined, signal),
      getAdminAccountDetail(clientId, 'vencimientos', kind === 'vencimientos' ? cursor : undefined, signal),
    ])
    if (summary.revision !== movements.revision || summary.revision !== dues.revision ||
      (cursor && previous?.summary.revision !== summary.revision) ||
      [movements, dues].some(page => (page.estado === 'SIN_CUENTA') !== (summary.estado === 'SIN_CUENTA')) ||
      (cursor && kind && previous && (kind === 'movimientos' ? previous.movements.corte !== movements.corte : previous.dues.corte !== dues.corte))) throw outdated()
    return { summary, movements, dues }
  })
}
watch(() => [identity(), auth.loggingOut, auth.loggingIn], () => {
  list.reset(); detail.reset(); selected.value = null
  clientInput.value = ''; enabledInput.value = ''; filters = {}; validation.value = ''
  if (allowed()) void loadList()
}, { flush: 'sync' })
onMounted(() => { void loadList() })
</script>

<template>
  <section v-if="allowed()" class="accounts" aria-labelledby="accounts-title">
    <header><h1 id="accounts-title">Cuentas corrientes</h1><p>Consulta administrativa de saldos, movimientos y vencimientos en USD.</p></header>
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
    <section v-if="selected" aria-labelledby="account-detail-title" class="detail">
      <h2 id="account-detail-title">Cliente {{ selected }}</h2>
      <p v-if="detail.loading.value" role="status">Cargando detalle…</p>
      <div v-else-if="detail.error.value" class="notice"><p role="alert">{{ message(detail.error.value) }}</p><button @click="loadDetail(selected)">Reiniciar detalle</button></div>
      <template v-else-if="summary">
        <p v-if="summary.estado === 'SIN_CUENTA'" role="status">El cliente no tiene cuenta corriente asignada.</p>
        <template v-else>
          <p><strong v-if="summary.origen === 'DEMO'">Datos DEMO · </strong>{{ summary.estado }} · Cobertura {{ summary.cobertura }} · Crédito {{ summary.estadoCredito }}</p>
          <p v-if="summary.estado === 'INHABILITADA'">Cuenta inhabilitada. El historial sigue disponible para consulta.</p>
          <dl class="summary">
            <div><dt>Saldo</dt><dd>{{ accountMoney(summary.saldo) }}</dd></div><div><dt>Límite</dt><dd>{{ accountMoney(summary.limite) }}</dd></div>
            <div><dt>Utilizado</dt><dd>{{ accountMoney(summary.utilizado) }}</dd></div><div><dt>Disponible</dt><dd>{{ accountMoney(summary.disponible) }}</dd></div>
            <div><dt>Plazo actual</dt><dd>{{ summary.plazoDias ? `${summary.plazoDias} días` : 'No acreditado' }}</dd></div>
            <div><dt>Deuda vencida</dt><dd>{{ accountMoney(summary.deudaVencidaTotal) }}</dd></div>
            <div><dt>Vencida a 30 días</dt><dd>{{ accountMoney(summary.deudaVencida30Dias) }}</dd></div>
            <div><dt>Vencida a 60 días</dt><dd>{{ accountMoney(summary.deudaVencida60Dias) }}</dd></div>
            <div><dt>Por vencer</dt><dd>{{ accountMoney(summary.deudaPorVencerTotal) }}</dd></div>
          </dl>
          <h3>Movimientos</h3>
          <template v-if="movements && movements.estado !== 'SIN_CUENTA'">
            <p v-if="movements.cobertura !== 'COMPLETA'">Historial incompleto: no acredita el saldo total.</p>
            <p v-if="!movements.items.length" role="status">{{ movements.cobertura === 'COMPLETA' ? 'Sin movimientos.' : 'Sin movimientos acreditados para mostrar. La información es incompleta.' }}</p>
            <div v-else class="table-wrap" role="region" aria-label="Movimientos" tabindex="0"><table>
              <thead><tr><th>Fecha UTC</th><th>Concepto</th><th>Tipo / estado</th><th>Importe</th><th>Saldo resultante</th><th>Vence el</th></tr></thead>
              <tbody><tr v-for="item in movements.items" :key="item.id"><td>{{ item.fechaOperacion }}</td><td>{{ item.concepto }} <strong v-if="item.origen === 'DEMO'">DEMO</strong></td><td>{{ item.tipo }} / {{ item.estado }}</td><td>{{ accountMoney(item.importe) }}</td><td>{{ accountMoney(item.saldoResultante) }}</td><td>{{ item.venceEl ?? 'No acreditado' }}</td></tr></tbody>
            </table></div>
            <button v-if="movements.siguienteCursor" @click="loadDetail(selected, 'movimientos', movements.siguienteCursor)">Siguiente página de movimientos</button>
          </template>
          <h3>Vencimientos</h3>
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
    </section>
  </section>
</template>

<style scoped>
.accounts { color: #0b2438; min-width: 0; } h1 { font-size: 28px; font-weight: 600; } header { margin-bottom: 24px; } p { margin: 12px 0; line-height: 1.6; }
.filters { display: flex; flex-wrap: wrap; align-items: end; gap: 16px; margin: 24px 0; } label { display: grid; gap: 6px; }
input, select, button { min-height: 44px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; max-width: 100%; }
button { cursor: pointer; background: #145a8d; color: white; } button:focus-visible, input:focus-visible, select:focus-visible, .table-wrap:focus-visible { outline: 2px solid #145a8d; outline-offset: 3px; }
.notice { background: #f4f7fa; padding: 20px; border-radius: 8px; } .table-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; margin: 16px 0; }
table { width: 100%; border-collapse: collapse; text-align: left; } th, td { padding: 16px; border-bottom: 1px solid #e2e8f0; vertical-align: top; } th { background: #f4f7fa; } td { overflow-wrap: anywhere; min-width: 110px; }
.detail { margin-top: 32px; border-top: 1px solid #cbd5e1; padding-top: 16px; } .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 24px 0; } dt { color: #475569; } dd { margin: 8px 0; font-weight: 600; }
@media (max-width: 600px) { .filters label, .filters button { width: 100%; } th, td { padding: 10px; } }
</style>
