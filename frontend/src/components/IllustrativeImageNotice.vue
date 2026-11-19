<script setup lang="ts">
defineProps<{ id?: string }>()
</script>

<template>
  <p
    :id="id"
    role="note"
    class="m-0 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-sm font-medium leading-snug text-amber-950"
  >
    Imagen ilustrativa: no representa el modelo ni la variante exacta.
  </p>
</template>
