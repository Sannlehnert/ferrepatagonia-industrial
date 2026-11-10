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
  <section aria-label="Comprobantes de pago" class="mt-5 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
    <h3 v-if="mode !== 'admin'" class="m-0 text-lg font-semibold">Comprobantes de pago</h3>
    <p v-if="mode === 'cuenta'" class="m-0 text-sm text-slate-600">
      Cargá aquí transferencias para el saldo general. Si la transferencia corresponde a un pedido,
      adjuntala desde su detalle en <RouterLink :to="{ name: 'cuenta-pedidos' }" class="underline">Mis pedidos</RouterLink>.
    </p>
    <form v-if="mode !== 'admin'" class="space-y-2" @submit.prevent="upload">
      <label class="block text-sm font-medium">
        Archivo (PDF, JPG o PNG, hasta 5 MB)
        <input ref="fileInput" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
          class="mt-1 block max-w-full text-sm" :disabled="busy" @change="selectFile" />
      </label>
      <button type="submit" class="receipt-action" :disabled="!selectedFile || busy">
        {{ busy ? 'Subiendo…' : 'Adjuntar comprobante' }}
      </button>
    </form>

    <p v-if="notice" role="status" class="m-0 text-sm">{{ notice }}</p>
    <p v-if="failure" role="alert" class="m-0 text-sm text-red-800">{{ failure }}</p>
    <p v-if="loading" role="status" class="m-0 text-sm">Cargando comprobantes…</p>
    <div v-else-if="error" class="space-y-2">
      <p role="alert" class="m-0 text-sm">No se pudieron cargar los comprobantes.</p>
      <button type="button" class="receipt-action" @click="reload(page)">Reintentar comprobantes</button>
    </div>
    <template v-else-if="data">
      <p v-if="data.items.length === 0" class="m-0 text-sm text-slate-600">Todavía no hay comprobantes.</p>
      <ul v-else class="m-0 list-none divide-y divide-slate-200 p-0">
        <li v-for="receipt in data.items" :key="receipt.id" class="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
          <div class="min-w-0">
            <p v-if="mode === 'admin'" class="m-0 break-words font-semibold">{{ receipt.cliente }} · Cliente {{ receipt.clienteId }}</p>
            <p class="m-0">
              {{ operation(receipt) }} · {{ typeLabels[receipt.tipoMime] }} · {{ formatInstant(receipt.fecha) }}
            </p>
            <p class="m-0 text-slate-600">
              {{ receipt.estadoRevision === 'REVISADO' ? 'Revisado' : 'Pendiente de revisión' }}
              <span v-if="receipt.revisadoEn"> · {{ formatInstant(receipt.revisadoEn) }}</span>
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <a class="receipt-action" :href="'/api' + path + '/' + receipt.id">Descargar comprobante</a>
            <button v-if="mode === 'admin' && receipt.estadoRevision === 'PENDIENTE'" type="button"
              class="receipt-action" :disabled="busy" @click="review(receipt.id)">Marcar revisado</button>
          </div>
        </li>
      </ul>
      <div v-if="page > 1 || data.paginaSiguiente" class="flex flex-wrap gap-2">
        <button v-if="page > 1" type="button" class="receipt-action" @click="reload(page - 1)">Anterior</button>
        <button v-if="data.paginaSiguiente" type="button" class="receipt-action"
          @click="reload(data.paginaSiguiente)">Siguiente</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.receipt-action {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  padding: .4rem .75rem;
  border: 1px solid #103a5c;
  border-radius: .375rem;
  color: #103a5c;
}
.receipt-action:disabled { opacity: .5; }
</style>
