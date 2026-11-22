<script setup lang="ts">
import { computed } from 'vue'
import type { ClientPayment } from '@/types/payment'
import {
    documentStateClasses,
    documentStateLabel,
    financialStateClasses,
    financialStateLabel,
    paymentDocumentState,
    paymentFinancialState,
    paymentStatusExplanation,
} from '@/utils/payment'

const props = defineProps<{ payment: ClientPayment }>()
const documentState = computed(() => paymentDocumentState(props.payment))
const financialState = computed(() => paymentFinancialState(props.payment))
const approvedWithoutCredit = computed(() =>
    documentState.value === 'APROBADO' && financialState.value !== 'ACREDITADO',
)
</script>

<template>
    <div class="grid gap-2">
        <div class="flex flex-wrap gap-2" role="group" aria-label="Estados del pago">
            <span class="inline-flex rounded-full border px-3 py-1 text-xs font-semibold"
                :class="documentStateClasses(documentState)">
                {{ documentStateLabel(documentState) }}
            </span>
            <span class="inline-flex rounded-full border px-3 py-1 text-xs font-semibold"
                :class="financialStateClasses(financialState)">
                {{ financialStateLabel(financialState) }}
            </span>
        </div>
        <p class="m-0 text-sm" :class="approvedWithoutCredit ? 'font-semibold text-sky-900' : 'text-slate-600'">
            {{ paymentStatusExplanation(payment) }}
        </p>
    </div>
</template>
