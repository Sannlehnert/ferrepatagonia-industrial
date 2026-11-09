<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import CommerceIcon from './CommerceIcon.vue'
import PublicBrand from './PublicBrand.vue'
import { getNavigableMenu, publicMenu } from '@/config/menu'
import { getPermissionsForRole } from '@/config/permissions'
import { useAuthStore } from '@/stores/auth'
import { useCartPanelStore } from '@/stores/cartPanel'

const auth = useAuthStore()
const cartPanel = useCartPanelStore()
const router = useRouter()
const route = useRoute()
const search = ref('')

watch(
  () => [route.name, route.query.busqueda] as const,
  ([name, busqueda]) => {
    search.value = name === 'catalogo' && typeof busqueda === 'string' ? busqueda : ''
  },
  { immediate: true },
)

const navigation = computed(() => getNavigableMenu(publicMenu, getPermissionsForRole(auth.rol)))
const account = computed(() => {
  if (auth.rol === 'ADMIN') {
    const panel = navigation.value.find(item => item.id === 'public-admin-panel')
    return panel ? { label: panel.label, route: panel.routeName } : null
  }
  if (auth.rol === 'CLIENTE') return { label: 'Mi cuenta', route: 'cuenta-datos' }
  return { label: 'Ingresar', route: 'login' }
})

async function submitSearch() {
  const busqueda = search.value.trim()
  await router.push({ name: 'catalogo', query: busqueda ? { busqueda } : {} })
}
</script>

<template>
  <header class="store-header">
    <div class="fp-shell header-main">
      <PublicBrand />

      <form role="search" aria-label="Buscar en el catálogo" class="header-search" @submit.prevent="submitSearch">
        <label for="home-search" class="sr-only">Buscar productos por nombre o código</label>
        <input
          id="home-search"
          v-model="search"
          type="search"
          name="busqueda"
          enterkeyhint="search"
          placeholder="Buscar por nombre o código"
          class="fp-focus"
        />
        <button type="submit" class="fp-action fp-action--primary fp-focus">
          <CommerceIcon name="search" /> Buscar
        </button>
      </form>
    </div>

    <div class="header-strip">
      <div class="fp-shell header-nav">
        <nav aria-label="Menú principal">
          <template v-for="item in navigation" :key="item.id">
            <RouterLink v-if="item.id !== 'public-admin-panel'" :to="{ name: item.routeName }" class="header-link fp-focus">
              {{ item.label }}
            </RouterLink>
          </template>
          <RouterLink :to="{ name: 'home', hash: '#categorias' }" :aria-current-value="route.hash === '#categorias' ? 'location' : 'false'" class="header-link fp-focus">
            Categorías
          </RouterLink>
          <RouterLink :to="{ name: 'home', hash: '#empresas' }" :aria-current-value="route.hash === '#empresas' ? 'location' : 'false'" class="header-link company-link fp-focus">
            Empresas
          </RouterLink>
        </nav>

        <div class="header-account">
          <RouterLink v-if="account" :to="{ name: account.route }" class="header-link fp-focus">
            <CommerceIcon name="user" /> {{ account.label }}
          </RouterLink>
          <button
            v-if="auth.rol === 'CLIENTE'"
            type="button"
            class="header-link fp-focus"
            aria-haspopup="dialog"
            :aria-expanded="cartPanel.visible"
            @click="cartPanel.open()"
          >
            <CommerceIcon name="cart" /> Carrito
          </button>
          <RouterLink v-else-if="!auth.isAuthenticated" :to="{ name: 'registro' }" class="header-link register-link fp-focus">
            Crear cuenta
          </RouterLink>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.store-header { background: white; }
.header-main { display: grid; align-items: center; gap: .65rem; padding-block: .7rem; }
.header-search { display: flex; min-width: 0; }
.header-search input {
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  min-height: 44px;
  border: 1px solid #7b90a2;
  border-right: 0;
  border-radius: 7px 0 0 7px;
  padding: .55rem .7rem;
  background: var(--fp-bg);
  color: var(--fp-navy);
  font: inherit;
  font-size: .94rem;
}
.header-search input::placeholder { color: var(--fp-muted); opacity: 1; }
.header-search button { border-radius: 0 7px 7px 0; padding-inline: .7rem; flex: none; }
.header-strip { background: var(--fp-bg); border-top: 1px solid var(--fp-line); border-bottom: 1px solid var(--fp-line); }
.header-nav,
.header-nav nav,
.header-account { display: flex; flex-wrap: wrap; align-items: center; }
.header-nav { justify-content: space-between; column-gap: .35rem; }
.header-nav nav,
.header-account { gap: 0 .25rem; }
.header-link {
  box-sizing: border-box;
  display: inline-flex;
  gap: .35rem;
  align-items: center;
  min-height: 44px;
  padding: .25rem .35rem;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--fp-navy);
  font: inherit;
  font-size: .8rem;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}
.header-link svg { display: none; flex: none; }
.header-link:hover, .header-link:is([aria-current="page"], [aria-current="location"]) { color: var(--fp-blue); text-decoration: underline; text-underline-offset: .25em; }
.register-link { color: var(--fp-blue); }
.company-link { display: none; }

@media (min-width: 680px) {
  .header-main { grid-template-columns: minmax(210px, .7fr) minmax(0, 1.8fr) .2fr; gap: 1.25rem; padding-block: 1rem; }
  .header-search input { padding-inline: 1rem; }
  .header-search button { padding-inline: 1rem; }
  .header-link { padding-inline: .75rem; font-size: .875rem; }
  .header-nav nav, .header-account { gap: .5rem; }
  .header-nav nav { margin-inline-start: -.75rem; }
  .header-account { margin-inline-end: -.75rem; }
  .header-link svg, .company-link { display: inline-flex; }
}
</style>
