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
const isMobileMenuOpen = ref(false)

const permissions = computed(() => {
  const u = auth.user as Record<string, any> | null | undefined
  if (!u) return getPermissionsForUser(null)
  return getPermissionsForUser({
    rol: u.rol,
    tipoCliente: u.tipoCliente ?? u.tipo_cliente ?? u.cliente?.tipoCliente ?? null,
    estadoAprobacionEmpresa: u.estadoAprobacionEmpresa,
    cuentaCorrienteHabilitada: u.cuentaCorrienteHabilitada,
  })
})

const isParticular = computed(() => {
  const u = auth.user as Record<string, any> | null | undefined
  const tipo = u?.tipoCliente ?? u?.tipo_cliente ?? u?.cliente?.tipoCliente ?? u?.cliente?.tipo_cliente
  return tipo === 'PARTICULAR'
})

function handleGoBack() {
  let fallback = '/catalogo'
  if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined') {
    try {
      const stored = sessionStorage.getItem('last_external_route')
      if (stored) {
        fallback = stored
      }
    } catch {
      // fallback a /catalogo
    }
  }
  void router.push(fallback)
}

function isActive(target: 'pedidos' | 'sin-comprobante' | 'cuenta-corriente' | 'datos'): boolean {
  if (!route) return false
  const path = (route.path || '').replace(/\/$/, '')
  const query = route.query || {}

  if (target === 'pedidos') {
    return path === '/mi-cuenta/pedidos' && !query.filtro
  }
  if (target === 'sin-comprobante') {
    return path === '/mi-cuenta/pedidos' && query.filtro === 'sin-comprobante'
  }
  if (target === 'cuenta-corriente') {
    return path === '/mi-cuenta/pedidos' && query.filtro === 'cuenta-corriente'
  }
  if (target === 'datos') {
    return path === '/mi-cuenta/datos'
  }
  return false
}

