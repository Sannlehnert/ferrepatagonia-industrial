<script setup lang="ts">
import HomeHero from '@/components/HomeHero.vue'
import HomeCategories from '@/components/HomeCategories.vue'
import HomeRecommended from '@/components/HomeRecommended.vue'
</script>

<template>
  <main aria-labelledby="home-title">
    <h1 id="home-title" class="sr-only">
      Ferrepatagonia Industrial
    </h1>

    <HomeHero />
    <HomeCategories />
    <HomeRecommended />
  </main>
</template>