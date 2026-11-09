<script setup lang="ts">
import CommerceIcon from './CommerceIcon.vue'
import heroArt from '@/assets/home/industrial-blueprint.svg'

defineProps<{ businessRoute: string; businessLabel: string }>()
</script>

<template>
  <section class="hero fp-dark" aria-labelledby="home-title">
    <div class="fp-shell hero-inner">
      <div class="hero-content">
        <p class="fp-kicker">Suministros industriales</p>
        <h1 id="home-title">Equipamiento industrial para cada desafío.</h1>
        <p class="hero-copy">Encontrá herramientas, insumos y productos para tu actividad en un solo lugar.</p>
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
        <img :src="heroArt" alt="" width="680" height="420" fetchpriority="high" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  overflow: hidden;
  color: white;
  background: #0b2438;
  border-bottom: 4px solid #145a8d;
}
.hero-inner { display: grid; }
.hero-content {
  position: relative;
  z-index: 1;
  padding-block: clamp(34px, 4.2vw, 58px) .75rem;
}
h1 {
  max-width: 13ch;
  margin: .9rem 0 .75rem;
  font-size: clamp(2.15rem, 5.4vw, 4.25rem);
  line-height: .99;
  letter-spacing: -.055em;
  text-wrap: balance;
}
.hero-copy {
  max-width: 38ch;
  margin: 1.1rem 0 1.45rem;
  color: #d2e3ef;
  font-size: clamp(.98rem, 1.4vw, 1.13rem);
}
.hero-actions { display: flex; flex-wrap: wrap; gap: .6rem; }
.hero-art {
  display: grid;
  justify-items: end;
  align-items: center;
  min-width: 0;
}
.hero-art img {
  display: block;
  width: min(100%, 640px);
  height: clamp(120px, 35vw, 200px);
  object-fit: cover;
  object-position: center 49%;
}
@media (max-width: 679px) {
  .hero-actions .fp-action { padding-inline: .7rem; }
}
@media (min-width: 680px) {
  .hero-inner { grid-template-columns: 1fr .93fr; }
  .hero-content { padding-bottom: clamp(38px, 4.2vw, 58px); }
  .hero-art img {
    height: auto;
    width: 117%;
    max-width: 680px;
    margin-right: -1.8rem;
  }
}
</style>