watch(() => route.fullPath, () => {
  isMobileMenuOpen.value = false
  panel.close()
})
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
    <!-- Cabecera estándar Desktop (>= 768px) -->
    <div class="hidden md:block w-full bg-white shadow-xs">
      <PublicHeader />
    </div>

    <!-- Barra de herramientas móvil Mi Cuenta (< 768px) con proporción 20% / 60% / 20% -->
    <header class="md:hidden bg-[#0B2438] text-white px-4 py-3 flex items-center justify-between border-b border-[#35556F]">
      <!-- 1. Izquierda (20%): Botón Volver estilizado con área táctil >= 44x44px -->
      <div class="w-[20%] flex items-center justify-start">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 min-h-[44px] min-w-[44px] text-sm font-medium hover:text-slate-300 bg-transparent border-0 text-white cursor-pointer p-0 focus-visible:outline-2 focus-visible:outline-white rounded"
          aria-label="Volver"
          @click="handleGoBack"
        >
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span class="text-sm">Volver</span>
        </button>
      </div>

      <!-- 2. Centro (60%): Título "Mi Cuenta" centrado -->
      <div class="w-[60%] text-center">
        <RouterLink
          :to="{ name: 'cuenta-dashboard' }"
          class="block font-bold text-base text-white tracking-wide truncate no-underline hover:text-slate-200"
        >
          Mi Cuenta
        </RouterLink>
      </div>

      <!-- 3. Derecha (20% - justificado al final): Botón de menú hamburguesa -->
      <div class="w-[20%] flex items-center justify-end">
        <button
          type="button"
          class="min-h-[44px] min-w-[44px] flex items-center justify-end text-white bg-transparent border-0 cursor-pointer p-0 hover:text-slate-300 focus-visible:outline-2 focus-visible:outline-white rounded"
          aria-label="Menú de navegación de cuenta"
          :aria-expanded="isMobileMenuOpen"
          @click="isMobileMenuOpen = !isMobileMenuOpen"
        >
          <!-- Ícono de hamburguesa (tres líneas) cuando está cerrado -->
          <svg v-if="!isMobileMenuOpen" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <!-- Ícono de X de cierre cuando está abierto -->
          <svg v-else class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </header>

    <!-- Menú móvil desplegable vertical colapsable (< 768px) -->
    <nav
      v-if="isMobileMenuOpen"
      aria-label="Menú de navegación de cuenta"
      class="md:hidden bg-[#0B2438] border-b border-[#35556F] px-4 py-3 flex flex-col space-y-1.5"
    >
      <RouterLink
        :to="{ name: 'cuenta-pedidos' }"
        aria-label="Historial de pedidos"
        class="box-border flex min-h-[44px] items-center px-3 py-2 rounded-[8px] no-underline text-sm transition-colors"
        :class="isActive('pedidos') ? 'bg-[#103A5C] text-white font-semibold' : 'text-[#A7B6C4] hover:text-white hover:bg-[#103A5C]/40'"
        :aria-current="isActive('pedidos') ? 'page' : undefined"
        @click="isMobileMenuOpen = false"
      >
        Historial de pedidos
      </RouterLink>

      <RouterLink
        :to="{ name: 'cuenta-pedidos', query: { filtro: 'sin-comprobante' } }"
        aria-label="Pedidos sin comprobante"
        class="box-border flex min-h-[44px] items-center px-3 py-2 rounded-[8px] no-underline text-sm transition-colors"
        :class="isActive('sin-comprobante') ? 'bg-[#103A5C] text-white font-semibold' : 'text-[#A7B6C4] hover:text-white hover:bg-[#103A5C]/40'"
        :aria-current="isActive('sin-comprobante') ? 'page' : undefined"
        @click="isMobileMenuOpen = false"
      >
        Pedidos sin comprobante
      </RouterLink>

      <RouterLink
        v-if="!isParticular"
        :to="{ name: 'cuenta-pedidos', query: { filtro: 'cuenta-corriente' } }"
        aria-label="Pedidos con cuenta corriente"
        class="box-border flex min-h-[44px] items-center px-3 py-2 rounded-[8px] no-underline text-sm transition-colors"
        :class="isActive('cuenta-corriente') ? 'bg-[#103A5C] text-white font-semibold' : 'text-[#A7B6C4] hover:text-white hover:bg-[#103A5C]/40'"
        :aria-current="isActive('cuenta-corriente') ? 'page' : undefined"
        @click="isMobileMenuOpen = false"
      >
        Pedidos con cuenta corriente
      </RouterLink>

      <RouterLink
        :to="{ name: 'cuenta-datos' }"
        aria-label="Mis datos"
        class="box-border flex min-h-[44px] items-center px-3 py-2 rounded-[8px] no-underline text-sm transition-colors"
        :class="isActive('datos') ? 'bg-[#103A5C] text-white font-semibold' : 'text-[#A7B6C4] hover:text-white hover:bg-[#103A5C]/40'"
        :aria-current="isActive('datos') ? 'page' : undefined"
        @click="isMobileMenuOpen = false"
      >
        Configuración de datos
      </RouterLink>

      <div class="pt-2 border-t border-[#35556F]">
        <p v-if="logoutError" role="alert" class="text-red-400 text-xs mb-2">{{ logoutError }}</p>
        <button
          type="button"
          class="box-border inline-flex min-h-[44px] min-w-[44px] w-full items-center justify-start gap-2 rounded-[8px] border border-[#35556F] bg-transparent px-3 py-2 text-sm text-[#A7B6C4] hover:text-white hover:bg-[#103A5C] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-white transition-colors cursor-pointer"
          :disabled="isLoggingOut"
          @click="logout(); isMobileMenuOpen = false"
        >
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <span>{{ isLoggingOut ? 'Saliendo...' : 'Cerrar sesión' }}</span>
        </button>
      </div>
    </nav>

    <!-- Contenido y Sidebar Desktop (>= 768px) -->
    <div class="flex-1 w-full max-w-full flex flex-col md:flex-row min-w-0 overflow-hidden sm:overflow-visible">
      <aside
        class="hidden md:flex bg-[#0B2438] text-white md:w-64 md:min-h-[calc(100vh-theme(spacing.16))] p-6 flex-col justify-between shrink-0 min-w-0 box-border overflow-visible"
      >
        <div class="min-w-0">
          <h2 class="text-xl font-bold mb-6 text-white">
            <RouterLink :to="{ name: 'cuenta-dashboard' }" class="hover:text-slate-200 no-underline text-inherit focus-visible:outline-2 focus-visible:outline-white rounded">
              Mi Cuenta
            </RouterLink>
          </h2>
          <div class="overflow-visible">
            <AccountMenu :permissions="permissions" />
          </div>
        </div>

        <div class="pt-6 border-t border-[#35556F] mt-auto">
          <p v-if="logoutError" role="alert" class="text-red-400 text-xs mb-2">{{ logoutError }}</p>
          <button
            class="inline-flex min-h-[44px] min-w-[44px] w-full items-center justify-start gap-2 rounded-[8px] border border-[#35556F] bg-transparent px-3 py-2 text-sm text-[#A7B6C4] hover:text-white hover:bg-[#103A5C] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-white transition-colors cursor-pointer"
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

      <main class="min-w-0 flex-1 overflow-hidden sm:overflow-visible p-4 sm:p-6 md:p-8 max-w-full box-border">
        <RouterView />
      </main>
    </div>

    <PublicFooter class="mt-auto w-full" />

    <CartDrawer v-if="panel.visible && auth.rol === 'CLIENTE'" />
  </div>
</template>
