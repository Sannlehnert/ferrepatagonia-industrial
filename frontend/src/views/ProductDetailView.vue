<script setup lang="ts">
import CatalogCartButton from '@/components/CatalogCartButton.vue'
import ProductPrice from '@/components/ProductPrice.vue'
import ProductPrices from '@/components/ProductPrices.vue'
import { getCatalogProduct } from '@/services/catalogService'
import { refreshOnStock } from '@/services/realtime'
import type { CatalogProduct, CatalogProductDetail } from '@/types/catalog'
import { getProductImageSource } from '@/utils/productImage'
import axios from 'axios'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const product = ref<CatalogProductDetail | null>(null)
const loading = ref(true)
const notFound = ref(false)
const error = ref(false)
const imageFailed = ref(false)
let controller: AbortController | null = null

const id = computed(() => {
  const raw = route.params.id
  if (typeof raw !== 'string' || !/^[1-9]\d{0,9}$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value <= 2147483647 ? value : null
})

const pricedProducts = computed<CatalogProduct[]>(() => product.value ? [product.value] : [])

const returnTarget = computed(() => {
  const value = route.query.returnTo
  if (typeof value === 'string' && (
    value === '/' || value.startsWith('/?') || value === '/catalogo' || value.startsWith('/catalogo?')
  )) return value
  return { name: 'catalogo' }
})

const returnLabel = computed(() => {
  const target = returnTarget.value
  return typeof target === 'string' && target.split('?')[0] === '/'
    ? 'Volver al inicio'
    : 'Volver al catálogo'
})

const imageSource = computed(() => getProductImageSource(product.value?.imagen))

async function loadProduct() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  product.value = null
  imageFailed.value = false
  loading.value = true
  notFound.value = false
  error.value = false

  if (id.value === null) {
    notFound.value = true
    loading.value = false
    return
  }

  try {
    const result = await getCatalogProduct(id.value, current.signal)
    if (controller !== current || current.signal.aborted) return
    product.value = result
  } catch (cause) {
    if (axios.isCancel(cause) || current.signal.aborted || controller !== current) return
    if (axios.isAxiosError(cause) && cause.response?.status === 404) notFound.value = true
    else error.value = true
  } finally {
    if (controller === current) loading.value = false
  }
}

watch(id, () => void loadProduct())
refreshOnStock(ids => id.value !== null && ids.has(id.value), () => void loadProduct())
onMounted(() => void loadProduct())
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <main class="fp-shell py-6 lg:py-10">
    <nav aria-label="Ruta de navegación" class="mb-5 flex flex-wrap items-center gap-1.5 text-sm">
      <RouterLink :to="{ name: 'home' }" class="fp-focus text-[var(--fp-blue)] underline">Inicio</RouterLink>
      <span aria-hidden="true" class="text-slate-400"> / </span>
      <RouterLink :to="returnTarget" class="fp-focus text-[var(--fp-blue)] underline">{{ returnLabel }}</RouterLink>
      <span aria-hidden="true" class="text-slate-400"> / </span>
      <span class="text-slate-600">Detalle del producto</span>
    </nav>

    <h1 class="fp-section-title detail-title text-[#0B2438]">
      {{ product?.nombre ?? 'Detalle del producto' }}
    </h1>

    <p v-if="loading" class="fp-state" role="status">Cargando detalle del producto…</p>

    <section v-else-if="notFound" class="fp-state">
      <p class="m-0" role="status">No encontramos ese producto en el catálogo.</p>
      <RouterLink :to="returnTarget" class="fp-action fp-action--plain fp-focus mt-3 min-h-[44px] min-w-[44px]">
        {{ returnLabel }}
      </RouterLink>
    </section>

    <section v-else-if="error" class="fp-state">
      <p class="fp-error m-0" role="alert">No se pudo cargar el detalle del producto.</p>
      <button type="button" class="fp-action fp-action--primary fp-focus mt-3 min-h-[44px] min-w-[44px]" @click="loadProduct">
        Reintentar
      </button>
    </section>

    <ProductPrices v-else-if="product" :products="pricedProducts" :catalog-loading="loading" v-slot="pricing">
      <article class="grid gap-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:grid-cols-2 lg:gap-10">
        <div class="grid min-h-64 place-items-center overflow-hidden rounded-lg bg-slate-100 sm:min-h-80">
          <img
            v-if="imageSource && !imageFailed"
            :src="imageSource"
            :alt="product.nombre"
            class="max-h-[520px] w-full object-contain"
            loading="lazy"
            @error="imageFailed = true"
          />
          <span v-else class="text-sm text-slate-500">Sin imagen disponible</span>
        </div>

        <div class="flex min-w-0 flex-col">
          <p class="m-0 text-sm text-slate-500">Código {{ product.codigo }}</p>
          <p class="mb-4 mt-2 text-sm text-slate-600">Categoría: {{ product.categoria.nombre }}</p>

          <h2 class="mb-2 mt-0 text-lg font-semibold text-[#0B2438]">Descripción</h2>
          <p class="m-0 whitespace-pre-line break-words text-slate-700">
            {{ product.descripcion?.trim() || 'No hay una descripción disponible para este producto.' }}
          </p>

          <h2 class="mb-2 mt-6 text-lg font-semibold text-[#0B2438]">Precio</h2>
          <ProductPrice
            :line="pricing.prices[product.id]"
            :loading="pricing.loading"
            :error="pricing.error"
            :personalized="pricing.personalized"
          />

          <p class="mb-4 mt-3 text-sm" :class="product.stock > 0 ? 'text-green-700' : 'text-red-700'">
            <span class="font-semibold">{{ product.stock > 0 ? 'Disponible' : 'Sin stock' }}</span>
            <span v-if="product.stock > 0"> · {{ product.stock }} unidades disponibles</span>
          </p>

          <div class="mt-auto max-w-sm">
            <CatalogCartButton
              :product="product"
              :line="pricing.prices[product.id]"
              :loading="pricing.loading"
              :error="pricing.error"
            />
          </div>
        </div>
      </article>
    </ProductPrices>
  </main>
</template>

<style scoped>
.detail-title { margin-bottom: 1.5rem; overflow-wrap: anywhere; }
</style>
