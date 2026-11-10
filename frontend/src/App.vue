<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useCartStore } from '@/stores/cart'
import { onRealtime, startRealtime } from '@/services/realtime'
const auth = useAuthStore()
const cart = useCartStore()
onRealtime(change => {
  if (auth.rol !== 'CLIENTE') return
  const affected = change.products.size > 0 && (cart.loading || cart.operation !== null ||
    cart.items.some(item => change.products.has(item.id_producto)))
  if (change.cart || change.reconnect || affected) cart.invalidarCarrito()
})
startRealtime(auth)
const retrySession = () => window.location.reload()
</script>

<template>
  <div v-if="auth.sessionError" role="alert" class="p-4 text-red-800">
    <p>{{ auth.sessionError }}</p>
    <button type="button" class="min-h-11 rounded border px-4" @click="retrySession">Reintentar verificación de sesión</button>
  </div>
  <RouterView />
</template>
