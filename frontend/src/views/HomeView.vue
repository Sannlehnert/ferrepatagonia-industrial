<script setup lang="ts">
import { RouterLink } from 'vue-router'
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

    <section
      class="box-border mx-auto w-full max-w-[1440px] px-4 pb-10 text-[#0b2438] sm:px-6 lg:px-10"
      aria-labelledby="home-catalog-title"
    >
      <h2
        id="home-catalog-title"
        class="m-0 text-2xl leading-tight font-bold"
      >
        Explorá nuestro catálogo
      </h2>

      <p class="mt-4 mb-6 text-base text-slate-600">
        Encontrá productos y consultá su disponibilidad.
      </p>

      <RouterLink
        :to="{ name: 'catalogo' }"
        class="box-border inline-flex min-h-11 items-center justify-center rounded-lg bg-[#103a5c] px-6 py-3 font-bold text-white no-underline hover:bg-[#0b2438] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2b7bbb]"
      >
        Ver catálogo
      </RouterLink>
    </section>
  </main>
</template>