<script setup lang="ts">
import CommerceIcon from './CommerceIcon.vue'
import ProductThumbnail from './ProductThumbnail.vue'

defineProps<{ image?: string | null; name: string }>()
</script>

<template>
  <div class="product-media">
    <ProductThumbnail :image="image" :alt="name">
      <CommerceIcon name="box" />
    </ProductThumbnail>
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
.product-media :deep(img) {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 10px;
  object-fit: contain;
  background: white;
}
</style>
