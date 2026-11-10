<script setup lang="ts">
import CommerceIcon from './CommerceIcon.vue'
import PublicBrand from './PublicBrand.vue'
import contour from '@/assets/brand/contours.svg'

defineProps<{
  title: string
  intro: string
  panelTitle: string
  panelCopy: string
  registration?: boolean
}>()
</script>

<template>
  <div class="auth-page fp-public">
    <header class="auth-header fp-shell">
      <PublicBrand />
      <RouterLink :to="{ name: 'home' }" class="auth-back fp-focus">
        <CommerceIcon name="back" /> Volver a la tienda
      </RouterLink>
    </header>

    <main class="fp-shell auth-shell" :class="{ 'auth-shell--registration': registration }">
      <div class="auth-panel">
        <div class="auth-editorial fp-dark">
          <div class="auth-editorial-copy">
            <p class="fp-kicker">Tienda industrial</p>
            <p class="auth-editorial-title">{{ panelTitle }}</p>
            <p class="auth-editorial-description">{{ panelCopy }}</p>
          </div>
          <img :src="contour" alt="" width="820" height="540" />
        </div>
        <section class="auth-content" aria-labelledby="auth-title">
          <header class="auth-intro">
            <p class="fp-kicker">Mi cuenta</p>
            <h1 id="auth-title" class="fp-section-title">{{ title }}</h1>
            <p>{{ intro }}</p>
          </header>
          <slot />
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.auth-page { min-height: 100vh; background: var(--fp-bg); }
.auth-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: .2rem 1rem;
  padding-block: .6rem;
}
.auth-back {
  display: inline-flex;
  align-items: center;
  gap: .4rem;
  min-height: 44px;
  color: var(--fp-blue);
  font-size: .85rem;
  font-weight: 700;
  text-decoration: none;
}
.auth-back:hover { text-decoration: underline; }
.auth-back svg { width: 16px; height: 16px; }
.auth-shell { padding-block: clamp(8px, 3vw, 42px) 2rem; }
.auth-panel {
  display: grid;
  max-width: 1110px;
  margin-inline: auto;
  border: 1px solid var(--fp-line);
  border-radius: var(--fp-radius-panel);
  background: white;
  box-shadow: var(--fp-shadow);
}
.auth-editorial { display: none; }
.auth-content { min-width: 0; padding: clamp(18px, 4vw, 50px); }
.auth-intro { margin-bottom: clamp(20px, 3vw, 32px); }
.auth-intro > p:last-child { max-width: 54ch; margin: .65rem 0 0; color: var(--fp-muted); }

@media (min-width: 740px) {
  .auth-header { padding-block: .85rem; }
  .auth-panel { grid-template-columns: minmax(0, .9fr) minmax(0, 1fr); }
  .auth-shell--registration { padding-top: 1rem; }
  .auth-shell--registration .auth-panel { grid-template-columns: minmax(0, .68fr) minmax(0, 1.32fr); }
  .auth-shell--registration .auth-content { padding: clamp(24px, 3vw, 40px); }
  .auth-editorial {
    isolation: isolate;
    position: relative;
    display: flex;
    align-items: center;
    min-height: 440px;
    overflow: hidden;
    border-radius: var(--fp-radius-panel) 0 0 var(--fp-radius-panel);
    background: var(--fp-navy);
    color: white;
  }
  .auth-editorial-copy { position: relative; z-index: 1; padding: clamp(24px, 4vw, 60px); }
  .auth-editorial-title { margin: .7rem 0; max-width: 13ch; font-size: clamp(1.85rem, 4vw, 3.65rem); line-height: .99; letter-spacing: -.055em; font-weight: 800; }
  .auth-editorial-description { max-width: 30ch; margin: 1rem 0 0; color: var(--fp-ink-soft); }
  .auth-editorial img {
    position: absolute;
    right: -29%;
    bottom: -16%;
    width: 150%;
    height: auto;
    opacity: .54;
    mask-image: linear-gradient(145deg, transparent 30%, #000 85%);
  }
  .auth-shell--registration .auth-editorial { align-items: flex-start; }
  .auth-shell--registration .auth-editorial-title { font-size: clamp(1.8rem, 3.5vw, 3.15rem); }
}
</style>
