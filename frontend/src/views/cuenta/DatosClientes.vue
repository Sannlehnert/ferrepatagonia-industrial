<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
const auth = useAuthStore()
</script>

<template>
  <h3 class="m-0 mb-4 text-lg font-semibold text-[#0b2438]">Mis datos</h3>
  <dl v-if="auth.user" class="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2 max-[420px]:grid-cols-1">
    <dt class="font-semibold">Nombre</dt><dd class="m-0 break-words">{{ auth.user.nombre }}</dd>
    <dt class="font-semibold">Email</dt><dd class="m-0 break-words">{{ auth.user.email }}</dd>
  </dl>
</template>
