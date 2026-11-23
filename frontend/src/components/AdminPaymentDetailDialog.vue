<script setup lang="ts">
import { useId } from 'vue'
import AdminPaymentStateBadge from '@/components/AdminPaymentStateBadge.vue'
import { useAdminDialog } from '@/composables/useAdminDialog'
import {
  canAccredit,
  canReview,
  documentLabel,
  financialLabel,
  formatPaymentMoney,
  type AdminPayment,
  type ReviewDecision,
} from '@/services/adminPaymentService'
import { formatInstant } from '@/utils/cuentaCorriente'

defineProps<{
  paymentId: number
  payment: AdminPayment | null
  loading: boolean
  error: string
  actionHint: string
}>()

const emit = defineEmits<{
  close: []
  retry: []
  review: [payment: AdminPayment, decision: ReviewDecision]
  accredit: [payment: AdminPayment]
}>()

const titleId = useId()
const { dialog, initialFocus, handleCancel, handleKeydown, handleNativeClose, requestClose, focusInitial } = useAdminDialog({
  canClose: () => true,
  onClose: () => emit('close'),
})

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

defineExpose({ focusClose: focusInitial })
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      :aria-labelledby="titleId"
      class="box-border m-auto w-[calc(100%-1rem)] max-w-2xl border-0 bg-transparent p-0 text-left text-[#0b2438] backdrop:bg-[#0b2438]/70 sm:w-[calc(100%-2rem)]"
      @cancel="handleCancel"
      @close="handleNativeClose"
      @keydown="handleKeydown"
    >
      <div class="box-border flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header class="box-border flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-[#f8fafc] px-4 py-3 sm:px-6 sm:py-4">
          <div class="min-w-0">
            <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#145a8d]">Detalle administrativo</p>
            <h2 :id="titleId" class="m-0 mt-1 text-lg font-bold sm:text-xl">Pago #{{ paymentId }}</h2>
          </div>
          <button
            ref="initialFocus"
            type="button"
            class="box-border min-h-11 shrink-0 cursor-pointer rounded-md border border-slate-300 bg-white px-4 font-[inherit] text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed"
            @click="requestClose"
          >
            Cerrar detalle
          </button>
        </header>

        <div class="box-border min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 text-sm sm:px-6">
          <p v-if="loading" role="status" class="m-0 text-slate-600">Consultando el detalle del pago…</p>

          <div v-else-if="error" class="space-y-3 rounded-md border border-red-200 bg-red-50 p-3">
            <p role="alert" class="m-0 text-red-800 [overflow-wrap:anywhere]">{{ error }}</p>
            <button
              type="button"
              class="box-border min-h-11 cursor-pointer rounded-md border border-[#145a8d] bg-white px-4 font-[inherit] text-sm font-semibold text-[#145a8d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
              @click="emit('retry')"
            >
              Reintentar detalle
            </button>
          </div>

          <template v-else-if="payment">
            <div class="flex flex-wrap gap-2" aria-label="Estados del pago">
              <AdminPaymentStateBadge kind="document" :state="payment.estadoDocumental" />
              <AdminPaymentStateBadge kind="financial" :state="payment.estado" />
            </div>

            <dl class="m-0 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-[#f8fafc] p-3 sm:grid-cols-2">
              <div class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Cliente / empresa</dt>
                <dd class="m-0 mt-0.5 font-semibold [overflow-wrap:anywhere]">{{ payment.cliente }} · Cliente #{{ payment.clienteId }}</dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {{ payment.cuentaCorrienteId !== null ? 'Cuenta corriente' : 'Destino' }}
                </dt>
                <dd class="m-0 mt-0.5 font-semibold [overflow-wrap:anywhere]">
                  {{ payment.cuentaCorrienteId !== null ? `#${payment.cuentaCorrienteId}` : `Pedido #${payment.pedidoId}` }}
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Importe original</dt>
                <dd class="m-0 mt-0.5 font-bold">{{ formatPaymentMoney(payment.monto, payment.moneda) }}</dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Moneda</dt>
                <dd class="m-0 mt-0.5">{{ payment.moneda ?? 'No informada' }}</dd>
              </div>
              <div v-if="payment.montoUsd" class="min-w-0 sm:col-span-2">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">USD acreditado</dt>
                <dd class="m-0 mt-0.5 font-semibold [overflow-wrap:anywhere]">
                  {{ formatPaymentMoney(payment.montoUsd, 'USD') }} ·
                  {{ payment.moneda === 'ARS' ? 'conversión confirmada por el backend' : 'importe acreditado' }}
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Estado documental</dt>
                <dd class="m-0 mt-0.5 font-semibold">{{ documentLabel(payment.estadoDocumental) }}</dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Estado financiero</dt>
                <dd class="m-0 mt-0.5 font-semibold">{{ financialLabel(payment.estado) }}</dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Declarado</dt>
                <dd class="m-0 mt-0.5">{{ formatInstant(payment.fecha) }}</dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Revisado</dt>
                <dd class="m-0 mt-0.5">{{ payment.revisadoEn ? formatInstant(payment.revisadoEn) : 'Sin revisar' }}</dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Acreditado</dt>
                <dd class="m-0 mt-0.5">{{ payment.acreditadoEn ? formatInstant(payment.acreditadoEn) : 'Sin acreditar' }}</dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Comprobante</dt>
                <dd class="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 [overflow-wrap:anywhere]">
                  <template v-if="payment.comprobanteId">
                    <span>{{ typeLabel(payment) }} · {{ receiptSize(payment.comprobanteBytes) }}</span>
                    <a
                      :href="`/api/admin/comprobantes/${payment.comprobanteId}`"
                      class="box-border inline-flex min-h-[44px] cursor-pointer items-center font-semibold text-[#145a8d] underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
                    >
                      Descargar comprobante
                    </a>
                  </template>
                  <template v-else>Sin comprobante asociado</template>
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Declarante</dt>
                <dd class="m-0 mt-0.5">{{ payment.declaranteUsuarioId ? `Usuario #${payment.declaranteUsuarioId}` : 'No informado' }}</dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Revisor</dt>
                <dd class="m-0 mt-0.5">{{ payment.revisadoPorUsuarioId ? `Usuario #${payment.revisadoPorUsuarioId}` : 'Sin revisor' }}</dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Acreditador</dt>
                <dd class="m-0 mt-0.5">{{ payment.acreditadoPorUsuarioId ? `Usuario #${payment.acreditadoPorUsuarioId}` : 'Sin acreditador' }}</dd>
              </div>
              <div v-if="payment.movimientoId" class="min-w-0">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Movimiento</dt>
                <dd class="m-0 mt-0.5 [overflow-wrap:anywhere]">#{{ payment.movimientoId }} · {{ payment.movimientoEstado }}</dd>
              </div>
              <div class="min-w-0 sm:col-span-2">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Observaciones</dt>
                <dd class="m-0 mt-0.5 [overflow-wrap:anywhere]">{{ payment.observaciones || 'Sin observaciones' }}</dd>
              </div>
              <div v-if="payment.motivoRevision" class="min-w-0 sm:col-span-2">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Motivo de rechazo documental</dt>
                <dd class="m-0 mt-0.5 [overflow-wrap:anywhere]">{{ payment.motivoRevision }}</dd>
              </div>
              <div v-if="payment.evidenciaAcreditacion" class="min-w-0 sm:col-span-2">
                <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidencia de acreditación</dt>
                <dd class="m-0 mt-0.5 [overflow-wrap:anywhere]">{{ payment.evidenciaAcreditacion }}</dd>
              </div>
            </dl>

            <div
              v-if="canReview(payment) || canAccredit(payment)"
              class="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
            >
              <button
                v-if="canReview(payment)"
                type="button"
                class="box-border min-h-11 cursor-pointer rounded-md border border-[#15803d] bg-[#f0fdf4] px-4 font-[inherit] text-sm font-bold text-[#166534] hover:bg-[#dcfce7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
                @click="emit('review', payment, 'APROBADO')"
              >
                Aprobar documento
              </button>
              <button
                v-if="canReview(payment)"
                type="button"
                class="box-border min-h-11 cursor-pointer rounded-md border border-[#b91c1c] bg-white px-4 font-[inherit] text-sm font-bold text-[#991b1b] hover:bg-[#fef2f2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
                @click="emit('review', payment, 'RECHAZADO')"
              >
                Rechazar documento
              </button>
              <button
                v-if="canAccredit(payment)"
                type="button"
                class="box-border min-h-11 cursor-pointer rounded-md border border-[#b45309] bg-[#b45309] px-4 font-[inherit] text-sm font-bold text-white hover:bg-[#92400e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
                @click="emit('accredit', payment)"
              >
                Acreditar pago
              </button>
            </div>
            <p class="m-0 text-xs text-slate-600 [overflow-wrap:anywhere]">{{ actionHint }}</p>
          </template>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
