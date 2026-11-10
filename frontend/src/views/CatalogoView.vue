<script setup lang="ts">
import ProductPrices from '@/components/ProductPrices.vue'
import ProductPrice from '@/components/ProductPrice.vue'
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import CatalogFilters from '@/components/CatalogFilters.vue'
import { getCatalog, getCatalogCategories } from '@/services/catalogService'
import { refreshOnStock } from '@/services/realtime'
import {
  MAX_PAGINA_CATALOGO,
  normalizarQueryPagina,
} from '@/utils/catalogPagination'
import type {
  CatalogProduct,
  CatalogPagination,
  CatalogFiltersValue,
  CatalogCategory,
} from '@/types/catalog'
import CatalogCartButton from '@/components/CatalogCartButton.vue'

const LIMITE = 12
const route = useRoute()
const router = useRouter()

const productos = ref<CatalogProduct[]>([])
const pagination = ref<CatalogPagination | null>(null)
const total = ref(0)
const cargando = ref(true)
const error = ref<string | null>(null)

// Número entero positivo a partir de un parámetro de la URL, o undefined
function entero(v: unknown): number | undefined {
  const raw = Array.isArray(v) ? v[0] : v
  const n = Number(raw)
  return typeof raw === 'string' && raw && Number.isInteger(n) && n > 0 ? n : undefined
}

// Categoría y página viven en la URL: /catalogo?categoria=5&page=2
const categoriaId = computed(() => entero(route.query.categoria))
const pagina = computed(() => normalizarQueryPagina(route.query).pagina)

const busqueda = computed(() => {
  const value = route.query.busqueda
  return typeof value === 'string' ? value : ''
})

const filtrosAplicados = computed<CatalogFiltersValue>(() => ({
  search: busqueda.value,
  categoryId: categoriaId.value ?? null,
}))

function aplicarFiltros(filters: CatalogFiltersValue) {
  const query = { ...route.query }

  delete query.page
  delete query.busqueda
  delete query.categoria

  if (filters.search) query.busqueda = filters.search
  if (filters.categoryId !== null) {
    query.categoria = String(filters.categoryId)
  }

  return router.push({ name: 'catalogo', query })
}

const listaCategorias = ref<CatalogCategory[]>([])
const cargandoCategorias = ref(true)
const errorCategorias = ref<string | null>(null)
let controladorCategorias: AbortController | null = null

const nombreCategoria = computed(() =>
  categoriaId.value
    ? (
        listaCategorias.value.find(
          (category) => category.id === categoriaId.value,
        )?.nombre ?? 'Categoría'
      )
    : null,
)

async function cargarCategorias() {
  controladorCategorias?.abort()
  const actual = new AbortController()
  controladorCategorias = actual

  cargandoCategorias.value = true
  errorCategorias.value = null

  try {
    const categories = await getCatalogCategories(actual.signal)

    if (controladorCategorias !== actual || actual.signal.aborted) return

    listaCategorias.value = categories
  } catch (e) {
    if (
      axios.isCancel(e) ||
      actual.signal.aborted ||
      controladorCategorias !== actual
    ) return

    errorCategorias.value =
      'No se pudieron cargar las categorías. Podés reintentar.'
  } finally {
    if (controladorCategorias === actual) {
      cargandoCategorias.value = false
    }
  }
}

// Conserva el resto de la query al cambiar de página, incluidos futuros filtros.
function irAPagina(n: number, reemplazar = false) {
  const query = { ...route.query }
  if (n > 1) query.page = String(n)
  else delete query.page
  const destino = { name: 'catalogo', query }
  return reemplazar ? router.replace(destino) : router.push(destino)
}

