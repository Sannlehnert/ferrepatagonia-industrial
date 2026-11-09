<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import CommerceIcon from '@/components/CommerceIcon.vue'
import HomeHero from '@/components/HomeHero.vue'
import HomeCategories from '@/components/HomeCategories.vue'
import HomeRecommended from '@/components/HomeRecommended.vue'
import { getCuentaCorriente } from '@/services/cuentaCorrienteService'
import { useAuthStore } from '@/stores/auth'
import type { CuentaCorrienteConsulta } from '@/types/cuentaCorriente'

const auth = useAuthStore()
const company = computed(() => auth.rol === 'CLIENTE' && auth.user?.tipo_cliente === 'EMPRESA')
const accountStatus = ref<CuentaCorrienteConsulta['estado'] | null>(null)

watch(
  [company, () => auth.sessionVersion],
  async ([isCompany], _previous, onCleanup) => {
    accountStatus.value = null
    if (!isCompany) return

    const controller = new AbortController()
    onCleanup(() => controller.abort())
    try {
      const summary = await getCuentaCorriente(controller.signal)
      if (!controller.signal.aborted) accountStatus.value = summary.estado
    } catch {
      // El acceso a la cuenta sigue disponible si el resumen no pudo verificarse.
    }
  },
  { immediate: true },
)

const business = computed(() => {
  if (auth.rol === 'ADMIN') {
    return {
      route: 'admin-accounts',
      label: 'Gestionar cuentas',
      description: 'Consultá las cuentas corrientes de clientes desde el panel de administración.',
    }
  }
  if (company.value) {
    if (accountStatus.value === 'HABILITADA') {
      return {
        route: 'cuenta-corriente',
        label: 'Ver cuenta corriente',
        description: 'Tu cuenta corriente está habilitada. Consultá su estado y movimientos desde tu cuenta.',
      }
    }
    return {
      route: 'cuenta-corriente',
      label: 'Consultar estado de cuenta',
      description: accountStatus.value === 'INHABILITADA'
        ? 'Tu cuenta corriente está inhabilitada. Podés consultar su estado desde tu cuenta.'
        : 'Las condiciones comerciales para empresas se evalúan por separado. Consultá el estado de tu cuenta corriente.',
    }
  }
  if (auth.rol === 'CLIENTE') {
    return {
      route: 'cuenta-datos',
      label: 'Ir a mi cuenta',
      description: 'Estás navegando con una cuenta particular. Desde tu perfil podés consultar tus datos y pedidos.',
    }
  }
  return {
    route: 'login',
    label: 'Acceso empresas',
    description: 'Atendemos a empresas que buscan herramientas e insumos industriales. Las condiciones comerciales y la cuenta corriente están sujetas a evaluación y habilitación.',
  }
})
</script>

<template>
  <main class="home" aria-labelledby="home-title">
    <HomeHero :business-route="business.route" :business-label="business.label" />
    <HomeCategories />
    <HomeRecommended />

    <section id="empresas" class="fp-section" aria-labelledby="business-title">
      <div class="fp-shell">
        <div class="business-panel fp-dark">
          <span class="business-icon"><CommerceIcon name="building" /></span>
          <div>
            <p class="fp-kicker">Atención comercial</p>
            <h2 id="business-title" class="fp-section-title">Ferrepatagonia para empresas</h2>
            <p class="business-copy">{{ business.description }}</p>
          </div>
          <div class="business-actions">
            <RouterLink :to="{ name: business.route }" class="fp-action fp-action--dark fp-focus">
              {{ auth.isAuthenticated ? business.label : 'Ingresar como empresa' }}
              <CommerceIcon name="arrow" />
            </RouterLink>
            <RouterLink v-if="!auth.isAuthenticated" :to="{ name: 'registro' }" class="business-register fp-focus">
              Registrá tu empresa
            </RouterLink>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.home { background: var(--fp-bg); }
.business-panel {
  display: grid;
  gap: .9rem;
  align-items: center;
  padding: clamp(22px, 3.6vw, 46px);
  border: 1px solid #2e526d;
  border-left: 4px solid #2b7bbb;
  border-radius: 12px;
  color: white;
  background: #10334d;
}
.business-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border: 1px solid #51758e;
  border-radius: 8px;
  color: #b9d9ef;
}
.business-icon svg { width: 27px; height: 27px; }
.business-copy { max-width: 65ch; margin: .65rem 0 0; color: #d4e4f0; font-size: .95rem; }
.business-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .2rem 1rem; }
.business-register {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: #d7edff;
  font-size: .86rem;
  text-underline-offset: .22em;
}
.business-register:hover { color: white; }

@media (min-width: 760px) {
  .business-panel { grid-template-columns: auto minmax(0, 1fr) auto; gap: 1.5rem; }
  .business-icon { align-self: start; }
  .business-actions { flex-direction: column; align-items: stretch; }
}
</style>
