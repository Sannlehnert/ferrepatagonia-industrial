<script setup lang="ts">
defineOptions({ inheritAttrs: false })
defineProps<{ id: string; label: string; error?: string | null }>()
const value = defineModel<string>({ required: true })
</script>

<template>
  <div class="auth-field">
    <label :for="id">{{ label }}</label>
    <div class="auth-field-control">
      <input
        v-bind="$attrs"
        :id="id"
        v-model="value"
        class="fp-input fp-focus"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? id + '-error' : undefined"
      />
      <slot />
    </div>
    <small v-if="error" :id="id + '-error'" class="fp-error">{{ error }}</small>
  </div>
</template>

<style scoped>
.auth-field { display: grid; align-content: start; gap: .35rem; min-width: 0; }
label { font-size: .875rem; font-weight: 700; }
.auth-field-control { display: flex; align-items: stretch; gap: .4rem; }
.auth-field-control input { flex: 1; }
small { font-size: .825rem; line-height: 1.35; }
</style>
