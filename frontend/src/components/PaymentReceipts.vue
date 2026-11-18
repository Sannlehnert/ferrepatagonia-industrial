<script setup lang="ts">
import { isAxiosError } from 'axios'
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import {
  listPaymentReceipts, markPaymentReceiptReviewed, uploadPaymentReceipt,
  type PaymentReceipt, type ReceiptPage,
} from '@/services/paymentReceiptService'
import { useAuthStore } from '@/stores/auth'
import { formatInstant } from '@/utils/cuentaCorriente'

const props = defineProps<{ path: string; mode: 'pedido' | 'cuenta' | 'admin' }>()
const auth = useAuthStore()
const identity = () => [auth.user?.id, auth.rol, auth.sessionVersion, props.path].join(':')
const allowed = () => auth.isAuthenticated && auth.rol === (props.mode === 'admin' ? 'ADMIN' : 'CLIENTE')
const { data, loading, error, load } = usePrivateAccountRead<ReceiptPage>(identity, allowed)
const page = ref(1)
const fileInput = ref<HTMLInputElement | null>(null)
const selectedFile = shallowRef<File | null>(null)
const busy = ref(false)
const notice = ref('')
const failure = ref('')
let mutation: AbortController | undefined

const typeLabels = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG' }
const mutationErrors = {
  ARCHIVO_VACIO: 'Seleccioná un archivo con contenido.',
  ARCHIVO_DEMASIADO_GRANDE: 'El comprobante debe pesar hasta 5 MB.',
  TIPO_NO_PERMITIDO: 'Seleccioná un archivo PDF, JPG o PNG.',
  CONTENIDO_INVALIDO: 'El archivo está dañado, contiene elementos no permitidos o no coincide con su tipo.',
} as const

function reload(number = 1) {
  page.value = number
  return load(signal => listPaymentReceipts(props.path, number, signal))
}

function clearFile() {
  selectedFile.value = null
  if (fileInput.value) fileInput.value.value = ''
}

function reset() {
  mutation?.abort()
  busy.value = false
  notice.value = ''
  failure.value = ''
  clearFile()
}

watch(identity, () => {
  reset()
  void reload()
}, { flush: 'sync', immediate: true })
onBeforeUnmount(reset)

function selectFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  failure.value = ''
  notice.value = ''
  selectedFile.value = file ?? null
  if (file && (file.size === 0 || file.size > 5 * 1024 * 1024 || !Object.hasOwn(typeLabels, file.type))) {
    failure.value = 'Seleccioná un PDF, JPG o PNG con contenido y de hasta 5 MB.'
    clearFile()
  }
}

function handleDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0]
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
    notice.value = message
    clearFile()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ferrepatagonia:receipt-uploaded', { detail: { path: props.path } }))
    }
    await reload(props.mode === 'admin' ? page.value : 1)
  } catch (cause) {
    if (!valid()) return
    const code: unknown = isAxiosError(cause) ? cause.response?.data?.code : undefined
    failure.value = typeof code === 'string' && Object.hasOwn(mutationErrors, code)
      ? mutationErrors[code as keyof typeof mutationErrors]
      : 'No se pudo procesar el comprobante. Reintentá en unos instantes.'
  } finally {
    if (valid()) busy.value = false
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
  void mutate(async signal => {
    await markPaymentReceiptReviewed(props.path, id, signal)
    return 'Revisión documental registrada.'
  })
}

function operation(receipt: PaymentReceipt) {
  if (receipt.pedidoId !== null) return 'Pedido PED-' + String(receipt.pedidoId).padStart(6, '0')
  return 'Saldo general de cuenta corriente'
}
</script>

