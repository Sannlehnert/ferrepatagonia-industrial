<script setup lang="ts">
import { isAxiosError } from 'axios'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useDeferredRealtimeReconcile } from '@/composables/useDeferredRealtimeReconcile'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import {
  listPaymentReceipts, markPaymentReceiptReviewed, uploadPaymentReceipt,
  type PaymentReceipt, type ReceiptPage, type ReceiptReviewStatus,
} from '@/services/paymentReceiptService'
import { onRealtime } from '@/services/realtime'
import { useAuthStore } from '@/stores/auth'
import { formatInstant } from '@/utils/cuentaCorriente'
import { newIdempotencyKey, receiptBadge } from '@/utils/payment'

const props = defineProps<{ path: string; mode: 'pedido' | 'cuenta' | 'admin' }>()
const emit = defineEmits<{ updated: [] }>()
const auth = useAuthStore()
const identity = () => [auth.user?.id, auth.rol, auth.sessionVersion, props.path].join(':')
const allowed = () => auth.isAuthenticated && !auth.loggingIn && !auth.loggingOut
  && auth.rol === (props.mode === 'admin' ? 'ADMIN' : 'CLIENTE')
const { data, loading, error, load } = usePrivateAccountRead<ReceiptPage>(identity, allowed)
const page = ref(1)
const statusFilter = ref<'' | ReceiptReviewStatus>('')
const fileInput = ref<HTMLInputElement | null>(null)
const selectedFile = shallowRef<File | null>(null)
const busy = ref(false)
const notice = ref('')
const failure = ref('')
const rejectingReceiptId = ref<string | null>(null)
const rejectReason = ref('')
const rejectValidationError = ref('')
let mutation: AbortController | undefined
const realtimeReconcile = useDeferredRealtimeReconcile({
  allowed,
  isMutating: () => busy.value,
  reconcile: () => {
    void load(signal => listPaymentReceipts(props.path, page.value, signal), { keepData: true })
  },
})

const scopedOrderId = computed(() => {
  if (props.mode !== 'pedido') return null
  const match = /^\/pedidos\/(\d+)\/comprobantes$/.exec(props.path)
  return match ? Number(match[1]) : null
})

const actionButtonClass =
  'box-border inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-[8px] border border-solid border-[#103A5C] bg-white px-3.5 py-2 font-[inherit] text-sm font-semibold text-[#103A5C] no-underline transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] disabled:cursor-not-allowed disabled:opacity-50'
const rejectButtonClass =
  'box-border inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-[8px] border border-solid border-[#DC2626] bg-white px-3.5 py-2 font-[inherit] text-sm font-semibold text-[#B91C1C] transition-colors hover:bg-[#FEE2E2] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] disabled:cursor-not-allowed disabled:opacity-50'

const typeLabels = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG' }
const mutationErrors = {
  ARCHIVO_VACIO: 'Seleccioná un archivo con contenido.',
  ARCHIVO_DEMASIADO_GRANDE: 'El comprobante debe pesar hasta 5 MB.',
  TIPO_NO_PERMITIDO: 'Seleccioná un archivo PDF, JPG o PNG.',
  CONTENIDO_INVALIDO: 'El archivo está dañado, contiene elementos no permitidos o no coincide con su tipo.',
  ARCHIVO_DANADO: 'El archivo está dañado o incompleto. Probá con otro archivo.',
  CONTENIDO_NO_PERMITIDO: 'El archivo contiene elementos activos o incrustados no permitidos. Probá con un PDF o una imagen simple.',
  TIPO_INCOMPATIBLE: 'El archivo no coincide con el formato declarado. Verificá que sea PDF, JPG o PNG.',
  COMPROBANTE_YA_RESUELTO: 'Este comprobante ya fue resuelto anteriormente.',
  CLAVE_IDEMPOTENCIA_REQUERIDA: 'No se pudo generar la clave de idempotencia. Reintentá la operación.',
  CLAVE_IDEMPOTENCIA_REUTILIZADA: 'La clave de idempotencia ya fue utilizada con otros datos.',
  CONFLICTO_CONCURRENCIA: 'El comprobante cambió de estado concurrentemente. Actualizá la lista.',
  SOLICITUD_INVALIDA: 'El motivo de rechazo debe tener entre 1 y 1000 caracteres.',
} as const

const visibleItems = computed(() => {
  const items = data.value?.items ?? []
  if (props.mode !== 'admin' || !statusFilter.value) return items
  return items.filter(item => item.estadoRevision === statusFilter.value)
})

function reload(number = 1) {
  page.value = number
  return load(signal => listPaymentReceipts(props.path, number, signal))
}

function clearFile() {
  selectedFile.value = null
  if (fileInput.value) fileInput.value.value = ''
}

function closeRejectForm() {
  rejectingReceiptId.value = null
  rejectReason.value = ''
  rejectValidationError.value = ''
}

