<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import CommerceIcon from './CommerceIcon.vue'
import PublicBrand from './PublicBrand.vue'
import { getNavigableMenu, publicMenu } from '@/config/menu'
import { getPermissionsForRole } from '@/config/permissions'
import { useNavigationDisclosure } from '@/composables/useNavigationDisclosure'
import { useAuthStore } from '@/stores/auth'
import { useCartPanelStore } from '@/stores/cartPanel'

const emit = defineEmits<{ navigate: [] }>()
const auth = useAuthStore()
const cartPanel = useCartPanelStore()
const router = useRouter()
const route = useRoute()
const search = ref('')
const { expanded, trigger, panel, close, toggle, escape } = useNavigationDisclosure()

watch(
  () => [route.name, route.query.busqueda] as const,
  ([name, busqueda]) => {
    search.value = name === 'catalogo' && typeof busqueda === 'string' ? busqueda : ''
  },
  { immediate: true },
)

const navigation = computed(() => getNavigableMenu(publicMenu, getPermissionsForRole(auth.rol))
  .filter(item => router.hasRoute(item.routeName)))
const institutional = computed(() => navigation.value.filter(item =>
  item.id === 'public-about' || item.id === 'public-faq',
))
const catalog = computed(() => navigation.value.find(item => item.id === 'public-catalog'))
const account = computed(() => {
  if (auth.rol === 'ADMIN') {
    const admin = navigation.value.find(item => item.id === 'public-admin-panel')
    return admin ? { label: admin.label, route: admin.routeName } : null
  }
  if (auth.rol === 'CLIENTE') return { label: 'Mi cuenta', route: 'cuenta-datos' }
  return { label: 'Ingresar', route: 'login' }
})

async function finishNavigation() {
  if (!expanded.value) return
  close()
  await nextTick()
  emit('navigate')
}

watch(() => route.fullPath, finishNavigation)

function followCurrentLink(event: MouseEvent) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  const link = event.target instanceof Element ? event.target.closest('a') : null
  if (link?.getAttribute('href') === route.fullPath) void finishNavigation()
}

async function submitSearch() {
  const busqueda = search.value.trim()
  await router.push({ name: 'catalogo', query: busqueda ? { busqueda } : {} })
  await finishNavigation()
}
</script>

<template>
  <header class="store-header" @keydown.esc="escape">
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
          placeholder="Nombre o código de producto"
          class="fp-input fp-focus"
        />
        <button type="submit" aria-label="Buscar" class="fp-action fp-action--primary fp-focus">
          <CommerceIcon name="search" /> <span>Buscar</span>
        </button>
      </form>

      <button
        v-if="auth.rol === 'CLIENTE'"
        type="button"
        class="header-control header-cart fp-focus"
        aria-label="Carrito"
        aria-haspopup="dialog"
        :aria-expanded="cartPanel.visible"
        @click="close(); cartPanel.open()"
      >
        <CommerceIcon name="cart" /> <span>Carrito</span>
      </button>
      <button
        ref="trigger"
        type="button"
        class="header-control header-toggle fp-focus"
        aria-label="Menú principal"
        aria-controls="store-navigation"
        :aria-expanded="expanded"
        @click="toggle"
      >
        <CommerceIcon :name="expanded ? 'close' : 'menu'" />
      </button>
    </div>

    <div id="store-navigation" ref="panel" class="header-strip" :class="{ 'is-open': expanded }" @click="followCurrentLink">
      <div class="fp-shell header-nav">
        <nav aria-label="Menú principal">
          <RouterLink v-if="catalog" :to="{ name: catalog.routeName }" class="header-link fp-focus">{{ catalog.label }}</RouterLink>
          <RouterLink
            :to="{ name: 'home', hash: '#categorias' }"
            :aria-current-value="route.name === 'home' && route.hash === '#categorias' ? 'location' : 'false'"
            class="header-link fp-focus"
          >Categorías</RouterLink>
          <RouterLink
            :to="{ name: 'home', hash: '#empresas' }"
            :aria-current-value="route.name === 'home' && route.hash === '#empresas' ? 'location' : 'false'"
            class="header-link fp-focus"
          >Empresas</RouterLink>
          <RouterLink v-for="item in institutional" :key="item.id" :to="{ name: item.routeName }" class="header-link fp-focus">
            {{ item.label }}
          </RouterLink>
        </nav>
        <div class="header-account">
          <RouterLink v-if="account" :to="{ name: account.route }" class="header-link fp-focus">
            <CommerceIcon name="user" /> {{ account.label }}
          </RouterLink>
          <RouterLink v-if="!auth.isAuthenticated" :to="{ name: 'registro' }" class="header-link register-link fp-focus">
            Crear cuenta <CommerceIcon name="arrow" />
          </RouterLink>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.store-header { position: relative; z-index: 2; background: white; color: var(--fp-navy); }
