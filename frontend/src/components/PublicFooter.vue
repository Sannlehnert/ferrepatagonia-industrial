<script setup lang="ts">
import { computed } from 'vue'
import PublicBrand from './PublicBrand.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const year = new Date().getFullYear()
const accountLinks = computed(() => {
  if (auth.rol === 'ADMIN') return [{ label: 'Panel de administración', route: 'admin-dashboard' }]
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
</script>

<template>
  <footer class="store-footer fp-dark">
    <div class="fp-shell">
      <div class="footer-grid">
        <div class="footer-brand">
          <PublicBrand inverse />
          <p>Herramientas, insumos y equipamiento industrial. Explorá el catálogo y consultá la disponibilidad de cada producto.</p>
        </div>

        <nav aria-labelledby="footer-catalog-title">
          <h2 id="footer-catalog-title">Explorar el catálogo</h2>
          <ul>
            <li><RouterLink :to="{ name: 'catalogo' }" class="fp-focus">Ver productos</RouterLink></li>
            <li><RouterLink :to="{ name: 'home', hash: '#categorias' }" aria-current-value="false" class="fp-focus">Categorías</RouterLink></li>
          </ul>
        </nav>

        <nav aria-labelledby="footer-account-title">
          <h2 id="footer-account-title">{{ auth.rol === 'ADMIN' ? 'Administración' : 'Mi cuenta' }}</h2>
          <ul>
            <li v-for="link in accountLinks" :key="link.route">
              <RouterLink :to="{ name: link.route }" class="fp-focus">{{ link.label }}</RouterLink>
            </li>
          </ul>
        </nav>

        <nav aria-labelledby="footer-access-title">
          <h2 id="footer-access-title">Accesos útiles</h2>
          <ul>
            <li><RouterLink :to="{ name: 'home', hash: '#empresas' }" aria-current-value="false" class="fp-focus">Área empresas</RouterLink></li>
            <li><RouterLink :to="{ name: 'home' }" class="fp-focus">Inicio</RouterLink></li>
          </ul>
        </nav>
      </div>
      <p class="footer-legal">© {{ year }} Ferrepatagonia Industrial</p>
    </div>
  </footer>
</template>

<style scoped>
.store-footer { background: var(--fp-navy); color: white; }
.footer-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.25rem;
  padding-block: clamp(32px, 5vw, 60px);
}
.footer-brand { grid-column: 1 / -1; }
.footer-brand p { max-width: 31ch; margin: .75rem 0 0; color: #c9dae8; font-size: .88rem; }
h2 { margin: 0 0 .35rem; font-size: .77rem; letter-spacing: .1em; text-transform: uppercase; }
ul { list-style: none; margin: 0; padding: 0; }
nav a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  border-radius: 3px;
  color: #d9e8f4;
  text-decoration: none;
  font-size: .88rem;
}
nav a:hover { color: white; text-decoration: underline; }
.footer-legal {
  margin: 0;
  padding-block: 1rem;
  border-top: 1px solid #375367;
  color: #c9dae8;
  font-size: .78rem;
}
@media (min-width: 680px) {
  .footer-grid { grid-template-columns: 1.75fr repeat(3, 1fr); }
  .footer-brand { grid-column: auto; }
}
</style>