function openRejectForm(id: string) {
  if (busy.value) return
  failure.value = ''
  notice.value = ''
  rejectingReceiptId.value = id
  rejectReason.value = ''
  rejectValidationError.value = ''
}

function reset() {
  mutation?.abort()
  busy.value = false
  realtimeReconcile.reset()
  notice.value = ''
  failure.value = ''
  statusFilter.value = ''
  closeRejectForm()
  clearFile()
}

watch([identity, allowed], () => {
  reset()
  void reload()
}, { flush: 'sync', immediate: true })
onBeforeUnmount(reset)

onRealtime(change => {
  if (!allowed()) return
  const matchesScope = props.mode === 'pedido'
    ? (scopedOrderId.value !== null && change.orders.has(scopedOrderId.value))
    : change.receipts
  if (!change.reconnect && !matchesScope) return
  realtimeReconcile.notify(change.reconnect)
})

function selectFile(event: Event) {
  setFile((event.target as HTMLInputElement).files?.[0])
}

function handleDrop(event: DragEvent) {
  setFile(event.dataTransfer?.files?.[0])
}

function setFile(file?: File) {
  if (!allowed() || busy.value) return
  failure.value = ''
  notice.value = ''
  selectedFile.value = file ?? null
  if (file && (file.size === 0 || file.size > 5 * 1024 * 1024 || !Object.hasOwn(typeLabels, file.type))) {
    failure.value = 'Seleccioná un PDF, JPG o PNG con contenido y de hasta 5 MB.'
    clearFile()
  }
}

async function mutate(work: (signal: AbortSignal) => Promise<string>) {
  if (!allowed() || busy.value) return
  const current = identity()
  const controller = new AbortController()
  mutation = controller
  const valid = () => !controller.signal.aborted && identity() === current && allowed()
  busy.value = true
  failure.value = ''
  notice.value = ''
  try {
    const message = await work(controller.signal)
    if (!valid()) return
    realtimeReconcile.suppress(800)
    notice.value = message
    clearFile()
    closeRejectForm()
    await reload(props.mode === 'admin' ? page.value : 1)
    if (valid()) emit('updated')
  } catch (cause) {
    if (!valid()) return
    const code: unknown = isAxiosError(cause) ? cause.response?.data?.code : undefined
    failure.value = typeof code === 'string' && Object.hasOwn(mutationErrors, code)
      ? mutationErrors[code as keyof typeof mutationErrors]
      : 'No se pudo procesar el comprobante. Reintentá en unos instantes.'
  } finally {
    if (valid()) {
      busy.value = false
      realtimeReconcile.settleAfterMutation()
    }
  }
}

function upload() {
  const file = selectedFile.value
  if (!file) return
  void mutate(async signal => await uploadPaymentReceipt(props.path, file, signal)
    ? 'Comprobante recibido. La acreditación del pago se gestiona por separado.'
    : 'Este comprobante ya estaba registrado para la operación.')
}

function review(id: string) {
  closeRejectForm()
  void mutate(async signal => {
    await markPaymentReceiptReviewed(
      props.path,
      id,
      signal,
      { estado: 'APROBADO' },
      newIdempotencyKey(),
    )
    return 'Comprobante aprobado documentalmente. La acreditación financiera del pago se gestiona por separado.'
  })
}

function confirmReject(id: string) {
  const trimmed = rejectReason.value.trim()
  if (trimmed.length < 1 || trimmed.length > 1000) {
    rejectValidationError.value = 'Ingresá un motivo de rechazo entre 1 y 1000 caracteres.'
    return
  }
  rejectValidationError.value = ''
  void mutate(async signal => {
    await markPaymentReceiptReviewed(
      props.path,
      id,
      signal,
      { estado: 'RECHAZADO', motivo: trimmed },
      newIdempotencyKey(),
    )
    return 'Comprobante rechazado documentalmente. El cliente podrá cargar un nuevo comprobante.'
  })
}

function operation(receipt: PaymentReceipt) {
  if (receipt.pedidoId !== null) return 'Pedido PED-' + String(receipt.pedidoId).padStart(6, '0')
  return 'Saldo general de cuenta corriente'
}
</script>

