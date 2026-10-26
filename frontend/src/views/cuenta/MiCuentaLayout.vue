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
  <section class="grid grid-cols-1 gap-8 p-4 min-[701px]:grid-cols-[220px_minmax(0,1fr)] min-[701px]:p-8">
    <aside>
      <h2 class="mb-4 text-xl font-semibold text-[#0b2438]">Mi Cuenta</h2>
      <AccountMenu :permissions="permissions" />

      <button class="mt-4 min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-[#103a5c] hover:bg-slate-100 disabled:opacity-60" type="button" :disabled="isLoggingOut" @click="logout">
        {{ isLoggingOut ? 'Saliendo...' : 'Cerrar sesión' }}
      </button>
    </aside>

    <main class="min-w-0">
      <RouterView />
    </main>
  </section>
</template>