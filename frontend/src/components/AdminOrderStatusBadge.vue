<script setup lang="ts">
import { computed } from 'vue'
import { orderCommercialStateBadge } from '@/utils/payment'

const props = defineProps<{ status: string }>()
const badge = computed(() => orderCommercialStateBadge(props.status))
</script>

<template>
  <span
    class="box-border inline-flex h-7 min-w-[136px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold"
    :class="badge.badgeClasses"
  >
    <span
      aria-hidden="true"
      class="h-1.5 w-1.5 shrink-0 rounded-full"
      :class="badge.dotClasses"
    />
    {{ badge.label }}
  </span>
</template>