<template>
  <section aria-label="Comprobantes de pago" class="mt-5 space-y-4 rounded-[10px] border border-[#E2E8F0] bg-white p-4 sm:p-6 shadow-sm">
    <h3 v-if="mode !== 'admin'" class="m-0 text-lg font-bold text-[#0B2438]">Comprobantes de pago</h3>
    <p v-if="mode === 'cuenta'" class="m-0 text-sm text-slate-600">
      Cargá aquí transferencias para el saldo general. Si la transferencia corresponde a un pedido,
      adjuntala desde su detalle en <RouterLink :to="{ name: 'cuenta-pedidos' }" class="text-[#145A8D] font-semibold underline focus-visible:outline-2 focus-visible:outline-[#145A8D]">Mis pedidos</RouterLink>.
    </p>

    <form v-if="mode !== 'admin'" class="space-y-4" @submit.prevent="upload">
      <label
        class="border-2 border-dashed border-[#CBD5E1] rounded-[10px] p-6 sm:p-8 w-full flex flex-col items-center justify-center gap-3 bg-[#F8FAFC] hover:bg-slate-50 transition cursor-pointer text-center"
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
          class="hidden"
          :disabled="busy"
          @change="selectFile"
        />
      </label>

      <div class="flex flex-wrap items-center gap-3">
        <button
          v-if="selectedFile"
          type="button"
          class="bg-[#94A3B8] hover:bg-[#64748B] text-white font-semibold rounded-[8px] px-6 py-2 min-h-[44px] min-w-[100px] text-sm transition cursor-pointer"
          :disabled="busy"
          @click="clearFile"
        >
          Cancelar
        </button>
        <button
          type="submit"
          class="bg-[#16A34A] hover:bg-[#15803D] text-white font-semibold rounded-[8px] px-6 py-2 min-h-[44px] min-w-[100px] text-sm transition shadow-sm disabled:opacity-50 cursor-pointer"
          :disabled="!selectedFile || busy"
          :aria-label="busy ? 'Subiendo…' : 'Adjuntar comprobante'"
        >
          {{ busy ? 'Subiendo…' : 'Adjuntar comprobante' }}
        </button>
      </div>
    </form>

    <p v-if="notice" role="status" class="m-0 text-sm font-medium text-[#16A34A]">{{ notice }}</p>
    <p v-if="failure" role="alert" class="m-0 text-sm font-medium text-[#DC2626]">{{ failure }}</p>
    <p v-if="loading" role="status" class="m-0 text-sm text-slate-500">Cargando comprobantes…</p>
    <div v-else-if="error" class="space-y-2">
      <p role="alert" class="m-0 text-sm text-[#DC2626]">No se pudieron cargar los comprobantes.</p>
      <button type="button" class="receipt-action" @click="reload(page)">Reintentar comprobantes</button>
    </div>
    <template v-else-if="data">
      <p v-if="data.items.length === 0" class="m-0 text-sm text-slate-600">Todavía no hay comprobantes.</p>
      <ul v-else class="m-0 list-none divide-y divide-slate-200 p-0">
        <li
          v-for="receipt in data.items"
          :key="receipt.id"
          class="flex flex-col gap-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div class="min-w-0 flex-1 space-y-1">
            <p v-if="mode === 'admin'" class="m-0 break-words font-semibold text-[#0B2438]">{{ receipt.cliente }} · Cliente {{ receipt.clienteId }}</p>
            <p class="m-0 [overflow-wrap:anywhere] text-slate-700">
              {{ operation(receipt) }} · {{ typeLabels[receipt.tipoMime] }} · {{ formatInstant(receipt.fecha) }}
            </p>
            <p class="m-0 flex flex-wrap items-center gap-1.5 text-slate-600">
              <span
                class="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold"
                :class="receipt.estadoRevision === 'REVISADO'
                  ? 'bg-[#DCFCE7] text-[#16A34A] border border-emerald-200'
                  : 'bg-[#FEF3C7] text-[#D97706] border border-amber-200'"
              >
                {{ receipt.estadoRevision === 'REVISADO' ? 'Revisado' : 'Pendiente de revisión' }}
              </span>
              <span v-if="receipt.revisadoEn" class="text-xs text-slate-500">· {{ formatInstant(receipt.revisadoEn) }}</span>
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <a class="receipt-action" :href="'/api' + path + '/' + receipt.id">Descargar comprobante</a>
            <button
              v-if="mode === 'admin' && receipt.estadoRevision === 'PENDIENTE'"
              type="button"
              class="receipt-action"
              :disabled="busy"
              @click="review(receipt.id)"
            >
              Marcar revisado
            </button>
          </div>
        </li>
      </ul>
      <div v-if="page > 1 || data.paginaSiguiente" class="flex flex-wrap gap-2 pt-2">
        <button v-if="page > 1" type="button" class="receipt-action" @click="reload(page - 1)">Anterior</button>
        <button v-if="data.paginaSiguiente" type="button" class="receipt-action"
          @click="reload(data.paginaSiguiente)">Siguiente</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.receipt-action {
  box-sizing: border-box;
  display: inline-flex;
  min-height: 44px;
  min-width: 44px;
  align-items: center;
  justify-content: center;
  padding: .5rem .875rem;
  border: 1px solid #103A5C;
  border-radius: 8px;
  background-color: transparent;
  color: #103A5C;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: background-color .15s ease, border-color .15s ease, color .15s ease;
}
.receipt-action:hover:not(:disabled) {
  background-color: #f1f5f9;
}
.receipt-action:focus-visible {
  outline: 2px solid #145A8D;
  outline-offset: 2px;
}
.receipt-action:disabled {
  opacity: .5;
  cursor: not-allowed;
}
</style>
