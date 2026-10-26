<script setup lang="ts">
defineProps<{
  msg: string
}>()
</script>

<template>
  <div class="greetings">
    <h1 class="relative m-0 -top-2.5 text-center text-[2.6rem] font-medium min-[1024px]:text-left">{{ msg }}</h1>
    <h3 class="m-0 text-center text-xl min-[1024px]:text-left">
      You’ve successfully created a project with
      <a href="https://vite.dev/" target="_blank" rel="noopener">Vite</a> +
      <a href="https://vuejs.org/" target="_blank" rel="noopener">Vue 3</a>.
    </h3>
  </div>
</template>
