<script setup lang="ts">
import type { ClientCredit } from '@/composables/useAdminClientCredit'

defineProps<{ credit: ClientCredit | null; company: boolean; compact?: boolean }>()
const emit = defineEmits<{ retry: [] }>()
const badgeClass = "credit-badge box-border inline-flex w-44 min-h-7 items-center justify-center gap-[7px] whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold leading-5 before:size-1.5 before:shrink-0 before:rounded-full before:bg-current before:content-['']"
</script>

<template>
  <div class="grid justify-items-start gap-1.5 text-sm leading-normal" aria-label="Estado de crédito">
    <span v-if="!company" class="text-slate-600">No aplica a particulares</span>
    <span v-else-if="!credit" role="status">Consultando crédito…</span>
    <template v-else-if="credit.state === 'ERROR'">
      <p class="m-0 text-rose-800" role="alert">Crédito no disponible para consulta</p>
      <button type="button" class="box-border min-h-11 cursor-pointer rounded-lg border border-solid border-slate-300 bg-white px-3 py-2 [font-family:inherit] text-sm font-semibold leading-5 text-[#103a5c] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[#145a8d]"
        @click="emit('retry')">Reintentar crédito</button>
    </template>
    <template v-else-if="credit.account.estado === 'SIN_CUENTA'">
      <span :class="[badgeClass, 'bg-[#f3f4f6] text-[#475569]']">Sin cuenta corriente</span>
    </template>
    <template v-else>
      <span :class="[badgeClass, credit.account.estado === 'HABILITADA' ? 'bg-[#dcfce7] text-[#166534]' : 'bg-[#f3f4f6] text-[#475569]']">
        Cuenta {{ credit.account.estado === 'HABILITADA' ? 'habilitada' : 'inhabilitada' }}
      </span>
      <p class="m-0 text-[#475569]">
        {{ credit.account.estadoCredito === 'DISPONIBLE' ? (compact ? 'Crédito disponible' : 'Crédito disponible según la cuenta')
          : credit.account.estadoCredito === 'BLOQUEADO' ? 'Crédito bloqueado' : 'Crédito no determinable' }}
      </p>
      <p v-if="!compact && credit.account.origen === 'DEMO'" class="m-0 text-xs text-[#64748b]">Datos de demostración</p>
    </template>
  </div>
</template>
