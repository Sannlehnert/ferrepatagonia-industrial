<script setup lang="ts">
import { computed } from 'vue'
import type { OrderReceiptStatus } from '@/composables/useOrderReceiptSummaries'
import { orderDocumentStateBadge, STATE_BADGE_TONES } from '@/utils/payment'

const props = defineProps<{ status: OrderReceiptStatus; orderNumber: string }>()
const emit = defineEmits<{ open: []; retry: [] }>()

const badge = computed(() => {
  if (
    props.status === 'APROBADO' ||
    props.status === 'PENDIENTE' ||
    props.status === 'RECHAZADO' ||
    props.status === 'NO_ADJUNTO'
  ) {
    return orderDocumentStateBadge(props.status, { emptyLabel: 'No adjunto' })
  }
  if (props.status === 'NO_DISPONIBLE') {
    return { label: 'No disponible para esta modalidad', ...STATE_BADGE_TONES.neutral }
  }
  if (props.status === 'CARGANDO') {
    return { label: 'Consultando comprobantes…', ...STATE_BADGE_TONES.neutral }
  }
  return { label: 'Estado no disponible', ...STATE_BADGE_TONES.neutral }
})
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <span
      class="box-border inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold leading-tight"
      :class="badge.badgeClasses"
    >
      <span
        aria-hidden="true"
        class="h-1.5 w-1.5 shrink-0 rounded-full"
        :class="badge.dotClasses"
      />
      <span>{{ badge.label }}</span>
    </span>
    <button
      v-if="status !== 'NO_DISPONIBLE'"
      type="button"
      class="box-border inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded border border-[#103A5C] bg-white px-3 font-[inherit] text-xs font-semibold text-[#103A5C] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
      :aria-label="`Ver comprobantes de ${orderNumber}`"
      @click="emit('open')"
    >
      {{ status === 'RECHAZADO' ? 'Cargar nuevo' : 'Ver / adjuntar' }}
    </button>
    <button
      v-if="status === 'ERROR'"
      type="button"
      class="box-border inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center border-0 bg-transparent px-2 font-[inherit] text-xs font-semibold text-[#145A8D] underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
      :aria-label="`Reintentar estado de comprobantes de ${orderNumber}`"
      @click="emit('retry')"
    >
      Reintentar
    </button>
  </div>
</template>
