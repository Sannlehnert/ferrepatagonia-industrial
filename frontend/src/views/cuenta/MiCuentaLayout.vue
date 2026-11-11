<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import AccountMenu from '@/components/AccountMenu.vue'
import PublicHeader from '@/components/PublicHeader.vue'
import PublicFooter from '@/components/PublicFooter.vue'
import CartDrawer from '@/components/CartDrawer.vue'
import { getPermissionsForUser } from '@/config/permissions'
import { useAuthStore } from '@/stores/auth'
import { useCartPanelStore } from '@/stores/cartPanel'

const auth = useAuthStore()
const panel = useCartPanelStore()
const router = useRouter()
const route = useRoute()
const isLoggingOut = ref(false)
const logoutError = ref('')

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

watch(() => route.fullPath, () => panel.close())
watch(
  () => [auth.user?.id, auth.rol, auth.sessionVersion],
  () => panel.close(),
)

async function logout() {
  if (isLoggingOut.value) return
  logoutError.value = ''
  isLoggingOut.value = true

  try {
    if (await auth.logout()) await router.replace({ name: 'login' })
  } catch {
    logoutError.value = 'No se pudo cerrar la sesión. No se confirmó el cierre. Reintentá con Cerrar sesión.'
  } finally {
    isLoggingOut.value = false
  }
}
</script>

<template>
  <div class="fp-public flex min-h-screen flex-col bg-[#F8FAFC]">
    <div class="w-full bg-white shadow-xs">
      <PublicHeader />
    </div>

    <div class="flex-1 w-full flex flex-col md:flex-row min-w-0">
      <aside
        class="bg-[#0B2438] text-white w-full md:w-64 md:min-h-[calc(100vh-theme(spacing.16))] p-4 md:p-6 flex flex-col justify-between shrink-0"
      >
        <div class="min-w-0">
          <h2 class="text-xl font-bold mb-4 md:mb-6 text-white">
            <RouterLink to="/mi-cuenta" class="hover:text-slate-200 no-underline text-inherit focus-visible:outline-2 focus-visible:outline-white rounded">
              Mi Cuenta
            </RouterLink>
          </h2>
          <div class="overflow-x-auto pb-2 md:overflow-visible md:pb-0">
            <AccountMenu :permissions="permissions" />
          </div>
        </div>

        <div class="pt-3 md:pt-6 border-t border-[#35556F] mt-3 md:mt-auto">
          <p v-if="logoutError" role="alert" class="text-red-400 text-xs mb-2">{{ logoutError }}</p>
          <button
            class="inline-flex min-h-[44px] min-w-[44px] w-full items-center justify-center md:justify-start gap-2 rounded-[8px] border border-[#35556F] bg-transparent px-3 py-2 text-sm text-[#A7B6C4] hover:text-white hover:bg-[#103A5C] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-white transition-colors cursor-pointer"
            type="button"
            :disabled="isLoggingOut"
            @click="logout"
          >
            <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>{{ isLoggingOut ? 'Saliendo...' : 'Cerrar sesión' }}</span>
          </button>
        </div>
      </aside>

      <main class="min-w-0 flex-1 p-4 sm:p-6 md:p-8">
        <RouterView />
      </main>
    </div>

    <PublicFooter class="mt-auto w-full" />

    <CartDrawer v-if="panel.visible && auth.rol === 'CLIENTE'" />
  </div>
</template>
