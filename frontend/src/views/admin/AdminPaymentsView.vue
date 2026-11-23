<script setup lang="ts">
import axios from 'axios'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AdminPaymentAccreditationDialog from '@/components/AdminPaymentAccreditationDialog.vue'
import AdminPaymentDetailDialog from '@/components/AdminPaymentDetailDialog.vue'
import AdminPaymentReviewDialog from '@/components/AdminPaymentReviewDialog.vue'
import AdminPaymentStateBadge from '@/components/AdminPaymentStateBadge.vue'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import {
  canAccredit,
  canReview,
  formatPaymentMoney,
  getAdminPayment,
  listAdminPayments,
  type AdminPayment,
  type AdminPaymentPage,
  type ReviewDecision,
} from '@/services/adminPaymentService'
import { useAuthStore } from '@/stores/auth'
import { formatInstant } from '@/utils/cuentaCorriente'

const auth = useAuthStore()
const allowed = () => auth.isAuthenticated && !auth.loggingIn && !auth.loggingOut && auth.rol === 'ADMIN'
const identity = () => [auth.user?.id, auth.rol, auth.sessionVersion].join(':')

const list = usePrivateAccountRead<AdminPaymentPage>(identity, allowed)
const detail = usePrivateAccountRead<AdminPayment>(identity, allowed)
const page = ref(1)
const selectedId = ref<number | null>(null)
const review = ref<{ id: number; decision: ReviewDecision } | null>(null)
const accreditationId = ref<number | null>(null)
const feedback = ref('')
const listContainer = ref<HTMLElement | null>(null)
const detailDialogRef = ref<InstanceType<typeof AdminPaymentDetailDialog> | null>(null)

const payments = computed(() => list.data.value)
const selected = computed(() => detail.data.value)
const isInvalidPageError = computed(() =>
  axios.isAxiosError(list.error.value) && list.error.value.response?.status === 400 && page.value > 1,
)

function errorMessage(error: unknown) {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined
  if (status === 401) return 'La sesión expiró. Iniciá sesión nuevamente.'
  if (status === 403) return 'La sesión actual no tiene permisos de administración.'
  if (status === 400) return 'La consulta de pagos no es válida. Reiniciá desde la primera página.'
  if (status === 503) return 'La consulta de pagos no está disponible. Intentá nuevamente más tarde.'
  return 'No se pudieron consultar las declaraciones de pago.'
}

function typeLabel(payment: AdminPayment) {
  if (payment.comprobanteTipoMime === 'application/pdf') return 'PDF'
  if (payment.comprobanteTipoMime === 'image/png') return 'PNG'
  if (payment.comprobanteTipoMime === 'image/jpeg') return 'JPG'
  return 'Comprobante'
}

