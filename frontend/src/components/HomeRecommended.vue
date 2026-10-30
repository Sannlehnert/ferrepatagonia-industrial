<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import axios from 'axios'
import { getCatalog } from '@/services/catalogService'
import type { CatalogProduct } from '@/types/catalog'

const products = ref<CatalogProduct[]>([])
const loading = ref(true)
const error = ref(false)
let controller: AbortController | null = null

async function loadProducts() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = false

  try {
    const result = await getCatalog({ page: 1, limit: 5 }, current.signal)
    if (controller !== current || current.signal.aborted) return
    products.value = result.productos
  } catch (cause) {
    if (axios.isCancel(cause) || current.signal.aborted || controller !== current) return
    error.value = true
  } finally {
    if (controller === current) loading.value = false
  }
}

onMounted(() => {
  void loadProducts()
})

onBeforeUnmount(() => {
  controller?.abort()
})
</script>

<template>
  <section
    class="bg-[#f1f5f9] px-4 py-9 text-[#0b2438] sm:px-6 lg:px-10"
    aria-labelledby="home-recommended-title"
  >
    <div class="mx-auto max-w-[1440px]">
      <h2
        id="home-recommended-title"
        class="m-0 mb-7 text-center text-2xl font-bold"
      >
        Productos
      </h2>

      <p v-if="loading" class="m-0 text-center" role="status">
        Cargando productos...
      </p>

      <div v-else-if="error" class="text-center" role="alert">
        <p class="m-0 mb-3">No se pudieron cargar los productos.</p>
        <button
          type="button"
          class="min-h-11 cursor-pointer rounded-lg border-0 bg-[#103a5c] px-5 font-[inherit] font-bold text-white"
          @click="loadProducts"
        >
          Reintentar
        </button>
      </div>

      <p v-else-if="products.length === 0" class="m-0 text-center" role="status">
        Todavía no hay productos disponibles.
      </p>

      <ul
        v-else
        class="m-0 flex list-none flex-wrap justify-center gap-4 p-0"
      >
        <li v-for="product in products" :key="product.id" class="min-w-0 w-full sm:w-[calc(50%-8px)] lg:w-[240px]">
          <article
            class="box-border flex h-full min-h-64 flex-col rounded-[10px] border border-solid border-[#e2e8f0] bg-white p-4"
          >
            <div
              class="mb-4 grid h-28 place-items-center rounded-md bg-[#f1f5f9] text-xs text-slate-500"
              aria-hidden="true"
            >
              Sin imagen
            </div>

            <p class="m-0 break-all text-xs text-slate-500">
              COD. {{ product.codigo }}
            </p>

            <h3 class="my-2 break-words text-base font-bold">
              {{ product.nombre }}
            </h3>

            <p class="m-0 text-sm text-slate-600">
              Precio a confirmar
            </p>

            <p
              class="mt-auto mb-3 pt-4 text-sm"
              :class="product.disponible ? 'text-green-700' : 'text-red-700'"
            >
              {{ product.disponible ? 'Disponible' : 'No disponible' }}
            </p>

            <RouterLink
              :to="{
                name: 'catalogo',
                query: { busqueda: product.codigo },
              }"
              class="box-border inline-flex min-h-11 items-center justify-center rounded-lg bg-[#103a5c] px-4 text-sm font-bold text-white no-underline hover:bg-[#0b2438] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
            >
              Ver en catálogo
            </RouterLink>
          </article>
        </li>
      </ul>
    </div>
  </section>
</template>