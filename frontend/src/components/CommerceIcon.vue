<script setup lang="ts">
defineProps<{ name: 'arrow' | 'back' | 'search' | 'user' | 'cart' | 'grid' | 'box' | 'building' | 'menu' | 'close' | 'exit' }>()
</script>

<template>
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path v-if="name === 'arrow'" d="M4 12h15m-6-6 6 6-6 6" />
    <path v-else-if="name === 'back'" d="M20 12H5m6-6-6 6 6 6" />
    <path v-else-if="name === 'menu'" d="M4 6h16M4 12h16M4 18h16" />
    <path v-else-if="name === 'close'" d="m6 6 12 12M18 6 6 18" />
    <path v-else-if="name === 'exit'" d="M11 4H5v16h6m1-8h9m-4-4 4 4-4 4" />
    <g v-else-if="name === 'search'"><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4 4" /></g>
    <g v-else-if="name === 'user'"><circle cx="12" cy="8" r="3" /><path d="M5 20v-2a7 7 0 0 1 14 0v2" /></g>
    <g v-else-if="name === 'cart'"><path d="M2 4h3l3 11h11l2-8H6" /><circle cx="9" cy="19" r="1" /><circle cx="18" cy="19" r="1" /></g>
    <path v-else-if="name === 'grid'" d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z" />
    <path v-else-if="name === 'box'" d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 10 9-5M12 13 3 8m9 5v9m-4.5-16.5 9 5" />
    <path v-else d="M3 21h18M5 21V9l7-4v16m0-8h7v8M8 12h1m-1 4h1m6 0h1" />
  </svg>
</template>
