<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import AccountMenu from '@/components/AccountMenu.vue'
import { getPermissionsForUser } from '@/config/permissions'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const isLoggingOut = ref(false)
const logoutError = ref('')
const isMobileMenuOpen = ref(false)

const permissions = computed(() => auth.user
  ? getPermissionsForUser({ rol: auth.user.rol, tipoCliente: auth.user.tipo_cliente })
  : getPermissionsForUser(null))

function handleGoBack() {
  let destination = '/catalogo'
  try {
    const stored = sessionStorage.getItem('last_external_route')
    if (stored && stored.startsWith('/') && !stored.startsWith('//')) {
      const resolved = router.resolve(stored)
      if (resolved.meta.storefront) destination = resolved.fullPath
    }
  } catch (error) {
    console.warn('No se pudo recuperar la página de la tienda.', error)
  }
  void router.push(destination)
}

watch(() => route.fullPath, () => {
  isMobileMenuOpen.value = false
})

async function logout() {
  if (isLoggingOut.value) return
  logoutError.value = ''
  isLoggingOut.value = true
  try {
    if (await auth.logout()) {
      try {
        sessionStorage.removeItem('last_external_route')
      } catch (error) {
        console.warn('No se pudo limpiar la página de la tienda.', error)
      }
      await router.replace({ name: 'login' })
    }
  } catch {
    logoutError.value = 'No se pudo cerrar la sesión. No se confirmó el cierre. Reintentá con Cerrar sesión.'
  } finally {
    isLoggingOut.value = false
  }
}
</script>

<template>
  <div class="fp-public min-h-screen flex flex-col bg-[#F8FAFC]">
    <header class="md:hidden bg-[#0B2438] text-white px-4 py-3 flex items-center justify-between gap-2">
      <button
        type="button"
        class="min-h-[44px] rounded-[8px] text-sm font-medium text-white bg-transparent border-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        @click="handleGoBack"
      >← Volver a tienda</button>
      <RouterLink
        :to="{ name: 'cuenta-dashboard' }"
        class="inline-flex min-h-[44px] items-center rounded-[8px] px-2 font-bold text-white no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >Mi Cuenta</RouterLink>
      <button
        type="button"
        class="min-h-[44px] min-w-[44px] rounded-[8px] text-white bg-transparent border-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        aria-label="Menú de navegación de cuenta"
        aria-controls="account-mobile-menu"
        :aria-expanded="isMobileMenuOpen"
        @click="isMobileMenuOpen = !isMobileMenuOpen"
      >{{ isMobileMenuOpen ? '✕' : '☰' }}</button>
    </header>

    <div id="account-mobile-menu" v-show="isMobileMenuOpen" class="md:hidden bg-[#0B2438] px-4 pb-4" @keydown.esc="isMobileMenuOpen = false">
      <AccountMenu :permissions="permissions" @click="isMobileMenuOpen = false" />
      <p v-if="logoutError" role="alert" class="text-red-400 text-xs mt-2">{{ logoutError }}</p>
      <div class="mt-3 border-t border-[#35556F] pt-3">
        <button
          type="button"
          class="min-h-[44px] w-full rounded-[8px] border border-[#35556F] bg-transparent px-3 text-left text-sm text-[#A7B6C4] hover:text-white hover:bg-[#103A5C] transition-colors disabled:opacity-60 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          :disabled="isLoggingOut"
          @click="logout"
        >{{ isLoggingOut ? 'Saliendo...' : 'Cerrar sesión' }}</button>
      </div>
    </div>

    <div class="flex flex-1 min-w-0">
      <aside class="hidden md:flex md:w-72 box-border shrink-0 flex-col self-start sticky top-0 h-screen overflow-y-auto bg-[#0B2438] p-6 text-white">
        <h2 class="text-xl font-bold mb-6">
          <RouterLink
            :to="{ name: 'cuenta-dashboard' }"
            class="inline-flex min-h-[44px] items-center rounded-[8px] px-2 text-white no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >Mi Cuenta</RouterLink>
        </h2>
        <AccountMenu class="mt-0" :permissions="permissions" />
        <div class="mt-auto pt-6">
          <button
            type="button"
            class="min-h-[44px] w-full rounded-[8px] text-left text-sm text-[#A7B6C4] bg-transparent border-0 cursor-pointer hover:text-white hover:bg-[#103A5C] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            @click="handleGoBack"
          >← Volver a tienda</button>
          <p v-if="logoutError" role="alert" class="text-red-400 text-xs mb-2">{{ logoutError }}</p>
          <button
            type="button"
            class="min-h-[44px] w-full rounded-[8px] border border-[#35556F] bg-transparent px-3 text-left text-sm text-[#A7B6C4] hover:text-white hover:bg-[#103A5C] transition-colors disabled:opacity-60 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            :disabled="isLoggingOut"
            @click="logout"
          >{{ isLoggingOut ? 'Saliendo...' : 'Cerrar sesión' }}</button>
        </div>
      </aside>
      <main class="min-w-0 flex-1 p-4 sm:p-6 md:p-8">
        <RouterView />
      </main>
    </div>
  </div>
</template>
