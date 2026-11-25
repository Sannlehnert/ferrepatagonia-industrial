<script setup lang="ts">
import { computed } from 'vue'
import type { OrderDocumentState, OrderFinancialState } from '@/types/orderStates'
import {
  formatAccreditedUsdSummary,
  orderFinancialStateBadge,
  orderFinancialStateExplanation,
} from '@/utils/payment'

const props = withDefaults(defineProps<{
  status?: OrderFinancialState | string | null
  montoAcreditadoUsd?: string | null
  documentStatus?: OrderDocumentState | string | null
  compact?: boolean
  showExplanation?: boolean
}>(), {
  status: null,
  montoAcreditadoUsd: null,
  documentStatus: null,
  compact: false,
  showExplanation: false,
})

const badge = computed(() => orderFinancialStateBadge(props.status))
const accreditedSummary = computed(() =>
  formatAccreditedUsdSummary(props.status, props.montoAcreditadoUsd),
)
const explanation = computed(() =>
  props.showExplanation
    ? orderFinancialStateExplanation(props.status, props.documentStatus)
    : '',
)
</script>

<template>
  <div class="inline-flex min-w-0 max-w-full flex-col items-start gap-1">
    <span
      class="box-border inline-flex max-w-full items-center gap-1.5 rounded-xl px-2.5 py-1 text-left text-xs font-semibold leading-snug"
      :class="badge.badgeClasses"
    >
      <span
        aria-hidden="true"
        class="h-1.5 w-1.5 shrink-0 rounded-full"
        :class="badge.dotClasses"
      />
      <span class="min-w-0 break-words">{{ badge.label }}</span>
    </span>
    <span
      v-if="accreditedSummary"
      class="text-xs font-medium tabular-nums text-slate-600"
    >
      {{ accreditedSummary }}
    </span>
    <p
      v-if="explanation"
      class="m-0 text-xs leading-relaxed text-slate-600"
    >
      {{ explanation }}
    </p>
  </div>
</template>
