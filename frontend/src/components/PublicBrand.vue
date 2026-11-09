<script setup lang="ts">
defineProps<{ inverse?: boolean }>()
</script>

<template>
  <RouterLink
    :to="{ name: 'home' }"
    aria-label="Ferrepatagonia Industrial — Inicio"
    class="fp-brand fp-focus"
    :class="{ 'fp-brand--inverse': inverse }"
  >
    <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" fill="none">
      <rect width="40" height="40" rx="9" fill="#145a8d" />
      <path d="m7 27 10-14 6 8 4-5 6 11H7Z" stroke="white" stroke-width="2.2" stroke-linejoin="round" />
      <path d="M24 10h8" stroke="#fbbf53" stroke-width="2.2" />
    </svg>
    <span>
      <strong>Ferrepatagonia</strong>
      <small>Industrial</small>
    </span>
  </RouterLink>
</template>

<style scoped>
.fp-brand {
  display: inline-flex;
  align-items: center;
  gap: .55rem;
  min-width: 0;
  min-height: 44px;
  width: fit-content;
  text-decoration: none;
  color: var(--fp-navy);
}
.fp-brand svg { flex: none; }
.fp-brand strong {
  display: block;
  font-size: clamp(.97rem, 3.5vw, 1.29rem);
  letter-spacing: -.04em;
  line-height: 1.1;
}
.fp-brand small {
  display: block;
  color: var(--fp-blue);
  font-size: .62rem;
  font-weight: 800;
  letter-spacing: .21em;
  line-height: 1.3;
  text-transform: uppercase;
  margin-top: .22rem;
}
.fp-brand--inverse { color: white; }
.fp-brand--inverse small { color: #a7d8fa; }
</style>
