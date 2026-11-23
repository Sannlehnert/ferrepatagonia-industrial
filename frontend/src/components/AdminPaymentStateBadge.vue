<script setup lang="ts">
import { computed } from 'vue'
import { documentLabel, financialLabel } from '@/services/adminPaymentService'

const props = defineProps<{
  kind: 'document' | 'financial'
  state: string
}>()

type Tone = 'neutral' | 'pending' | 'success' | 'danger' | 'muted'

const label = computed(() => props.kind === 'document'
  ? documentLabel(props.state)
  : financialLabel(props.state))

const tone = computed<Tone>(() => {
  if (props.kind === 'document') {
    if (props.state === 'APROBADO') return 'success'
    if (props.state === 'RECHAZADO') return 'danger'
    return props.state === 'PENDIENTE' ? 'pending' : 'neutral'
  }
  if (props.state === 'ACREDITADO') return 'success'
  if (props.state === 'RECHAZADO') return 'danger'
  if (props.state === 'ANULADO') return 'muted'
  return props.state === 'PENDIENTE' ? 'pending' : 'neutral'
})

const icon = computed(() => {
  if (props.kind === 'document') {
    if (props.state === 'APROBADO') return 'check'
    if (props.state === 'RECHAZADO') return 'x'
  } else {
    if (props.state === 'ACREDITADO') return 'check'
    if (props.state === 'RECHAZADO') return 'x'
    if (props.state === 'ANULADO') return 'ban'
  }
  return 'clock'
})
</script>

<template>
  <span class="state-badge" :class="`state-badge--${tone}`">
    <svg aria-hidden="true" viewBox="0 0 20 20" class="state-badge__icon" fill="none" stroke="currentColor" stroke-width="1.8">
      <template v-if="icon === 'check'">
        <circle cx="10" cy="10" r="7.5" />
        <path stroke-linecap="round" stroke-linejoin="round" d="m6.5 10 2.3 2.3 4.7-4.8" />
      </template>
      <template v-else-if="icon === 'x'">
        <circle cx="10" cy="10" r="7.5" />
        <path stroke-linecap="round" d="m7 7 6 6M13 7l-6 6" />
      </template>
      <template v-else-if="icon === 'ban'">
        <circle cx="10" cy="10" r="7.5" />
        <path stroke-linecap="round" d="m5 15 10-10" />
      </template>
      <template v-else>
        <circle cx="10" cy="10" r="7.5" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M10 6v4.2l2.8 1.7" />
      </template>
    </svg>
    <span>{{ label }}</span>
  </span>
</template>

<style scoped>
.state-badge {
  box-sizing: border-box;
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid;
  border-radius: 999px;
  padding: 0.2rem 0.65rem;
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.state-badge__icon {
  width: 1rem;
  height: 1rem;
  flex: none;
}
.state-badge--pending { border-color: #f59e0b; background: #fffbeb; color: #92400e; }
.state-badge--success { border-color: #16a34a; background: #f0fdf4; color: #166534; }
.state-badge--danger { border-color: #dc2626; background: #fef2f2; color: #991b1b; }
.state-badge--muted { border-color: #64748b; background: #f1f5f9; color: #334155; }
.state-badge--neutral { border-color: #cbd5e1; background: #f8fafc; color: #0f172a; }
</style>
