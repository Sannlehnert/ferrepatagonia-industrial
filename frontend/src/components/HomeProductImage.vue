<script setup lang="ts">
import { ref, watch } from 'vue'
import CommerceIcon from './CommerceIcon.vue'
import { getCatalogProduct } from '@/services/catalogService'
import { getProductImageSource } from '@/utils/productImage'

const props = defineProps<{ productId: number; name: string }>()
const source = ref<string | null>(null)

// The list DTO has no image. Each of the four Home cards can use its public detail.
watch(() => props.productId, async (id, _previous, onCleanup) => {
  source.value = null
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  try {
    const detail = await getCatalogProduct(id, controller.signal)
    if (!controller.signal.aborted) source.value = getProductImageSource(detail.imagen)
  } catch {
    // An unavailable detail or image leaves the card's visual placeholder in place.
  }
}, { immediate: true })
</script>

<template>
  <div class="product-media">
    <img v-if="source" :key="source" :src="source" :alt="name" loading="lazy" decoding="async" @error="source = null" />
    <CommerceIcon v-else name="box" />
  </div>
</template>

<style scoped>
.product-media {
  display: grid;
  place-items: center;
  overflow: hidden;
  aspect-ratio: 1.7;
  border-bottom: 1px solid var(--fp-line);
  color: #527a97;
  background: repeating-linear-gradient(135deg, #edf3f8 0 9px, var(--fp-bg) 9px 18px);
}
.product-media svg {
  box-sizing: content-box;
  width: 32px;
  height: 32px;
  padding: 11px;
  border: 1px solid var(--fp-line);
  border-radius: var(--fp-radius);
  background: white;
}
.product-media img {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 10px;
  object-fit: contain;
  background: white;
}
</style>