<template>
  <section aria-label="Comprobantes de pago" class="mt-5 space-y-4 rounded-[10px] border border-solid border-[#E2E8F0] bg-white p-4 sm:p-6 shadow-sm">
    <h3 v-if="mode !== 'admin'" class="m-0 text-lg font-bold text-[#0B2438]">Comprobantes de pago</h3>
    <p v-if="mode === 'cuenta'" class="m-0 text-sm text-slate-600">
      Cargá aquí transferencias para el saldo general. Si la transferencia corresponde a un pedido,
      adjuntala desde su detalle en <RouterLink :to="{ name: 'cuenta-pedidos' }" class="text-[#145A8D] font-semibold underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]">Mis pedidos</RouterLink>.
    </p>

    <div
      v-if="mode === 'admin'"
      class="flex flex-col gap-3 rounded-lg border border-solid border-[#E2E8F0] bg-[#F8FAFC] p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p class="m-0 text-xs text-slate-600">
        La aprobación o rechazo es únicamente documental: no acredita pagos ni modifica el estado comercial del pedido ni el saldo de cuenta corriente.
      </p>
      <label class="flex min-w-0 max-w-full flex-col items-stretch gap-1 text-xs font-semibold text-slate-600 sm:shrink-0 sm:flex-row sm:items-center sm:gap-2">
        <span>Estado documental:</span>
        <select
          v-model="statusFilter"
          aria-label="Filtrar comprobantes por estado documental"
          class="box-border min-h-[44px] w-full min-w-0 max-w-full cursor-pointer rounded-lg border border-solid border-[#CBD5E1] bg-white px-3 py-1.5 font-[inherit] text-sm font-medium text-[#0B2438] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] sm:w-auto"
        >
          <option value="">Todos</option>
          <option value="PENDIENTE">Pendiente de revisión</option>
          <option value="APROBADO">Aprobado</option>
          <option value="RECHAZADO">Rechazado</option>
        </select>
      </label>
    </div>

    <form v-if="mode !== 'admin'" class="space-y-4" @submit.prevent="upload">
      <label
        class="box-border min-w-0 max-w-full focus-within:outline-2 focus-within:outline-[#145A8D] border-2 border-dashed border-[#CBD5E1] rounded-[10px] p-6 sm:p-8 w-full flex flex-col items-center justify-center gap-3 bg-[#F8FAFC] hover:bg-slate-50 transition cursor-pointer text-center"
        @dragover.prevent
        @drop.prevent="handleDrop"
      >
        <svg class="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <span class="text-xs sm:text-sm font-semibold text-slate-700">
          Subir Comprobante de Transferencia (Click o arrastrar)
        </span>
        <span class="text-xs text-slate-500">
          {{ selectedFile ? selectedFile.name : 'Archivo (PDF, JPG o PNG, hasta 5 MB)' }}
        </span>
        <input
          ref="fileInput"
          type="file"
          aria-label="Archivo (PDF, JPG o PNG, hasta 5 MB)"
          accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
          class="sr-only"
          :disabled="busy"
          @change="selectFile"
        />
      </label>

      <div class="flex flex-wrap items-center gap-3">
        <button
          v-if="selectedFile"
          type="button"
          class="box-border cursor-pointer border-0 border-solid bg-[#475569] px-6 py-2 font-[inherit] text-sm font-semibold text-white transition hover:bg-[#334155] min-h-[44px] min-w-[100px] rounded-[8px] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
          :disabled="busy"
          @click="clearFile"
        >
          Cancelar
        </button>
        <button
          type="submit"
          class="box-border cursor-pointer border-0 border-solid bg-[#15803D] px-6 py-2 font-[inherit] text-sm font-semibold text-white shadow-sm transition hover:bg-[#166534] disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px] min-w-[100px] rounded-[8px] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
          :disabled="!selectedFile || busy"
          :aria-label="busy ? 'Subiendo…' : 'Adjuntar comprobante'"
        >
          {{ busy ? 'Subiendo…' : 'Adjuntar comprobante' }}
        </button>
      </div>
    </form>

    <p v-if="notice" role="status" class="m-0 text-sm font-medium text-green-800">{{ notice }}</p>
    <p v-if="failure" role="alert" class="m-0 text-sm font-medium text-red-800">{{ failure }}</p>
    <p v-if="loading && !data" role="status" class="m-0 text-sm text-slate-600">Cargando comprobantes…</p>
    <div v-else-if="error" class="space-y-2">
      <p role="alert" class="m-0 text-sm font-medium text-red-800">No se pudieron cargar los comprobantes.</p>
      <button type="button" :class="actionButtonClass" @click="reload(page)">Reintentar comprobantes</button>
    </div>
    <template v-else-if="data">
      <p v-if="data.items.length === 0" class="m-0 text-sm text-slate-600">Todavía no hay comprobantes.</p>
      <p v-else-if="visibleItems.length === 0" class="m-0 text-sm text-slate-600">
        No hay comprobantes con el estado documental seleccionado en esta página.
      </p>
      <ul v-else class="m-0 list-none divide-y divide-slate-200 p-0">
        <li
          v-for="receipt in visibleItems"
          :key="receipt.id"
          class="flex flex-col gap-3 py-3 text-sm"
        >
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0 flex-1 space-y-1.5">
              <p v-if="mode === 'admin'" class="m-0 break-words font-semibold text-[#0B2438]">
                {{ receipt.cliente }} · Cliente {{ receipt.clienteId }}
              </p>
              <p class="m-0 [overflow-wrap:anywhere] text-slate-700">
                {{ operation(receipt) }} · {{ typeLabels[receipt.tipoMime] }} · {{ formatInstant(receipt.fecha) }}
              </p>
              <div class="flex flex-wrap items-center gap-2 text-slate-600">
                <span
                  class="box-border inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  :class="receiptBadge(receipt.estadoRevision).badgeClasses"
                >
                  <span
                    aria-hidden="true"
                    class="h-1.5 w-1.5 shrink-0 rounded-full"
                    :class="receiptBadge(receipt.estadoRevision).dotClasses"
                  />
                  {{ receiptBadge(receipt.estadoRevision).label }}
                </span>
                <span v-if="receipt.revisadoEn" class="text-xs text-slate-500">
                  · Revisado {{ formatInstant(receipt.revisadoEn) }}
                </span>
              </div>
              <p
                v-if="receipt.estadoRevision === 'APROBADO'"
                class="m-0 text-xs text-slate-600"
              >
                Revisión documental aprobada. No implica acreditación financiera del pago.
              </p>
              <div
                v-if="receipt.estadoRevision === 'RECHAZADO'"
                class="rounded-md border border-solid border-[#FECACA] bg-[#FEE2E2]/60 px-3 py-2 text-xs text-[#B91C1C]"
              >
                <p v-if="receipt.motivoRechazo" class="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  <strong class="font-semibold">Motivo de rechazo:</strong> {{ receipt.motivoRechazo }}
                </p>
                <p v-else class="m-0 font-medium">
                  Comprobante rechazado por administración.
                </p>
                <p v-if="mode !== 'admin'" class="m-0 mt-1 text-slate-700">
                  Podés adjuntar un nuevo comprobante para una nueva revisión documental.
                </p>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <a :class="actionButtonClass" :href="'/api' + path + '/' + receipt.id">Descargar comprobante</a>
              <button
                v-if="mode === 'admin' && receipt.estadoRevision === 'PENDIENTE'"
                type="button"
                :class="actionButtonClass"
                :disabled="busy"
                @click="review(receipt.id)"
              >
                Aprobar comprobante
              </button>
              <button
                v-if="mode === 'admin' && receipt.estadoRevision === 'PENDIENTE'"
                type="button"
                :class="rejectButtonClass"
                :disabled="busy"
                :aria-expanded="rejectingReceiptId === receipt.id"
                @click="openRejectForm(receipt.id)"
              >
                Rechazar comprobante
              </button>
            </div>
          </div>

          <form
            v-if="mode === 'admin' && receipt.estadoRevision === 'PENDIENTE' && rejectingReceiptId === receipt.id"
            class="space-y-3 rounded-lg border border-solid border-[#FECACA] bg-[#FEE2E2]/30 p-3"
            @submit.prevent="confirmReject(receipt.id)"
          >
            <label class="grid gap-1 text-xs font-semibold text-[#0B2438]">
              <span>Motivo de rechazo documental (obligatorio)</span>
              <textarea
                v-model="rejectReason"
                rows="3"
                maxlength="1000"
                :disabled="busy"
                placeholder="Indicá el motivo (ej. archivo ilegible, importe no coincidente o corresponde a otra operación)"
                class="box-border min-h-[44px] w-full min-w-0 rounded-md border border-solid border-[#CBD5E1] bg-white px-3 py-2 font-[inherit] text-sm font-normal text-[#0B2438] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] disabled:cursor-not-allowed disabled:opacity-60"
              />
              <span class="font-normal text-slate-600">{{ rejectReason.trim().length }} / 1000 caracteres</span>
            </label>
            <p v-if="rejectValidationError" role="alert" class="m-0 text-xs font-semibold text-red-800">
              {{ rejectValidationError }}
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                class="box-border inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-[8px] border border-transparent bg-[#DC2626] px-4 py-2 font-[inherit] text-sm font-semibold text-white transition-colors hover:bg-[#B91C1C] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="busy || rejectReason.trim().length === 0"
              >
                Confirmar rechazo
              </button>
              <button
                type="button"
                class="box-border inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-[8px] border border-solid border-slate-300 bg-white px-4 py-2 font-[inherit] text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="busy"
                @click="closeRejectForm"
              >
                Cancelar
              </button>
            </div>
          </form>
        </li>
      </ul>
      <div v-if="page > 1 || data.paginaSiguiente" class="flex flex-wrap gap-2 pt-2">
        <button v-if="page > 1" type="button" :class="actionButtonClass" @click="reload(page - 1)">Anterior</button>
        <button v-if="data.paginaSiguiente" type="button" :class="actionButtonClass"
          @click="reload(data.paginaSiguiente)">Siguiente</button>
      </div>
    </template>
  </section>
</template>