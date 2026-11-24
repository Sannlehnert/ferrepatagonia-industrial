<script setup lang="ts">
import axios from 'axios'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { accountMoney } from '@/services/adminAccountDto'
import {
  canonicalPrice,
  verifyAdminProductPrice,
  type AdminProduct,
} from '@/services/adminProductService'

const props = defineProps<{ isOpen: boolean; product: AdminProduct | null }>()
const emit = defineEmits<{ close: []; verified: [message: string] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const evidence = ref('')
const confirmed = ref(false)
const submitting = ref(false)
const error = ref('')
const uncertain = ref(false)
let active = true

onBeforeUnmount(() => { active = false })

function reset() {
  evidence.value = ''
  confirmed.value = false
  error.value = ''
  uncertain.value = false
}

function focusForm() {
  void nextTick(() => {
    if (!active || !props.isOpen) return
    dialog.value?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  })
}

watch(
  () => props.isOpen,
  async isOpen => {
    if (!isOpen) {
      if (dialog.value?.open) dialog.value.close()
      return
    }
    reset()
    await nextTick()
    if (!props.isOpen || !dialog.value) return
    if (!dialog.value.open) dialog.value.showModal()
    focusForm()
  },
  { immediate: true },
)

watch(
  () => props.product?.id_producto,
  () => {
    if (!props.isOpen) return
    reset()
    focusForm()
  },
)

function close() {
  if (submitting.value) return
  if (dialog.value?.open) dialog.value.close()
  emit('close')
}

function messageFor(errorValue: unknown): string {
  if (!axios.isAxiosError<{ message?: string; code?: string }>(errorValue)) {
    return 'No se pudo verificar el precio. Reintentá en unos instantes.'
  }
  const code = errorValue.response?.data?.code
  const backendMessage = errorValue.response?.data?.message
  if (code === 'IMPORTE_NO_COINCIDE') {
    return 'El precio cambió desde que abriste el diálogo. Cerrá y volvé a intentar con el precio actual.'
  }
  if (code === 'PRECIO_AUSENTE') return 'El producto no tiene un precio para verificar.'
  if (code === 'PRECIO_BASE_CERO') return 'Un precio cero no puede verificarse.'
  if (code === 'EVIDENCIA_INVALIDA' || code === 'EVIDENCIA_SINTETICA') {
    return typeof backendMessage === 'string' && backendMessage.trim()
      ? backendMessage
      : 'La evidencia no es válida. Indicá el documento, su origen y un localizador verificable.'
  }
  if (code === 'VERIFICACION_NO_CONFIGURADA') {
    return 'La verificación administrativa de precios no está configurada en este entorno.'
  }
  if (code === 'PRODUCTO_INEXISTENTE') return 'El producto ya no existe. Recargá el listado.'
  if (code === 'RESULTADO_DESCONOCIDO') {
    return 'No se pudo confirmar el resultado. Reintentá la verificación; es idempotente.'
  }
  if (typeof backendMessage === 'string' && backendMessage.trim()) return backendMessage
  return 'No se pudo verificar el precio. Reintentá en unos instantes.'
}

async function submit() {
  if (!props.product || submitting.value) return
  const value = evidence.value.trim()
  if (value.length < 8 || value.length > 1000) {
    error.value = 'Indicá una referencia de evidencia de entre 8 y 1000 caracteres.'
    return
  }
  if (!confirmed.value) {
    error.value = 'Confirmá explícitamente que revisaste el precio y la evidencia.'
    return
  }
  const amount = canonicalPrice(props.product.precio)
  if (!amount || amount === '0.00') {
    error.value = 'El precio actual no permite verificación.'
    return
  }

  submitting.value = true
  error.value = ''
  uncertain.value = false
  try {
    const result = await verifyAdminProductPrice(props.product.id_producto, {
      importe: amount,
      evidencia: value,
      confirmar: true,
    })
    if (!active) return
    const publication = result.publicado
      ? 'El precio quedó verificado y FER-17 lo publica para la venta.'
      : `La evidencia quedó registrada, pero FER-17 no publica el precio (${result.estadoFer17}).`
    emit('verified', `Precio verificado. ${publication}`)
  } catch (cause) {
    if (!active) return
    const status = axios.isAxiosError(cause) ? cause.response?.status : undefined
    uncertain.value = !status || status >= 500
    error.value = messageFor(cause)
  } finally {
    if (active) submitting.value = false
  }
}
</script>

<template>
  <dialog
    v-if="isOpen && product"
    ref="dialog"
    class="fixed inset-0 m-auto box-border w-[min(94vw,560px)] max-w-none border-0 bg-transparent p-0 open:flex items-center justify-center"
    aria-labelledby="price-verification-title"
    @cancel.prevent="close"
  >
    <form
      class="w-full rounded-lg border border-[#E2E8F0] bg-white p-4 shadow-xl sm:p-6"
      @submit.prevent="submit"
    >
      <header class="mb-4">
        <h2 id="price-verification-title" class="m-0 text-lg font-bold text-[#0B2438]">
          Verificar precio
        </h2>
        <p class="mt-2 mb-0 text-sm text-slate-600">
          {{ product.nombre }} · SKU {{ product.codigo }}
        </p>
        <p class="mt-1 mb-0 text-sm font-semibold text-[#0B2438]">
          Precio cargado: {{ accountMoney(canonicalPrice(product.precio)) }}
        </p>
      </header>

      <div class="space-y-4">
        <p class="m-0 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          La verificación registra la evidencia comercial y la auditoría FER-17. No cambia el
          importe guardado; el precio actual debe coincidir exactamente.
        </p>

        <label class="grid gap-1 text-sm font-semibold text-[#0B2438]" for="price-evidence">
          Evidencia comercial
          <textarea
            id="price-evidence"
            v-model="evidence"
            required
            maxlength="1000"
            rows="4"
            :disabled="submitting"
            aria-describedby="price-evidence-help"
            class="box-border w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm font-normal text-[#0B2438] disabled:opacity-60"
          />
          <span id="price-evidence-help" class="text-xs font-normal text-slate-600">
            Documento, origen y localizador verificable. No se aceptan referencias genéricas,
            sintéticas ni de demostración.
          </span>
        </label>

        <label class="flex items-start gap-2 text-sm text-[#0B2438]">
          <input
            v-model="confirmed"
            type="checkbox"
            :disabled="submitting"
            class="mt-0.5 h-4 w-4"
          />
          <span>Confirmo que revisé manualmente el precio y la evidencia.</span>
        </label>

        <p v-if="error" role="alert" class="m-0 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {{ error }}
        </p>
        <p v-if="uncertain" role="status" class="m-0 text-sm text-slate-700">
          Si la operación alcanzó a guardarse, reintentar con los mismos datos devuelve el mismo
          resultado sin duplicar la publicación.
        </p>
      </div>

      <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          :disabled="submitting"
          class="box-border min-h-11 rounded-md border border-slate-300 bg-white px-4 py-2 font-[inherit] text-sm font-semibold text-[#0B2438] disabled:opacity-50"
          @click="close"
        >
          Cancelar
        </button>
        <button
          type="submit"
          :disabled="submitting || !confirmed || evidence.trim().length < 8"
          class="box-border min-h-11 rounded-md border-0 bg-[#103A5C] px-4 py-2 font-[inherit] text-sm font-semibold text-white hover:bg-[#145A8D] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {{ submitting ? 'Verificando…' : uncertain ? 'Reintentar verificación' : 'Verificar precio' }}
        </button>
      </div>
    </form>
  </dialog>
</template>