function receiptSize(bytes: number | null) {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function actionHint(payment: AdminPayment) {
  if (payment.estado === 'ACREDITADO') return 'Pago acreditado. No hay acciones financieras pendientes.'
  if (payment.estado === 'RECHAZADO') return 'Pago rechazado. El expediente está cerrado.'
  if (payment.estado === 'ANULADO') return 'Pago anulado. No admite nuevas acciones.'
  if (payment.cuentaCorrienteId === null || payment.pedidoId !== null) {
    return 'Pago directo sobre pedido: no corresponde revisión documental de cuenta corriente.'
  }
  if (!payment.comprobanteId) return 'Sin comprobante asociado: no se puede aprobar ni acreditar.'
  if (payment.estadoDocumental === 'RECHAZADO') return 'Documento rechazado. El pago no se puede acreditar.'
  if (payment.estadoDocumental === 'PENDIENTE') return 'Primero completá la revisión documental.'
  if (payment.estadoDocumental === 'APROBADO') return 'Documento aprobado y pendiente de acreditación.'
  return 'Consultá el detalle para conocer el estado.'
}

function reloadList(number = page.value, options?: { keepData?: boolean }) {
  page.value = number
  return list.load(signal => listAdminPayments(number, signal), options)
}

function reload() {
  if (list.loading.value) return
  void reloadList(page.value)
}

function loadDetail(paymentId: number) {
  selectedId.value = paymentId
  return detail.load(signal => getAdminPayment(paymentId, signal))
}

function closeDetail() {
  selectedId.value = null
  detail.reset()
}

function openReview(payment: AdminPayment, decision: ReviewDecision) {
  if (!allowed() || !canReview(payment)) return
  review.value = { id: payment.id, decision }
}

function openAccreditation(payment: AdminPayment) {
  if (!allowed() || !canAccredit(payment)) return
  accreditationId.value = payment.id
}

async function restoreFallbackFocus(paymentId: number | undefined) {
  await nextTick()
  if (typeof document === 'undefined' || paymentId === undefined) return
  if (selectedId.value !== null) {
    if (!document.activeElement || document.activeElement === document.body) {
      detailDialogRef.value?.focusClose()
    }
    return
  }
  const active = document.activeElement
  const insideCard = active instanceof HTMLElement && Boolean(active.closest('[data-payment-id]'))
  if (!insideCard) {
    listContainer.value
      ?.querySelector<HTMLElement>(`[data-payment-id="${paymentId}"] [aria-label="Ver detalle del pago ${paymentId}"]`)
      ?.focus({ preventScroll: true })
  }
}

function closeReview() {
  const closedId = review.value?.id
  review.value = null
  void restoreFallbackFocus(closedId)
}

function closeAccreditation() {
  const closedId = accreditationId.value ?? undefined
  accreditationId.value = null
  void restoreFallbackFocus(closedId)
}

function onUpdated(payment: AdminPayment) {
  feedback.value = `Pago #${payment.id} actualizado con la respuesta del servidor.`
  if (selectedId.value === payment.id) detail.data.value = payment
  if (list.data.value) {
    list.data.value = {
      ...list.data.value,
      items: list.data.value.items.map(item => (item.id === payment.id ? payment : item)),
    }
  }
  void reloadList(page.value, { keepData: true })
}

watch([identity, () => auth.loggingOut, () => auth.loggingIn], () => {
  review.value = null
  accreditationId.value = null
  feedback.value = ''
  selectedId.value = null
  list.reset()
  detail.reset()
  page.value = 1
  if (allowed()) void reloadList(1)
}, { flush: 'sync' })

onMounted(() => {
  if (allowed()) void reloadList(1)
})
</script>

<template>
  <section v-if="allowed()" class="payments-view" aria-labelledby="admin-payments-title">
    <header class="payments-header">
      <p class="payments-kicker">Administración financiera</p>
      <h1 id="admin-payments-title">Gestión de pagos</h1>
      <p>
        Consultá las declaraciones de pago de empresas, revisá el comprobante y
        acreditá el ingreso con confirmación explícita. La revisión documental no
        acredita dinero.
      </p>
    </header>

    <p v-if="feedback" role="status" class="payments-feedback">{{ feedback }}</p>

    <div class="payments-separation" role="note">
      <strong>Dos decisiones separadas:</strong>
      aprobar o rechazar el documento valida el comprobante; acreditar registra el
      abono real en la cuenta corriente. Solo la acreditación mueve saldos.
    </div>

    <section ref="listContainer" aria-labelledby="payments-list-title" class="payments-list-section">
      <div class="payments-list-heading">
        <h2 id="payments-list-title">Declaraciones de pago</h2>
        <p v-if="payments" class="payments-page-label">Página {{ page }}</p>
      </div>

      <p v-if="list.loading.value && !payments" role="status" class="payments-message">Cargando declaraciones de pago…</p>

      <div v-else-if="list.error.value" class="payments-notice">
        <p role="alert" class="m-0">{{ errorMessage(list.error.value) }}</p>
        <div class="payment-actions">
          <button type="button" class="payment-action" @click="reload">Reintentar consulta</button>
          <button
            v-if="isInvalidPageError"
            type="button"
            class="payment-action payment-action--secondary"
            @click="reloadList(1)"
          >
            Volver a la página 1
          </button>
        </div>
      </div>

      <p v-else-if="payments && payments.items.length === 0" role="status" class="payments-message">
        No hay declaraciones de pago para mostrar.
      </p>

      <template v-else-if="payments">
        <p v-if="list.loading.value" role="status" class="payments-message">Actualizando declaraciones de pago…</p>
        <ul class="payments-grid" aria-label="Declaraciones de pago">
        <li
          v-for="payment in payments.items"
          :key="payment.id"
          :data-payment-id="payment.id"
          class="payment-card"
        >
          <article :aria-labelledby="`payment-${payment.id}-title`" class="payment-card__body">
            <div class="payment-card__head">
              <h3 :id="`payment-${payment.id}-title`" class="payment-card__title">Pago #{{ payment.id }}</h3>
              <div class="payment-badges" aria-label="Estados del pago">
                <AdminPaymentStateBadge kind="document" :state="payment.estadoDocumental" />
                <AdminPaymentStateBadge kind="financial" :state="payment.estado" />
              </div>
            </div>

            <dl class="payment-facts">
              <div class="payment-fact payment-fact--wide">
                <dt>Cliente / empresa</dt>
                <dd>{{ payment.cliente }} · Cliente #{{ payment.clienteId }}</dd>
              </div>
              <div class="payment-fact">
                <dt>{{ payment.cuentaCorrienteId !== null ? 'Cuenta corriente' : 'Destino' }}</dt>
                <dd>{{ payment.cuentaCorrienteId !== null ? `#${payment.cuentaCorrienteId}` : `Pedido #${payment.pedidoId}` }}</dd>
              </div>
              <div class="payment-fact">
                <dt>Importe original</dt>
                <dd class="payment-amount">{{ formatPaymentMoney(payment.monto, payment.moneda) }}</dd>
              </div>
              <div class="payment-fact">
                <dt>Moneda</dt>
                <dd>{{ payment.moneda ?? 'No informada' }}</dd>
              </div>
              <div v-if="payment.montoUsd" class="payment-fact">
                <dt>USD acreditado</dt>
                <dd>
                  {{ formatPaymentMoney(payment.montoUsd, 'USD') }}
                  <span class="payment-confirmed">{{ payment.moneda === 'ARS' ? 'conversión confirmada' : 'importe acreditado' }}</span>
                </dd>
              </div>
              <div class="payment-fact">
                <dt>Comprobante</dt>
                <dd v-if="payment.comprobanteId" class="payment-receipt">
                  {{ typeLabel(payment) }} · {{ receiptSize(payment.comprobanteBytes) }}
                  <a :href="`/api/admin/comprobantes/${payment.comprobanteId}`" class="payment-link">
                    Descargar
                  </a>
                </dd>
                <dd v-else>Sin comprobante asociado</dd>
              </div>
              <div class="payment-fact">
                <dt>Declarado</dt>
                <dd>{{ formatInstant(payment.fecha) }}</dd>
              </div>
              <div v-if="payment.revisadoEn" class="payment-fact">
                <dt>Revisado</dt>
                <dd>{{ formatInstant(payment.revisadoEn) }}</dd>
              </div>
              <div v-if="payment.acreditadoEn" class="payment-fact">
                <dt>Acreditado</dt>
                <dd>{{ formatInstant(payment.acreditadoEn) }}</dd>
              </div>
            </dl>

            <p v-if="payment.motivoRevision" class="payment-reason">
              <strong>Motivo de rechazo:</strong> {{ payment.motivoRevision }}
            </p>

            <div class="payment-actions">
              <button
                type="button"
                class="payment-action payment-action--secondary"
                :aria-label="`Ver detalle del pago ${payment.id}`"
                @click="loadDetail(payment.id)"
              >
                Ver detalle
              </button>
              <button
                v-if="canReview(payment)"
                type="button"
                class="payment-action payment-action--approve"
                :aria-label="`Aprobar documento del pago ${payment.id}`"
                @click="openReview(payment, 'APROBADO')"
              >
                Aprobar documento
              </button>
              <button
                v-if="canReview(payment)"
                type="button"
                class="payment-action payment-action--reject"
                :aria-label="`Rechazar documento del pago ${payment.id}`"
                @click="openReview(payment, 'RECHAZADO')"
              >
                Rechazar documento
              </button>
              <button
                v-if="canAccredit(payment)"
                type="button"
                class="payment-action payment-action--accredit"
                :aria-label="`Acreditar pago ${payment.id}`"
                @click="openAccreditation(payment)"
              >
                Acreditar pago
              </button>
            </div>
            <p class="payment-hint">{{ actionHint(payment) }}</p>
          </article>
        </li>
        </ul>
      </template>

      <nav v-if="payments && (page > 1 || payments.paginaSiguiente)" class="payments-pagination" aria-label="Paginación de pagos">
        <button
          v-if="page > 1"
          type="button"
          class="payment-action"
          @click="reloadList(page - 1)"
        >
          Anterior
        </button>
        <button
          v-if="payments.paginaSiguiente"
          type="button"
          class="payment-action"
          @click="reloadList(payments.paginaSiguiente!)"
        >
          Siguiente página
        </button>
      </nav>
    </section>

    <AdminPaymentDetailDialog
      v-if="selectedId !== null"
      ref="detailDialogRef"
      :key="`detail-${selectedId}`"
      :payment-id="selectedId"
      :payment="selected"
      :loading="detail.loading.value"
      :error="detail.error.value ? errorMessage(detail.error.value) : ''"
      :action-hint="selected ? actionHint(selected) : ''"
      @close="closeDetail"
      @retry="selectedId !== null && loadDetail(selectedId)"
      @review="openReview"
      @accredit="openAccreditation"
    />

    <AdminPaymentReviewDialog
      v-if="review"
      :key="`review-${review.id}-${review.decision}`"
      :payment-id="review.id"
      :decision="review.decision"
      @close="closeReview"
      @updated="onUpdated"
    />

    <AdminPaymentAccreditationDialog
      v-if="accreditationId !== null"
      :key="`accredit-${accreditationId}`"
      :payment-id="accreditationId"
      @close="closeAccreditation"
      @updated="onUpdated"
    />
  </section>
</template>

<style scoped>
.payments-view {
  box-sizing: border-box;
  min-width: 0;
  color: #0b2438;
}
.payments-header { max-width: 70ch; margin-bottom: 1.25rem; }
.payments-kicker { margin: 0 0 .35rem; color: #145a8d; font-size: .75rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.payments-header h1 { margin: 0 0 .5rem; font-size: clamp(1.6rem, 4vw, 2rem); line-height: 1.15; }
.payments-header p { margin: 0; line-height: 1.6; }
.payments-feedback { box-sizing: border-box; margin: 0 0 1rem; border: 1px solid #86efac; border-radius: 8px; background: #f0fdf4; padding: .75rem 1rem; color: #166534; font-weight: 600; overflow-wrap: anywhere; }
.payments-separation { box-sizing: border-box; margin: 1rem 0 1.5rem; border-left: 4px solid #145a8d; border-radius: 6px; background: #f4f7fa; padding: .85rem 1rem; line-height: 1.6; }
.payments-list-section { min-width: 0; }
.payments-list-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: .5rem; }
.payments-list-heading h2 { margin: 0; font-size: 1.25rem; }
.payments-page-label { margin: 0; color: #475569; font-size: .875rem; }
.payments-message { margin: 1rem 0; color: #475569; line-height: 1.6; }
.payments-notice { box-sizing: border-box; margin: 1rem 0; border: 1px solid #fecaca; border-radius: 8px; background: #fef2f2; padding: 1rem; color: #991b1b; }
.payments-notice p { margin: 0 0 .75rem; line-height: 1.6; overflow-wrap: anywhere; }
.payments-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr)); gap: 1rem; margin: 1rem 0; padding: 0; list-style: none; }
.payment-card { box-sizing: border-box; min-width: 0; border: 1px solid #dbe3ec; border-radius: 12px; background: #fff; box-shadow: 0 1px 3px rgb(15 23 42 / 8%); }
.payment-card__body { box-sizing: border-box; display: flex; min-width: 0; height: 100%; flex-direction: column; gap: .75rem; padding: 1rem; }
.payment-card__head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: .5rem; }
.payment-card__title { margin: 0; font-size: 1.05rem; line-height: 1.3; }
.payment-badges { display: flex; flex-wrap: wrap; gap: .35rem; min-width: 0; }
.payment-badges--detail { margin-bottom: 1rem; }
.payment-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .65rem .9rem; margin: 0; }
.payment-fact { min-width: 0; }
.payment-fact--wide { grid-column: 1 / -1; }
.payment-facts dt { color: #475569; font-size: .75rem; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; }
.payment-facts dd { margin: .15rem 0 0; overflow-wrap: anywhere; line-height: 1.5; }
.payment-amount { font-weight: 700; }
.payment-confirmed { color: #166534; font-size: .75rem; font-weight: 700; }
.payment-receipt { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem .45rem; }
.payment-link { display: inline-flex; min-height: 44px; align-items: center; color: #145a8d; font-weight: 700; text-decoration: underline; }
.payment-link:focus-visible { outline: 2px solid #145a8d; outline-offset: 2px; }
.payment-reason { box-sizing: border-box; margin: 0; border-left: 3px solid #dc2626; background: #fef2f2; padding: .55rem .7rem; color: #7f1d1d; font-size: .875rem; line-height: 1.5; overflow-wrap: anywhere; }
.payment-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: auto; }
.payment-action {
  box-sizing: border-box;
  display: inline-flex;
  min-height: 44px;
  max-width: 100%;
  align-items: center;
  justify-content: center;
  border: 1px solid #145a8d;
  border-radius: 8px;
  background: #fff;
  padding: .5rem .85rem;
  color: #145a8d;
  font: inherit;
  font-size: .875rem;
  font-weight: 700;
  line-height: 1.25;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  transition: background-color .15s ease, color .15s ease;
  overflow-wrap: anywhere;
}
.payment-action:hover:not(:disabled) { background: #eaf2f8; }
.payment-action:focus-visible { outline: 2px solid #145a8d; outline-offset: 2px; }
.payment-action:disabled { cursor: not-allowed; opacity: .55; }
.payment-action--secondary { border-color: #64748b; color: #334155; }
.payment-action--secondary:hover:not(:disabled) { background: #f1f5f9; }
.payment-action--approve { border-color: #15803d; background: #f0fdf4; color: #166534; }
.payment-action--approve:hover:not(:disabled) { background: #dcfce7; }
.payment-action--reject { border-color: #b91c1c; background: #fff; color: #991b1b; }
.payment-action--reject:hover:not(:disabled) { background: #fef2f2; }
.payment-action--accredit { border-color: #b45309; background: #b45309; color: #fff; }
.payment-action--accredit:hover:not(:disabled) { background: #92400e; }
.payment-hint { margin: 0; color: #475569; font-size: .8125rem; line-height: 1.5; }
.payments-pagination { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1.25rem 0; }

@media (max-width: 480px) {
  .payment-facts { grid-template-columns: minmax(0, 1fr); }
  .payment-actions { flex-direction: column; }
  .payment-action { width: 100%; }
}
</style>
