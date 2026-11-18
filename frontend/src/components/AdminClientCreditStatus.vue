<script setup lang="ts">
import type { ClientCredit } from '@/composables/useAdminClientCredit'

defineProps<{ credit: ClientCredit | null; company: boolean }>()
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="space-y-2 text-sm" aria-label="Estado de crédito">
    <span v-if="!company" class="text-slate-600">No aplica a particulares</span>
    <span v-else-if="!credit" role="status">Consultando crédito…</span>
    <template v-else-if="credit.state === 'ERROR'">
      <p class="m-0 text-rose-800" role="alert">Crédito no disponible para consulta</p>
      <button type="button" class="min-h-11 rounded border border-slate-400 px-3 underline"
        @click="emit('retry')">Reintentar crédito</button>
    </template>
    <template v-else-if="credit.account.estado === 'SIN_CUENTA'">
      <span class="inline-block rounded bg-slate-100 px-2 py-1 text-slate-700">Sin cuenta corriente</span>
    </template>
    <template v-else>
      <span class="inline-block rounded px-2 py-1 font-semibold"
        :class="credit.account.estado === 'HABILITADA' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'">
        Cuenta {{ credit.account.estado === 'HABILITADA' ? 'habilitada' : 'inhabilitada' }}
      </span>
      <p class="m-0" :class="credit.account.estadoCredito === 'DISPONIBLE' ? 'text-emerald-800' : 'text-amber-900'">
        {{ credit.account.estadoCredito === 'DISPONIBLE' ? 'Crédito disponible según la cuenta'
          : credit.account.estadoCredito === 'BLOQUEADO' ? 'Crédito bloqueado' : 'Crédito no determinable' }}
      </p>
      <p v-if="credit.account.origen === 'DEMO'" class="m-0 font-semibold text-amber-900">Datos de demostración</p>
      <p class="m-0 text-xs text-slate-600">La aprobación de empresa se verifica por separado.</p>
    </template>
  </div>
</template>
