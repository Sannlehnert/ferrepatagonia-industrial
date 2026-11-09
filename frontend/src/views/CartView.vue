<script setup lang="ts">
import CartContents from '@/components/CartContents.vue'
</script>

<template>
  <main
    class="box-border mx-auto w-full max-w-3xl
      px-4 py-6 sm:px-6 lg:py-10"
  >
    <h1 class="mb-6 mt-0 text-2xl font-semibold text-[#13293a]">
      Tu carrito
    </h1>

    <div
      class="rounded-lg border border-solid
        border-slate-200 bg-white p-4 sm:p-6"
    >
      <CartContents />
    </div>
  </main>
</template>