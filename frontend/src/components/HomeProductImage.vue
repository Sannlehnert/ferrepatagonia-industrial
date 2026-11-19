<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import CommerceIcon from './CommerceIcon.vue'
import IllustrativeImageNotice from './IllustrativeImageNotice.vue'
import ProductThumbnail from './ProductThumbnail.vue'
import { isIllustrativeDemoImage } from '@/utils/illustrativeDemoImage'

const props = defineProps<{ codigo: string; image?: string | null; name: string }>()
const failedImage = ref(false)
const isIllustrativeImage = computed(() =>
  isIllustrativeDemoImage(props.codigo, props.image),
)
const noticeId = computed(() => `home-product-image-note-${props.codigo}`)

watch(() => props.image, () => {
  failedImage.value = false
})
</script>

<template>
  <div class="product-media">
    <div class="product-media-content">
      <ProductThumbnail
        :image="props.image"
        :alt="props.name"
        :described-by="isIllustrativeImage && !failedImage ? noticeId : undefined"
        @image-error="failedImage = true"
      >
        <CommerceIcon name="box" />
      </ProductThumbnail>
      <IllustrativeImageNotice
        v-if="isIllustrativeImage && !failedImage"
        :id="noticeId"
        class="mx-2 mb-2"
      />
    </div>
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
.product-media-content {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: .35rem;
  width: 100%;
  height: 100%;
  min-height: 0;
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