.header-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: .5rem;
  padding-block: .45rem .75rem;
}
.header-main .fp-brand { grid-column: 1 / -1; }
.header-main:has(.header-cart) { grid-template-columns: minmax(0, 1fr) auto auto; }
.header-search { display: flex; min-width: 0; }
.header-search input { border-radius: var(--fp-radius) 0 0 var(--fp-radius); border-right: 0; background: var(--fp-bg); }
.header-search button { flex: none; border-radius: 0 var(--fp-radius) var(--fp-radius) 0; padding-inline: .7rem; }
.header-control {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .45rem;
  min-height: 46px;
  min-width: 44px;
  padding-inline: .5rem;
  border: 1px solid var(--fp-control-line);
  border-radius: var(--fp-radius);
  background: white;
  color: var(--fp-navy);
  font: inherit;
  font-size: .88rem;
  font-weight: 700;
  cursor: pointer;
}
.header-control:hover, .header-control[aria-expanded="true"] { background: var(--fp-bg); color: var(--fp-blue); }
.header-cart span, .header-search button span { display: none; }
.header-strip { display: none; border-block: 1px solid var(--fp-line); background: var(--fp-bg); }
.header-strip.is-open { display: block; }
.header-nav { display: grid; gap: .5rem; padding-block: .55rem .8rem; }
.header-nav nav, .header-account { display: grid; }
.header-account { border-top: 1px solid var(--fp-line); padding-top: .45rem; }
.header-link {
  display: inline-flex;
  align-items: center;
  gap: .5rem;
  min-height: 44px;
  padding-inline: .7rem;
  border-radius: var(--fp-radius);
  color: inherit;
  font-size: .88rem;
  font-weight: 700;
  text-decoration: none;
}
.header-link:hover, .header-link:is([aria-current="page"], [aria-current="location"]) {
  background: #e6eff6;
  color: var(--fp-blue);
  text-decoration: underline;
  text-underline-offset: .24em;
}
.register-link { color: var(--fp-blue); }

@media (min-width: 900px) {
  .header-main, .header-main:has(.header-cart) {
    grid-template-columns: minmax(220px, 1fr) minmax(0, 2.2fr) minmax(120px, .5fr);
    gap: clamp(16px, 3vw, 48px);
    padding-block: .85rem;
  }
  .header-main .fp-brand { grid-column: auto; }
  .header-cart { justify-self: end; padding-inline: .85rem; }
  .header-cart span, .header-search button span { display: inline; }
  .header-search button { padding-inline: 1rem; }
  .header-strip { display: block; }
  .header-toggle { display: none; }
  .header-nav { display: flex; justify-content: space-between; padding-block: .15rem; }
  .header-nav nav, .header-account { display: flex; align-items: center; gap: .25rem; }
  .header-nav nav { margin-inline-start: -.7rem; }
  .header-account { border: 0; padding-top: 0; }
}
@media (max-width: 899px) {
  .header-main .fp-brand { --fp-brand-width: 190px; }
}
</style>
