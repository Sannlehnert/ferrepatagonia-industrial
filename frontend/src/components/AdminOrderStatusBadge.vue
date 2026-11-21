<script setup lang="ts">
import { formatAdminOrderStatus } from '@/services/adminOrderService'

defineProps<{ status: string }>()
</script>

<template>
  <span
    class="box-border inline-flex h-7 w-[136px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold"
    :class="{
      'bg-[#E2E8F0] text-[#334155]': status === 'CONFIRMADO',
      'bg-[#DBEAFE] text-[#1E40AF]': status === 'ENVIADO',
      'bg-[#FEF3C7] text-[#92400E]': status === 'EN_PREPARACION',
      'bg-[#DCFCE7] text-[#166534]': status === 'ENTREGADO',
      'bg-[#F3F4F6] text-[#475569]': !['CONFIRMADO', 'EN_PREPARACION', 'ENVIADO', 'ENTREGADO'].includes(status),
    }"
  >
    <span
      aria-hidden="true"
      class="h-1.5 w-1.5 shrink-0 rounded-full"
      :class="status === 'CONFIRMADO' ? 'bg-[#64748B]' : status === 'ENVIADO' ? 'bg-[#2563EB]' : status === 'EN_PREPARACION' ? 'bg-[#D97706]' : status === 'ENTREGADO' ? 'bg-[#16A34A]' : 'bg-[#9CA3AF]'"
    />
    {{ formatAdminOrderStatus(status) }}
  </span>
</template>
