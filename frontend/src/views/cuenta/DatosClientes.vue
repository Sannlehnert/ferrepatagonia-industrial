<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
const auth = useAuthStore()
</script>

<template>
  <div class="w-full max-w-full min-w-0 box-border rounded-[10px] border border-[#E2E8F0] bg-white p-4 sm:p-6 shadow-sm">
    <h3 class="m-0 mb-4 sm:mb-6 text-xl font-bold text-[#0B2438]">Mis datos</h3>
    <dl
      v-if="auth.user"
      class="grid grid-cols-1 w-full max-w-full min-w-0 gap-y-3 text-base box-border sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-x-4 sm:text-sm"
    >
      <dt class="w-full max-w-full min-w-0 box-border font-semibold text-slate-700">Nombre</dt>
      <dd class="m-0 w-full max-w-full min-w-0 box-border break-words font-medium text-[#0B2438]">{{ auth.user.nombre }}</dd>
      <dt class="w-full max-w-full min-w-0 box-border font-semibold text-slate-700">Email</dt>
      <dd class="m-0 w-full max-w-full min-w-0 box-border break-words font-medium text-[#0B2438]">{{ auth.user.email }}</dd>
    </dl>
  </div>
</template>
