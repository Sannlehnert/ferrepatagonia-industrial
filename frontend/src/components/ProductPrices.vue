<script setup lang="ts">
import { toRef } from 'vue'
import { useProductPrices } from '@/composables/useProductPrices'
import type { CatalogProduct } from '@/types/catalog'
const props = defineProps<{ products: CatalogProduct[]; catalogLoading: boolean }>()
const { prices, loading, error, personalized, retry } = useProductPrices(toRef(props, 'products'), toRef(props, 'catalogLoading'))
</script>

<template>
  <div v-if="error" role="alert" class="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-slate-800">
    {{ error }}
    <button type="button" class="ml-2 min-h-11 underline" @click="retry">Reintentar precios</button>
  </div>
  <slot :prices="prices" :loading="loading" :error="error" :personalized="personalized" />
</template>
