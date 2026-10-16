<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AccountMenu from '@/components/AccountMenu.vue'
import { getPermissionsForUser } from '@/config/permissions'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const isLoggingOut = ref(false)

const permissions = computed(() =>
  getPermissionsForUser(
    auth.user
      ? {
          rol: auth.user.rol,
          tipoCliente: auth.user.tipo_cliente,
        }
      : null,
  ),
)

async function logout() {
  isLoggingOut.value = true

  try {
    await auth.logout()
    await router.replace({ name: 'login' })
  } finally {
    isLoggingOut.value = false
  }
}
</script>

<template>
  <section class="cuenta">
    <aside class="cuenta__menu">
      <h2>Mi Cuenta</h2>
      <AccountMenu :permissions="permissions" />

      <button type="button" :disabled="isLoggingOut" @click="logout">
        {{ isLoggingOut ? 'Saliendo...' : 'Cerrar sesión' }}
      </button>
    </aside>

    <main class="cuenta__contenido">
      <RouterView />
    </main>
  </section>
</template>

<style scoped>
.cuenta {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 2rem;
  padding: 2rem;
}

@media (max-width: 700px) {
  .cuenta {
    grid-template-columns: 1fr;
  }
}
</style>