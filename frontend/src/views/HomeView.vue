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
      route: 'cuenta-dashboard',
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

    <section id="empresas" tabindex="-1" class="fp-section business" aria-labelledby="business-title">
      <div class="fp-shell business-panel">
          <div class="business-lead">
            <p class="fp-kicker">Atención comercial</p>
            <h2 id="business-title" class="fp-section-title">Ferrepatagonia para empresas</h2>
          </div>
          <div class="business-detail">
            <p class="business-copy">{{ business.description }}</p>
            <div class="business-actions">
              <RouterLink :to="{ name: business.route }" class="fp-action fp-action--primary fp-focus">
                {{ auth.isAuthenticated ? business.label : 'Ingresar como empresa' }}
                <CommerceIcon name="arrow" />
              </RouterLink>
              <RouterLink v-if="!auth.isAuthenticated" :to="{ name: 'registro', query: { tipo: 'empresa' } }" class="business-register fp-focus">
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
.business { background: #f7eddb; border-top: 1px solid #ead9ba; }
.business-panel {
  display: grid;
  gap: 1.25rem;
  align-items: center;
}
.business-lead .fp-section-title { max-width: 15ch; }
.business-detail {
  border-inline-start: 2px solid #ba761c;
  padding-inline-start: clamp(16px, 3vw, 44px);
}
.business-copy { max-width: 51ch; margin: 0; color: var(--fp-navy); font-size: clamp(.94rem, 1.6vw, 1.08rem); }
.business-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem 1rem; margin-top: 1rem; }
.business-register {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--fp-blue-strong);
  font-size: .86rem;
  font-weight: 700;
  text-underline-offset: .22em;
}
@media (min-width: 760px) {
  .business-panel { grid-template-columns: minmax(0, .94fr) minmax(0, 1fr); gap: 2rem; }
}
</style>
