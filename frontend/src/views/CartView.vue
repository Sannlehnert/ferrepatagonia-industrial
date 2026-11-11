<script setup lang="ts">
import { useRouter } from 'vue-router'
import CartContents from '@/components/CartContents.vue'

const router = useRouter()

function handleGoBack() {
  if (typeof window !== 'undefined' && window.history.state?.back) {
    router.back()
  } else {
    void router.push('/catalogo')
  }
}
</script>

<template>
  <main
    class="box-border mx-auto w-full max-w-3xl
      px-4 py-6 sm:px-6 lg:py-10"
  >
    <button
      type="button"
      class="md:hidden min-h-[44px] inline-flex items-center gap-1.5 text-sm font-medium text-[#103A5C] hover:text-[#145A8D] mb-2 bg-transparent border-0 p-0 cursor-pointer"
      aria-label="Volver"
      @click="handleGoBack"
    >
      ← Volver
    </button>

    <h1 class="mb-6 mt-0 text-2xl font-semibold text-[#0B2438]">
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