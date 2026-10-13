<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const saliendo = ref(false)

async function cerrarSesion() {
  saliendo.value = true
  await auth.logout()
  await router.replace({ name: 'login' }) // replace: "Atrás" no vuelve a lo privado
  saliendo.value = false
}
</script>

<template>
  <section class="cuenta">
    <aside class="cuenta__menu">
      <h2>Mi Cuenta</h2>
      <nav>
        <RouterLink :to="{ name: 'cuenta-datos' }">Mis datos</RouterLink>
        <RouterLink :to="{ name: 'cuenta-pedidos' }">Mis pedidos</RouterLink>
        <button type="button" :disabled="saliendo" @click="cerrarSesion">
          {{ saliendo ? 'Saliendo...' : 'Cerrar sesión' }}
        </button>
      </nav>
    </aside>

    <main class="cuenta__contenido">
      <RouterView />
    </main>
  </section>
</template>

<style scoped>
.cuenta { display: grid; grid-template-columns: 220px 1fr; gap: 2rem; padding: 2rem; }
.cuenta__menu nav { display: flex; flex-direction: column; gap: .5rem; }
.cuenta__menu a.router-link-active { font-weight: 600; }
@media (max-width: 700px) { .cuenta { grid-template-columns: 1fr; } }
</style>