<script setup lang="ts">
import type { OrderReceiptStatus } from '@/composables/useOrderReceiptSummaries'

defineProps<{ status: OrderReceiptStatus; orderNumber: string }>()
const emit = defineEmits<{ open: []; retry: [] }>()

const labels: Record<OrderReceiptStatus, string> = {
  NO_ADJUNTO: 'No adjunto',
  PENDIENTE: 'Pendiente de revisión',
  APROBADO: 'Aprobado',
  RECHAZADO: 'Rechazado',
  NO_DISPONIBLE: 'No disponible para esta modalidad',
  CARGANDO: 'Consultando comprobantes…',
  ERROR: 'Estado no disponible',
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <span
      class="rounded-full px-2.5 py-1 text-xs font-medium"
      :class="status === 'APROBADO' ? 'bg-emerald-50 text-emerald-800'
        : status === 'RECHAZADO' ? 'bg-red-50 text-red-700'
        : status === 'PENDIENTE' ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-600'"
    >{{ labels[status] }}</span>
    <button
      v-if="status !== 'NO_DISPONIBLE'"
      type="button"
      class="box-border min-h-[44px] min-w-[44px] cursor-pointer rounded border border-solid border-[#103A5C] bg-white px-3 font-[inherit] text-xs font-semibold text-[#103A5C] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
      :aria-label="`Ver comprobantes de ${orderNumber}`"
      @click="emit('open')"
    >Ver / adjuntar</button>
    <button v-if="status === 'ERROR'" type="button" class="box-border min-h-[44px] min-w-[44px] cursor-pointer border-0 bg-transparent px-2 py-1 font-[inherit] text-xs text-[#103A5C] underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
      :aria-label="`Reintentar estado de comprobantes de ${orderNumber}`" @click="emit('retry')">
      Reintentar
    </button>
  </div>
</template>
