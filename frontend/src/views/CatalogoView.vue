<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import CatalogFilters from '@/components/CatalogFilters.vue'
import { getCatalog, getCatalogCategories } from '@/services/catalogService'
import type {
  CatalogProduct,
  CatalogPagination,
  CatalogFiltersValue,
  CatalogCategory,
} from '@/types/catalog'


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
const MAX_PAGINA = 1_000_000
const pagina = computed(() => {
  const raw = route.query.page
  // Mismo formato y límite que parseCatalogPagination del backend.
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) return 1
  const n = Number(raw)
  return Number.isSafeInteger(n) && n <= MAX_PAGINA ? n : 1
})

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
  if (!p || cargando.value || !Number.isSafeInteger(n) || n < 1 || n > MAX_PAGINA || n > p.totalPages || n === pagina.value) return
  irAPagina(n)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

let controlador: AbortController | null = null


async function cargar() {
  controlador?.abort()
  controlador = null
  cargando.value = true
  error.value = null

  // Normalizar el parámetro page en la URL:
  // page=abc, page=0 y page=1 se convierten en la URL sin page.
  // Los números positivos mayores que 1 se conservan en formato canónico.
  const paginaSolicitada = pagina.value
  const pageCanonica =
    paginaSolicitada > 1 ? String(paginaSolicitada) : undefined
  const pageActual = route.query.page

  const urlCanonica =
    pageCanonica === undefined
      ? pageActual === undefined
      : typeof pageActual === 'string' && pageActual === pageCanonica

  if (!urlCanonica) {
    const query = { ...route.query }

    if (pageCanonica === undefined) {
      delete query.page
    } else {
      query.page = pageCanonica
    }

    await router.replace({ name: 'catalogo', query })
    // El watcher de la query continúa la carga con la URL normalizada.
    return
  }

  const actual = new AbortController()
  controlador = actual

  let redirigido = false

  try {
    const data = await getCatalog(
      {
        page: pagina.value,
        limit: LIMITE,
        categoria: categoriaId.value,
        busqueda: busqueda.value,
      },
      actual.signal,
    )

    if (controlador !== actual) return

    const pag = data.pagination

    // Si hay productos, redirigir a la última página válida.
    if (pag.totalPages > 0 && pagina.value > pag.totalPages) {
      redirigido = true
      irAPagina(pag.totalPages, true)
      return
    }

    // Si no hay resultados y se pidió una página superior a 1,
    // volver a la primera página para evitar una URL inválida.
    if (pag.totalPages === 0 && pagina.value > 1) {
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
  <main class="mx-auto max-w-7xl px-3 py-4 text-slate-900 sm:px-5 sm:py-6">
    <p class="m-0 mb-2 text-xs text-slate-500">
      Inicio /
      <RouterLink v-if="categoriaId" class="text-[#103a5c]" :to="{ name: 'catalogo' }">Catálogo</RouterLink>
      <template v-else>Catálogo</template>
      <template v-if="categoriaId"> / {{ nombreCategoria }}</template>
    </p>

    <header class="mb-5 flex flex-col items-start justify-between gap-4 min-[801px]:flex-row">
      <div>
        <h1 class="m-0 text-2xl uppercase text-slate-900">{{ nombreCategoria ?? 'Catálogo' }}</h1>
        <p class="m-0 mt-1 text-xs text-slate-500">{{ total }} productos</p>
      </div>
      <!-- El backend todavía no soporta orden: se muestra pero deshabilitado -->
      <select class="box-border rounded-md border border-slate-200 bg-white px-3 py-2 text-sm" disabled aria-label="Ordenar productos">
        <option>Ordenar: Relevancia</option>
      </select>
    </header>

    <div class="grid grid-cols-1 items-start gap-5 min-[801px]:grid-cols-[190px_minmax(0,1fr)]">
      <aside class="min-h-0 rounded-lg border border-slate-200 p-4 min-[801px]:min-h-[260px]" aria-label="Filtros">
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
        <p v-if="cargando">Cargando productos...</p>

        <p v-else-if="error" class="m-0" role="alert">
          {{ error }}
          <button type="button" class="ml-2 underline" @click="cargar">Reintentar</button>
        </p>

        <div v-else-if="!productos.length" class="py-8 text-slate-500" role="status">
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
            class="mt-2 min-h-11 rounded-md border-0 bg-[#145a8d] px-4 py-2 font-semibold text-white hover:bg-[#103a5c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d]"
            @click="aplicarFiltros({ search: '', categoryId: null })"
          >
            Limpiar filtros
          </button>
        </div>

        <ul v-else class="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,210px),1fr))] gap-4 m-0 list-none p-0 max-[560px]:grid-cols-2 max-[560px]:gap-3">
          <li v-for="p in productos" :key="p.id" class="box-border flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white p-4 max-[560px]:p-3">
            <!-- CatalogProduct no tiene imagen todavía -->
            <div class="mb-3 grid h-[140px] place-items-center rounded-md bg-slate-100 text-xs text-slate-500 max-[560px]:h-[110px]" aria-hidden="true"><span>Sin imagen</span></div>

            <p class="m-0 min-w-0 max-w-full break-all text-[.7rem] text-slate-500">COD. {{ p.codigo }}</p>
            <h3 class="my-1 break-all text-sm font-semibold text-slate-900">{{ p.nombre }}</h3>
            <p class="m-0 mb-2 text-[.95rem]">Precio a confirmar</p>

            <div class="mt-auto flex items-center justify-between gap-2 max-[560px]:flex-col max-[560px]:items-stretch">
              <span class="text-sm text-green-600" :class="{ 'text-red-700': !p.disponible }">
                {{ p.disponible ? 'Disponible' : 'No disponible' }}
              </span>
              <!-- Conectar al carrito cuando exista -->
              <button type="button" class="min-h-11 rounded-md border-0 bg-[#145a8d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#103a5c] disabled:cursor-not-allowed disabled:bg-slate-400 max-[560px]:w-full" :disabled="!p.disponible">Agregar</button>
            </div>
          </li>
        </ul>

        <nav
          v-if="!error && pagination && pagination.totalPages > 1"
          class="mt-6 flex items-center justify-center gap-4 text-sm max-[560px]:gap-2"
          aria-label="Paginación del catálogo"
        >
          <button
            type="button"
            class="min-h-11 min-w-[110px] cursor-pointer rounded-md border border-[#145a8d] bg-white px-3 font-semibold text-[#145a8d] hover:bg-[#145a8d] hover:text-white disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 max-[560px]:min-w-0 max-[560px]:flex-1"
            :disabled="cargando || !pagination.hasPrevious"
            @click="cambiarPagina(pagina - 1)"
          >
            Anterior
          </button>
          <span aria-live="polite">Página {{ pagination.page }} de {{ pagination.totalPages }}</span>
          <button
            type="button"
            class="min-h-11 min-w-[110px] cursor-pointer rounded-md border border-[#145a8d] bg-white px-3 font-semibold text-[#145a8d] hover:bg-[#145a8d] hover:text-white disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 max-[560px]:min-w-0 max-[560px]:flex-1"
            :disabled="cargando || !pagination.hasNext"
            @click="cambiarPagina(pagina + 1)"
          >
            Siguiente
          </button>
        </nav>
      </section>
    </div>
  </main>
</template>
