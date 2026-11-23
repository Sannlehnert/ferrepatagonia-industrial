<script setup lang="ts">
import { computed } from 'vue'
import type { OrderDocumentState } from '@/types/orderStates'
import { orderDocumentStateBadge } from '@/utils/payment'

const props = defineProps<{
  estadoDocumental?: OrderDocumentState | string | null
  summary?: { total: number; pendientesRevision: number }
}>()

const resolvedState = computed<OrderDocumentState | string | null>(() => {
  if (props.estadoDocumental) return props.estadoDocumental
  if (!props.summary) return null
  if (props.summary.total === 0) return 'SIN_COMPROBANTE'
  if (props.summary.pendientesRevision > 0) return 'PENDIENTE'
  // Sin estadoDocumental explícito del servidor, nunca asumir APROBADO cuando podría estar RECHAZADO.
  return null
})

const badge = computed(() => orderDocumentStateBadge(resolvedState.value))
</script>

<template>
  <span class="inline-flex min-w-[136px] max-w-full flex-col items-start gap-1 text-xs">
    <span
      class="box-border inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold leading-tight"
      :class="badge.badgeClasses"
    >
      <span
        aria-hidden="true"
        class="h-1.5 w-1.5 shrink-0 rounded-full"
        :class="badge.dotClasses"
      />
      <span class="min-w-0 break-words">{{ badge.label }}</span>
    </span>
    <span v-if="summary && summary.total > 0" class="pl-1 text-[#64748B]">
      {{ summary.total }} {{ summary.total === 1 ? 'comprobante' : 'comprobantes' }}<span v-if="summary.pendientesRevision"> · {{ summary.pendientesRevision }} {{ summary.pendientesRevision === 1 ? 'pendiente' : 'pendientes' }}</span>
    </span>
  </span>
</template>
