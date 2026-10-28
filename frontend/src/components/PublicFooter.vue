<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const year = new Date().getFullYear()

const accountLinks = computed(() => {
  if (auth.rol === 'ADMIN') {
    return [
      { label: 'Panel de administración', route: 'admin-dashboard' },
    ]
  }

  if (auth.rol === 'CLIENTE') {
    return [
      { label: 'Mi perfil', route: 'cuenta-datos' },
      { label: 'Mis pedidos', route: 'cuenta-pedidos' },
    ]
  }

  return [
    { label: 'Ingresar', route: 'login' },
    { label: 'Crear cuenta', route: 'registro' },
  ]
})

const linkClass =
  'inline-flex min-h-11 items-center rounded text-sm text-slate-200 no-underline hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'
</script>

<template>
  <footer class="bg-[#0b2438] text-white">
    <div class="box-border mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10">
      <div
        class="grid grid-cols-1 gap-8 py-8 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr] lg:gap-16"
      >
        <div class="sm:col-span-2 lg:col-span-1">
          <RouterLink
            :to="{ name: 'home' }"
            aria-label="Ferrepatagonia Industrial — Inicio"
            class="inline-flex min-h-11 w-fit flex-col justify-center rounded text-white no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            <span class="text-2xl leading-tight font-extrabold">
              FERREPATAGONIA
            </span>
            <span
              class="text-xs leading-tight font-bold tracking-[1.8px] text-[#65b5ee]"
            >
              INDUSTRIAL
            </span>
          </RouterLink>

          <p class="mt-4 mb-0 max-w-sm text-sm leading-relaxed text-slate-300">
            Explorá nuestro catálogo de productos y consultá su disponibilidad.
          </p>
        </div>

        <nav aria-labelledby="footer-catalog-title">
          <h2
            id="footer-catalog-title"
            class="m-0 mb-3 text-sm font-bold tracking-[1.6px]"
          >
            CATÁLOGO
          </h2>

          <ul class="m-0 list-none p-0">
            <li>
              <RouterLink
                :to="{ name: 'catalogo' }"
                :class="linkClass"
              >
                Ver productos
              </RouterLink>
            </li>
          </ul>
        </nav>

        <nav aria-labelledby="footer-account-title">
          <h2
            id="footer-account-title"
            class="m-0 mb-3 text-sm font-bold tracking-[1.6px]"
          >
            {{ auth.rol === 'ADMIN' ? 'ADMINISTRACIÓN' : 'MI CUENTA' }}
          </h2>

          <ul class="m-0 list-none p-0">
            <li v-for="link in accountLinks" :key="link.route">
              <RouterLink
                :to="{ name: link.route }"
                :class="linkClass"
              >
                {{ link.label }}
              </RouterLink>
            </li>
          </ul>
        </nav>
      </div>

      <div class="border-0 border-t border-solid border-[#29485e] py-5">
        <p class="m-0 text-xs tracking-wide text-slate-400">
          © {{ year }} Ferrepatagonia Industrial
        </p>
      </div>
    </div>
  </footer>
</template>