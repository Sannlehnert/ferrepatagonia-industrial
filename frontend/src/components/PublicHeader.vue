<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import NavigationMenu from '@/components/NavigationMenu.vue'
import { publicMenu } from '@/config/menu'
import { getPermissionsForUser } from '@/config/permissions'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const search = ref('')

watch(
  () => [route.name, route.query.busqueda] as const,
  ([name, busqueda]) => {
    search.value =
      name === 'catalogo' && typeof busqueda === 'string'
        ? busqueda
        : ''
  },
  { immediate: true },
)

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

const accountRoute = computed(() => {
  if (auth.rol === 'ADMIN') return 'admin-dashboard'
  if (auth.rol === 'CLIENTE') return 'cuenta-datos'
  return 'login'
})

const accountLabel = computed(() => {
  if (auth.rol === 'ADMIN') return 'Administración'
  return 'Mi cuenta'
})

async function submitSearch() {
  const busqueda = search.value.trim()

  await router.push({
    name: 'catalogo',
    query: busqueda ? { busqueda } : {},
  })
}
</script>

<template>
  <header class="bg-white text-[#103a5c]">
    <div class="bg-[#0b2438] text-white">
      <div
        class="box-border mx-auto flex min-h-9 max-w-[1440px] items-center px-4 py-2 text-xs sm:px-6 lg:px-10"
      >
        Envíos y retiros coordinados · Neuquén Capital
      </div>
    </div>

    <div class="border-0 border-b border-solid border-[#e2e8f0]">
      <div
        class="box-border mx-auto grid max-w-[1440px] grid-cols-[1fr_auto] items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-6 lg:min-h-20 lg:grid-cols-[223px_minmax(0,1fr)_auto] lg:px-10"
      >
        <RouterLink
          :to="{ name: 'home' }"
          aria-label="Ferrepatagonia Industrial — Inicio"
          class="inline-flex min-h-11 w-fit flex-col justify-center rounded text-[#0b2438] no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2b7bbb]"
        >
          <span class="text-lg leading-tight font-extrabold">
            FERREPATAGONIA
          </span>
          <span
            class="text-[8px] leading-tight font-bold tracking-[1.2px] text-[#2b7bbb]"
          >
            INDUSTRIAL
          </span>
        </RouterLink>

        <form
          role="search"
          aria-label="Buscar en el catálogo"
          class="order-last col-span-2 flex min-w-0 lg:order-none lg:col-span-1"
          @submit.prevent="submitSearch"
        >
          <label for="home-search" class="sr-only">
            Buscar productos por nombre o código
          </label>

          <input
            id="home-search"
            v-model="search"
            type="search"
            name="busqueda"
            enterkeyhint="search"
            placeholder="Buscar productos o código..."
            class="box-border h-11 w-full min-w-0 rounded-l-[10px] border border-r-0 border-solid border-[#e2e8f0] bg-[#f8fafc] px-4 font-[inherit] text-sm text-[#103a5c] placeholder:text-slate-500 focus-visible:relative focus-visible:outline-2 focus-visible:outline-[#2b7bbb]"
          />

          <button
            type="submit"
            class="box-border min-h-11 shrink-0 cursor-pointer rounded-r-[10px] border border-solid border-[#e2e8f0] bg-[#f8fafc] px-3 font-[inherit] text-xs font-bold text-[#103a5c] hover:bg-slate-200 focus-visible:relative focus-visible:outline-2 focus-visible:outline-[#2b7bbb]"
          >
            Buscar
          </button>
        </form>

        <div class="flex flex-wrap items-center justify-end gap-x-4">
          <RouterLink
            :to="{ name: accountRoute }"
            class="inline-flex min-h-11 items-center rounded text-xs font-bold text-[#103a5c] no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2b7bbb]"
          >
            {{ accountLabel }}
          </RouterLink>

          <RouterLink
            v-if="!auth.isAuthenticated"
            :to="{ name: 'registro' }"
            class="inline-flex min-h-11 items-center rounded text-xs font-bold text-[#103a5c] no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2b7bbb]"
          >
            Crear cuenta
          </RouterLink>
        </div>
      </div>
    </div>

    <div class="border-0 border-b border-solid border-[#e2e8f0]">
      <div
        class="box-border mx-auto flex max-w-[1440px] flex-wrap items-center gap-1 px-1 text-sm font-bold sm:px-3 lg:px-7"
      >
        <NavigationMenu
          :items="publicMenu"
          :permissions="permissions"
          label="Menú principal"
          orientation="horizontal"
          variant="default"
        />

        <RouterLink
          :to="{ name: 'home', hash: '#categorias' }"
          class="box-border inline-flex min-h-11 items-center rounded-md px-3 py-2 text-[#103a5c] no-underline hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
        >
          Categorías
        </RouterLink>
      </div>
    </div>
  </header>
</template>