// Paginación desde los botones: solo páginas válidas, sin recargar la app
function cambiarPagina(n: number) {
  const p = pagination.value
  if (!p || cargando.value || !Number.isSafeInteger(n) || n < 1 || n > MAX_PAGINA_CATALOGO || n > p.totalPages || n === pagina.value) return
  irAPagina(n)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

let controlador: AbortController | null = null


async function cargar() {
  controlador?.abort()
  controlador = null
  cargando.value = true
  productos.value = []
  error.value = null

  const paginaNormalizada = normalizarQueryPagina(route.query)
  if (!paginaNormalizada.esCanonica) {
    await router.replace({
      name: 'catalogo',
      query: paginaNormalizada.query,
    })
    return
  }

  const actual = new AbortController()
  controlador = actual

  let redirigido = false

  try {
    const data = await getCatalog(
      {
        page: paginaNormalizada.pagina,
        limit: LIMITE,
        categoria: categoriaId.value,
        busqueda: busqueda.value,
      },
      actual.signal,
    )

    if (controlador !== actual) return

    const pag = data.pagination

    // Si hay productos, redirigir a la última página válida.
    if (pag.totalPages > 0 && paginaNormalizada.pagina > pag.totalPages) {
      redirigido = true
      irAPagina(pag.totalPages, true)
      return
    }

    // Si no hay resultados y se pidió una página superior a 1,
    // volver a la primera página para evitar una URL inválida.
    if (pag.totalPages === 0 && paginaNormalizada.pagina > 1) {
      redirigido = true
      irAPagina(1, true)
      return
    }

    productos.value = data.productos
    pagination.value = pag
    total.value = pag.total
  } catch (e) {
    if (axios.isCancel(e) || actual.signal.aborted || controlador !== actual) return

    error.value = 'No se pudo cargar el catálogo.'
  } finally {
    if (controlador === actual && !redirigido) {
      cargando.value = false
    }
  }
}

// Observar el valor crudo permite normalizar incluso abc → 0 o page=1.
watch([categoriaId, () => route.query.page, busqueda], cargar)
refreshOnStock(ids => cargando.value || productos.value.some(product => ids.has(product.id)), () => void cargar())
onMounted(() => {
  void cargar()
  void cargarCategorias()
})

onBeforeUnmount(() => {
  controlador?.abort()
  controladorCategorias?.abort()
})
</script>

<template>
  <main class="fp-shell py-6 sm:py-9">
    <p class="m-0 mb-2 text-xs text-slate-500">
      Inicio /
      <RouterLink v-if="categoriaId" class="fp-focus text-[var(--fp-blue)]" :to="{ name: 'catalogo' }">Catálogo</RouterLink>
      <template v-else>Catálogo</template>
      <template v-if="categoriaId"> / {{ nombreCategoria }}</template>
    </p>

    <header class="mb-5 flex flex-col items-start justify-between gap-4 min-[801px]:flex-row">
      <div>
        <h1 class="fp-section-title [overflow-wrap:anywhere]">{{ nombreCategoria ?? 'Catálogo' }}</h1>
        <p class="fp-section-copy">{{ total }} productos</p>
      </div>
      <!-- El backend todavía no soporta orden: se muestra pero deshabilitado -->
      <select class="box-border rounded-md border border-slate-200 bg-white px-3 py-2 text-sm" disabled aria-label="Ordenar productos">
        <option>Ordenar: Relevancia</option>
      </select>
    </header>

    <div class="grid grid-cols-1 items-start gap-5 min-[801px]:grid-cols-[190px_minmax(0,1fr)]">
      <aside class="min-h-0 rounded-[var(--fp-radius-panel)] border border-[var(--fp-line)] bg-white p-4 min-[801px]:min-h-[260px]" aria-label="Filtros">
        <h2 class="m-0 text-base">Filtros</h2>

        <CatalogFilters
          :model-value="filtrosAplicados"
          :categories="listaCategorias"
          :categories-loading="cargandoCategorias"
          :categories-error="errorCategorias"
          @apply="aplicarFiltros"
          @retry-categories="cargarCategorias"
        />
      </aside>

      <section>
        <ProductPrices :products="productos" :catalog-loading="cargando" v-slot="pricing">
        <p v-if="cargando" class="fp-state" role="status">Cargando productos...</p>

        <div v-else-if="error" class="fp-state" role="alert">
          <p class="fp-error m-0 mb-2">{{ error }}</p>
          <button type="button" class="fp-action fp-action--primary fp-focus" @click="cargar">Reintentar</button>
        </div>

        <div v-else-if="!productos.length" class="fp-state" role="status">
          <p class="m-0">
            {{
              busqueda || categoriaId
                ? 'No encontramos productos con esos filtros.'
                : 'Todavía no hay productos en el catálogo.'
            }}
          </p>

          <button
            v-if="busqueda || categoriaId"
            type="button"
            class="fp-action fp-action--primary fp-focus mt-2"
            @click="aplicarFiltros({ search: '', categoryId: null })"
          >
            Limpiar filtros
          </button>
        </div>

        <ul v-else class="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,210px),1fr))] gap-4 m-0 list-none p-0 [@media(max-width:560px)]:grid-cols-2 [@media(max-width:560px)]:gap-3">
          <li v-for="p in productos" :key="p.id" class="box-border flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white p-4 [@media(max-width:560px)]:p-3">
            <!-- CatalogProduct no tiene imagen todavía -->
            <div class="mb-3 grid h-[140px] place-items-center rounded-md bg-slate-100 text-xs text-slate-500 [@media(max-width:560px)]:h-[110px]" aria-hidden="true"><span>Sin imagen</span></div>

            <p class="m-0 min-w-0 max-w-full text-[.75rem] text-[var(--fp-muted)] [overflow-wrap:anywhere]">COD. {{ p.codigo }}</p>
            <h3 class="my-1 text-sm font-semibold [overflow-wrap:anywhere]">
              <RouterLink
                :to="{ name: 'producto-detalle', params: { id: p.id }, query: { returnTo: route.fullPath } }"
                class="rounded-sm text-inherit underline-offset-2 hover:text-[var(--fp-blue)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-blue)]"
              >
                {{ p.nombre }}
              </RouterLink>
            </h3>
            <ProductPrice :line="pricing.prices[p.id]" :loading="pricing.loading" :error="pricing.error" :personalized="pricing.personalized" />

            <div class="mt-auto flex items-center justify-between gap-2 [@media(max-width:560px)]:flex-col [@media(max-width:560px)]:items-stretch">
              <span aria-label="Disponibilidad de stock" class="text-sm" :class="p.disponible ? 'text-green-700' : 'text-red-700'">
                {{ p.disponible ? 'Disponible' : 'No disponible' }}
              </span>
              <CatalogCartButton
                :product="p"
                :line="pricing.prices[p.id]"
                :loading="pricing.loading"
                :error="pricing.error"
              />
            </div>
          </li>
        </ul>

        <nav
          v-if="!error && pagination && pagination.totalPages > 1"
          class="mt-6 flex items-center justify-center gap-4 text-sm [@media(max-width:560px)]:gap-2"
          aria-label="Paginación del catálogo"
        >
          <button
            type="button"
            class="min-h-11 min-w-[110px] cursor-pointer rounded-md border border-[#145a8d] bg-white px-3 font-semibold text-[#145a8d] hover:bg-[#145a8d] hover:text-white disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 [@media(max-width:560px)]:min-w-0 [@media(max-width:560px)]:flex-1"
            :disabled="cargando || !pagination.hasPrevious"
            @click="cambiarPagina(pagina - 1)"
          >
            Anterior
          </button>
          <span aria-live="polite">Página {{ pagination.page }} de {{ pagination.totalPages }}</span>
          <button
            type="button"
            class="min-h-11 min-w-[110px] cursor-pointer rounded-md border border-[#145a8d] bg-white px-3 font-semibold text-[#145a8d] hover:bg-[#145a8d] hover:text-white disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 [@media(max-width:560px)]:min-w-0 [@media(max-width:560px)]:flex-1"
            :disabled="cargando || !pagination.hasNext"
            @click="cambiarPagina(pagina + 1)"
          >
            Siguiente
          </button>
        </nav>
        </ProductPrices>
      </section>
    </div>
  </main>
</template>
