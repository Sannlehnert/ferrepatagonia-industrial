<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
const auth = useAuthStore()
</script>

<template>
  <div class="rounded-[10px] border border-[#E2E8F0] bg-white p-6 shadow-sm">
    <h3 class="m-0 mb-6 text-xl font-bold text-[#0B2438]">Mis datos</h3>
    <dl v-if="auth.user" class="grid grid-cols-1 gap-y-4 text-base sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-3 sm:text-sm">
      <dt class="font-semibold text-slate-700">Nombre</dt><dd class="m-0 font-medium text-[#0B2438] break-words">{{ auth.user.nombre }}</dd>
      <dt class="font-semibold text-slate-700">Email</dt><dd class="m-0 font-medium text-[#0B2438] break-words">{{ auth.user.email }}</dd>
    </dl>
  </div>
</template>
