<script setup lang="ts">
import CommerceIcon from './CommerceIcon.vue'
import heroArt from '@/assets/brand/contours.svg'

defineProps<{ businessRoute: string; businessLabel: string }>()
</script>

<template>
  <section class="hero fp-dark" aria-labelledby="home-title">
    <div class="fp-shell hero-inner">
      <div class="hero-content">
        <p class="fp-kicker">Ferretería industrial</p>
        <h1 id="home-title">Equipá tu trabajo <em>industrial.</em></h1>
        <p class="hero-copy">Herramientas e insumos para talleres, obras y empresas. Buscá por nombre o código y consultá la disponibilidad en el catálogo.</p>
        <div class="hero-actions">
          <RouterLink :to="{ name: 'catalogo' }" class="fp-action fp-action--amber fp-focus">
            Explorar catálogo <CommerceIcon name="arrow" />
          </RouterLink>
          <RouterLink :to="{ name: businessRoute }" class="fp-action fp-action--dark fp-focus">
            {{ businessLabel }}
          </RouterLink>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <img :src="heroArt" alt="" width="820" height="540" fetchpriority="high" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  overflow: hidden;
  color: white;
  background: radial-gradient(ellipse at 75% 45%, var(--fp-steel), var(--fp-navy) 75%);
  border-bottom: 4px solid var(--fp-amber);
}
.hero-inner { position: relative; isolation: isolate; display: grid; }
.hero-content { position: relative; z-index: 1; padding-block: clamp(28px, 4.4vw, 70px) 0; }
h1 {
  margin: .8rem 0 0;
  font-size: clamp(2.7rem, 6vw, 5.6rem);
  line-height: .94;
  letter-spacing: -.068em;
  font-weight: 800;
}
h1 em { display: block; color: var(--fp-amber-light); font-style: normal; }
.hero-copy { max-width: 44ch; margin: 1.1rem 0 1.45rem; color: var(--fp-ink-soft); font-size: clamp(.95rem, 1.4vw, 1.125rem); }
.hero-actions { display: flex; flex-wrap: wrap; gap: .55rem; }
.hero-art { position: relative; min-height: 115px; pointer-events: none; }
.hero-art img { position: absolute; right: -16px; bottom: -18px; width: clamp(225px, 54vw, 290px); height: auto; }
.hero-actions .fp-action { padding-inline: .7rem; }

@media (min-width: 680px) {
  .hero-inner { grid-template-columns: minmax(0, 1.13fr) minmax(0, 1fr); }
  .hero-content { padding-block-end: clamp(36px, 5vw, 74px); }
  .hero-art img { width: clamp(510px, 63vw, 840px); right: calc(-1 * var(--fp-gutter)); bottom: 50%; transform: translateY(50%); }
  .hero-actions .fp-action { padding-inline: 1.15rem; }
}
</style>
