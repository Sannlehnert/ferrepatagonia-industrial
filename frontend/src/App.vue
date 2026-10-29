<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
const auth = useAuthStore()
const retrySession = () => window.location.reload()
</script>

<template>
  <div v-if="auth.sessionError" role="alert" class="p-4 text-red-800">
    <p>{{ auth.sessionError }}</p>
    <button type="button" class="min-h-11 rounded border px-4" @click="retrySession">Reintentar verificación de sesión</button>
  </div>
  <RouterView />
</template>
