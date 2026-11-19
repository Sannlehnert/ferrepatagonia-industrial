<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getProductImageSource } from '@/utils/productImage'

const props = defineProps<{
  image?: string | null
  alt: string
  imageClass?: string
  describedBy?: string
}>()
const emit = defineEmits<{ imageError: [] }>()
const source = computed(() => getProductImageSource(props.image))
const failed = ref(false)
watch(source, () => { failed.value = false })

function handleImageError() {
  failed.value = true
  emit('imageError')
}
</script>

<template>
  <img v-if="source && !failed" :key="source" :src="source" :alt="alt" :class="imageClass"
    :aria-describedby="describedBy" loading="lazy" decoding="async" @error="handleImageError" />
  <slot v-else />
</template>
