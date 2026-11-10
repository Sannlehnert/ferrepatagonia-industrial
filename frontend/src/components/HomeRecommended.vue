<script setup lang="ts">
import CommerceIcon from './CommerceIcon.vue'
import HomeProductImage from './HomeProductImage.vue'
import ProductPrices from '@/components/ProductPrices.vue'
import ProductPrice from '@/components/ProductPrice.vue'
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
    const result = await getCatalog({ page: 1, limit: 4 }, current.signal)
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
  <section class="fp-section products" aria-labelledby="home-products-title">
    <div class="fp-shell">
      <div class="fp-section-head">
        <div>
          <p class="fp-kicker">Catálogo industrial</p>
          <h2 id="home-products-title" class="fp-section-title">Explorá nuestros productos</h2>
          <p class="fp-section-copy">Consultá los precios y la disponibilidad de cada artículo.</p>
        </div>
        <RouterLink :to="{ name: 'catalogo' }" class="fp-action fp-action--plain fp-focus">
          Ver catálogo completo <CommerceIcon name="arrow" />
        </RouterLink>
      </div>

      <p v-if="loading" class="fp-state" role="status">Cargando productos…</p>
      <div v-else-if="error" class="fp-state">
        <p role="alert">No se pudieron cargar los productos.</p>
        <button type="button" class="fp-action fp-action--primary fp-focus" @click="loadProducts">Reintentar productos</button>
      </div>
      <p v-else-if="products.length === 0" class="fp-state" role="status">
        Todavía no hay productos disponibles.
      </p>

      <ProductPrices v-else :products="products" :catalog-loading="loading" v-slot="pricing">
        <ul class="product-grid">
          <li v-for="product in products" :key="product.id">
            <article class="product-card">
              <HomeProductImage :product-id="product.id" :name="product.nombre" />
              <div class="product-content">
                <p class="product-code">COD. {{ product.codigo }}</p>
                <h3>{{ product.nombre }}</h3>
                <p class="product-stock" :class="{ available: product.disponible }">
                  {{ product.disponible ? 'Disponible' : 'Sin stock' }}
                </p>
                <ProductPrice
                  class="product-price"
                  :line="pricing.prices[product.id]"
                  :loading="pricing.loading"
                  :error="pricing.error"
                  :personalized="pricing.personalized"
                />
                <RouterLink
                  :to="{ name: 'producto-detalle', params: { id: product.id }, query: { returnTo: '/' } }"
                  :aria-label="'Ver producto: ' + product.nombre"
                  class="product-link fp-focus"
                >
                  Ver producto <CommerceIcon name="arrow" />
                </RouterLink>
              </div>
            </article>
          </li>
        </ul>
      </ProductPrices>
    </div>
  </section>
</template>

<style scoped>
.products { border-block: 1px solid var(--fp-line); background: #fff; }
.product-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .65rem;
  list-style: none;
  padding: 0;
  margin: 0;
}
.product-card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-wrap: anywhere;
  border: 1px solid var(--fp-line);
  border-radius: var(--fp-radius-panel);
  background: white;
  transition: border-color .16s, box-shadow .16s;
}
.product-card > :first-child { border-radius: calc(var(--fp-radius-panel) - 1px) calc(var(--fp-radius-panel) - 1px) 0 0; }
.product-card:focus-within, .product-card:hover { border-color: var(--fp-control-line); box-shadow: var(--fp-shadow); }
.product-content { display: flex; flex: 1; flex-direction: column; padding: clamp(.65rem, 1.6vw, 1.05rem); }
.product-code { margin: 0 0 .35rem; color: var(--fp-muted); font: 700 .75rem/1.35 ui-monospace, Consolas, monospace; }
h3 { margin: 0; font-size: clamp(.94rem, 1.5vw, 1.1rem); line-height: 1.3; }
.product-stock {
  display: flex;
  align-items: center;
  gap: .4rem;
  margin: .6rem 0 0;
  padding-bottom: .45rem;
  color: var(--fp-muted);
  font-size: .78rem;
  font-weight: 700;
}
.product-stock.available { color: #146343; }
.product-stock::before { content: ""; width: 6px; height: 6px; flex: none; border-radius: 50%; background: currentColor; }
.product-price { margin: auto 0 .7rem; padding-top: .3rem; }
.product-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .3rem;
  min-height: 44px;
  border-top: 1px solid var(--fp-line);
  color: var(--fp-blue);
  font-size: .83rem;
  font-weight: 800;
  text-decoration: none;
}
.product-link svg { width: 15px; flex: none; }
.product-link:hover { text-decoration: underline; text-underline-offset: .2em; }
.fp-state p { margin: 0 0 .65rem; }


@media (min-width: 900px) {
  .product-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .95rem; }
}
</style>
