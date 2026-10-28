<script setup lang="ts">
import heroImage from '@/assets/home/hero.png'
</script>

<template>
  <div class="bg-[#f8fafc] py-6 sm:py-8 lg:py-12">
    <div class="w-full">
      <img
        :src="heroImage"
        alt="Supply Chains Simplified. Featuring Body Guard Safety Solutions. Guante de protección industrial."
        width="1888"
        height="628"
        fetchpriority="high"
        class="block h-auto w-full lg:aspect-[9/2] lg:object-cover"
      />
    </div>
  </div>
</template>