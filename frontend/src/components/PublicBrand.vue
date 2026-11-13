<script setup lang="ts">
import horizontal from '@/assets/brand/horizontal.svg'
import horizontalDark from '@/assets/brand/horizontal-dark.svg'

defineProps<{ inverse?: boolean }>()
</script>

<template>
  <RouterLink
    :to="{ name: 'home' }"
    aria-label="Ferrepatagonia Industrial — Inicio"
    class="fp-brand fp-focus"
  >
    <img :src="inverse ? horizontalDark : horizontal" alt="" width="246" height="42" />
  </RouterLink>
</template>

<style scoped>
.fp-brand {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 44px;
  max-width: 100%;
}
.fp-brand img {
  display: block;
  width: var(--fp-brand-width, clamp(174px, 18vw, 224px));
  height: auto;
  max-width: 100%;
}
</style>
