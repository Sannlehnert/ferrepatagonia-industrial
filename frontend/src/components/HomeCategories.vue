<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import axios from 'axios'
import { getCatalogCategories } from '@/services/catalogService'
import type { CatalogCategory } from '@/types/catalog'

const categories = ref<CatalogCategory[]>([])
const loading = ref(true)
const error = ref(false)
let controller: AbortController | null = null

async function loadCategories() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = false

  try {
    const result = await getCatalogCategories(current.signal)
    if (controller !== current || current.signal.aborted) return
    categories.value = result
  } catch (cause) {
    if (axios.isCancel(cause) || current.signal.aborted || controller !== current) return
    error.value = true
  } finally {
    if (controller === current) loading.value = false
  }
}

onMounted(() => {
  void loadCategories()
})

onBeforeUnmount(() => {
  controller?.abort()
})
</script>

<template>
  <section
    id="categorias"
    class="bg-[#e2e8f0] px-4 py-8 text-[#0b2438] sm:px-6 lg:px-10"
    aria-labelledby="home-categories-title"
  >
    <div class="mx-auto max-w-[1440px]">
      <h2
        id="home-categories-title"
        class="m-0 mb-7 text-center text-2xl font-bold"
      >
        Categorías
      </h2>

      <p v-if="loading" class="m-0 text-center" role="status">
        Cargando categorías...
      </p>

      <div v-else-if="error" class="text-center" role="alert">
        <p class="m-0 mb-3">No se pudieron cargar las categorías.</p>
        <button
          type="button"
          class="min-h-11 cursor-pointer rounded-lg border-0 bg-[#103a5c] px-5 font-[inherit] font-bold text-white"
          @click="loadCategories"
        >
          Reintentar
        </button>
      </div>

      <p v-else-if="categories.length === 0" class="m-0 text-center" role="status">
        Todavía no hay categorías disponibles.
      </p>

      <ul
        v-else
        class="m-0 flex list-none flex-wrap justify-center gap-5 p-0"
      >
        <li v-for="category in categories" :key="category.id" class="min-w-0 w-[calc(50%-10px)] sm:w-40">
          <RouterLink
            :to="{
              name: 'catalogo',
              query: { categoria: String(category.id) },
            }"
            class="box-border flex min-h-36 flex-col items-center justify-center gap-3 rounded-xl px-2 text-center text-[#0b2438] no-underline hover:bg-white/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
          >
            <span
              aria-hidden="true"
              class="grid size-20 place-items-center rounded-full bg-[#f8fafc] text-2xl font-bold text-[#103a5c] sm:size-24"
            >
              {{ category.nombre.charAt(0).toLocaleUpperCase('es-AR') }}
            </span>
            <span class="max-w-full break-words text-sm font-bold">
              {{ category.nombre }}
            </span>
          </RouterLink>
        </li>
      </ul>
    </div>
  </section>
</template>