<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getProductImageSource } from '@/utils/productImage'

const props = defineProps<{ image?: string | null; alt: string; imageClass?: string }>()
const source = computed(() => getProductImageSource(props.image))
const failed = ref(false)
watch(source, () => { failed.value = false })
</script>

<template>
  <img v-if="source && !failed" :key="source" :src="source" :alt="alt" :class="imageClass"
    loading="lazy" decoding="async" @error="failed = true" />
  <slot v-else />
</template>
