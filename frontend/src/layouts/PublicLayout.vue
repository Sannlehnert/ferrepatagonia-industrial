<script setup lang="ts">
import { RouterView } from 'vue-router'
import PublicHeader from '@/components/PublicHeader.vue'
import PublicFooter from '@/components/PublicFooter.vue'
</script>

<template>
  <div class="flex min-h-screen flex-col bg-[#f8fafc]">
    <PublicHeader />

    <div class="min-w-0 flex-1">
      <RouterView />
    </div>

    <PublicFooter />
  </div>
</template>