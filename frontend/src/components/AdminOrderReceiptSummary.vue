<script setup lang="ts">
defineProps<{ summary?: { total: number; pendientesRevision: number } }>()
</script>

<template>
  <span class="inline-flex min-w-[136px] flex-col items-start text-xs">
    <span class="inline-flex min-h-7 items-center gap-2 whitespace-nowrap text-sm font-medium text-[#13293A]">
      <svg
        width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        class="shrink-0"
        :class="!summary || summary.total === 0 ? 'text-[#64748B]' : summary.pendientesRevision ? 'text-[#D97706]' : 'text-[#16A34A]'"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" />
        <path d="M14 2v6h6" />
        <g v-if="summary && summary.total > 0 && summary.pendientesRevision">
          <circle cx="10.5" cy="14" r="2.5" />
          <path d="m12.3 15.8 3.2 3.2" />
        </g>
        <path v-else-if="summary && summary.total > 0" d="m8 14 2.5 2.5L16 11" />
      </svg>
      {{ !summary ? 'Sin información' : summary.total === 0 ? 'Sin adjuntar' : summary.pendientesRevision ? 'Sin revisar' : 'Revisados' }}
    </span>
    <span v-if="summary && summary.total > 0" class="pl-[26px] text-[#64748B]">
      {{ summary.total }} {{ summary.total === 1 ? 'comprobante' : 'comprobantes' }}<span v-if="summary.pendientesRevision"> · {{ summary.pendientesRevision }} sin revisar</span>
    </span>
  </span>
</template>
