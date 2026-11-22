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
    <header class="md:hidden sticky top-0 z-30 bg-[#0B2438] text-white px-4 py-2.5 grid grid-cols-[44px_1fr_44px] items-center gap-2">
      <button
        type="button"
        aria-label="Volver a tienda"
        title="Volver a tienda"
        class="box-border justify-self-start min-h-[44px] min-w-[44px] inline-flex cursor-pointer items-center justify-center rounded-[8px] border-0 border-solid bg-transparent font-[inherit] text-white hover:bg-[#103A5C] transition-colors focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-white"
        @click="handleGoBack"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
        </svg>
      </button>
      <RouterLink
        :to="{ name: 'cuenta-dashboard' }"
        class="justify-self-center inline-flex min-h-[44px] items-center justify-center rounded-[8px] px-3 text-base font-bold text-white no-underline hover:bg-[#103A5C] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        @click="isMobileMenuOpen = false"
      >Mi Cuenta</RouterLink>
      <button
        type="button"
        class="box-border justify-self-end min-h-[44px] min-w-[44px] inline-flex cursor-pointer items-center justify-center rounded-[8px] border-0 border-solid bg-transparent font-[inherit] text-white hover:bg-[#103A5C] transition-colors focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-white"
        aria-label="Menú de navegación de cuenta"
        aria-controls="account-mobile-menu"
        :aria-expanded="isMobileMenuOpen"
        @click="isMobileMenuOpen = !isMobileMenuOpen"
      >
        <svg v-if="isMobileMenuOpen" class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
        <svg v-else class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>
    </header>

    <div
      id="account-mobile-menu"
      v-show="isMobileMenuOpen"
      class="md:hidden fixed inset-x-0 top-16 z-20 bg-[#0B2438] px-4 pt-1 pb-4 max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-[#35556F]/60 shadow-lg"
      @keydown.esc="isMobileMenuOpen = false"
    >
      <AccountMenu :permissions="permissions" @click="isMobileMenuOpen = false" />
      <p v-if="logoutError" role="alert" class="text-red-400 text-xs mt-2">{{ logoutError }}</p>
      <div class="mt-4 pt-3 border-t border-[#35556F]">
        <button
          type="button"
          class="box-border inline-flex min-h-[44px] w-full cursor-pointer items-center gap-2 rounded-[8px] border border-solid border-[#7595AD] bg-transparent px-3 text-left font-[inherit] text-sm font-semibold text-white hover:bg-[#103A5C] transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-white"
          :disabled="isLoggingOut"
          @click="logout"
        >
          <svg class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10 17v2H5V5h5v2m4 1 4 4-4 4m4-4H9" />
          </svg>
          {{ isLoggingOut ? 'Saliendo...' : 'Cerrar sesión' }}
        </button>
      </div>
    </div>

    <div class="flex flex-1 min-w-0">
      <aside class="hidden md:flex md:w-72 box-border shrink-0 flex-col self-start sticky top-0 h-screen overflow-y-auto bg-[#0B2438] p-6 text-white">
        <div class="mb-4 pb-4 border-b border-[#35556F]">
          <button
            type="button"
            class="box-border min-h-[44px] w-full inline-flex cursor-pointer items-center gap-2 rounded-[8px] border-0 border-solid bg-transparent px-2 text-left font-[inherit] text-sm text-[#A7B6C4] hover:text-white hover:bg-[#103A5C] transition-colors focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-white"
            @click="handleGoBack"
          >
            <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            <span>Volver a tienda</span>
          </button>
        </div>
        <h2 class="mt-0 text-xl font-bold mb-6">
          <RouterLink
            :to="{ name: 'cuenta-dashboard' }"
            class="inline-flex min-h-[44px] items-center rounded-[8px] px-2 text-white no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >Mi Cuenta</RouterLink>
        </h2>
        <AccountMenu class="mt-0" :permissions="permissions" />
        <div class="mt-auto pt-4 border-t border-[#35556F]">
          <p v-if="logoutError" role="alert" class="text-red-400 text-xs mb-2">{{ logoutError }}</p>
          <button
            type="button"
            class="box-border inline-flex min-h-[44px] w-full cursor-pointer items-center gap-2 rounded-[8px] border border-solid border-[#7595AD] bg-transparent px-3 text-left font-[inherit] text-sm font-semibold text-white hover:bg-[#103A5C] transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-white"
            :disabled="isLoggingOut"
            @click="logout"
          >
            <svg class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10 17v2H5V5h5v2m4 1 4 4-4 4m4-4H9" />
            </svg>
            {{ isLoggingOut ? 'Saliendo...' : 'Cerrar sesión' }}
          </button>
        </div>
      </aside>
      <main class="min-w-0 flex-1 p-4 sm:p-6 md:p-8">
        <RouterView />
      </main>
    </div>
  </div>
</template>
