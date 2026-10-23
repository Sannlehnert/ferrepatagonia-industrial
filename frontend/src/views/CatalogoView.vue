<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { getCatalog } from '@/services/catalogService'
import { normalizarQueryPagina } from '@/utils/catalogPagination'
import type { CatalogProduct, CatalogPagination } from '@/types/catalog'

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

// Provisorio: junta las categorías de los productos que van llegando.
// Reemplazar por el endpoint de categorías cuando Santi lo tenga.
const categorias = ref(new Map<number, string>())
const listaCategorias = computed(() =>
  [...categorias.value]
    .map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
)
const nombreCategoria = computed(() =>
  categoriaId.value ? (categorias.value.get(categoriaId.value) ?? 'Categoría') : null,
)

// Conserva el resto de la query (categoría y, más adelante, búsqueda y filtros)
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
  if (!p || cargando.value || n < 1 || n > p.totalPages || n === pagina.value) return
  irAPagina(n)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

let controlador: AbortController | null = null


async function cargar() {
  const paginaNormalizada = normalizarQueryPagina(route.query)
  if (!paginaNormalizada.esCanonica) {
    await router.replace({
      name: 'catalogo',
      query: paginaNormalizada.query,
    })
    return cargar()
  }

  controlador?.abort()

  const actual = new AbortController()
  controlador = actual
  cargando.value = true
  error.value = null

  let redirigido = false

  try {
    const data = await getCatalog(
      {
        page: paginaNormalizada.pagina,
        limit: LIMITE,
        categoria: categoriaId.value,
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

    for (const p of data.productos) {
      categorias.value.set(p.categoria.id, p.categoria.nombre)
    }
  } catch (e) {
    if (axios.isCancel(e)) return

    error.value = 'No se pudo cargar el catálogo.'
  } finally {
    if (controlador === actual && !redirigido) {
      cargando.value = false
    }
  }
}


watch([categoriaId, pagina], cargar)
onMounted(cargar)
onBeforeUnmount(() => controlador?.abort())
</script>

<template>
  <main class="catalogo">
    <p class="migas">
      Inicio /
      <RouterLink v-if="categoriaId" :to="{ name: 'catalogo' }">Catálogo</RouterLink>
      <template v-else>Catálogo</template>
      <template v-if="categoriaId"> / {{ nombreCategoria }}</template>
    </p>

    <header class="cabecera">
      <div>
        <h1>{{ nombreCategoria ?? 'Catálogo' }}</h1>
        <p class="total">{{ total }} productos</p>
      </div>
      <!-- El backend todavía no soporta orden: se muestra pero deshabilitado -->
      <select class="orden" disabled aria-label="Ordenar productos">
        <option>Ordenar: Relevancia</option>
      </select>
    </header>

    <div class="cuerpo">
      <aside class="filtros" aria-label="Filtros">
        <h2>Filtros</h2>

        <h3 class="grupo">Categoría</h3>
        <ul class="cats">
          <li>
            <RouterLink :to="{ name: 'catalogo' }" :class="{ activa: !categoriaId }">
              Todas
            </RouterLink>
          </li>
          <li v-for="c in listaCategorias" :key="c.id">
            <RouterLink
              :to="{ name: 'catalogo', query: { categoria: c.id } }"
              :class="{ activa: c.id === categoriaId }"
            >
              {{ c.nombre }}
            </RouterLink>
          </li>
        </ul>
        <!-- Acá se integra <CatalogFilters /> de Bruno (#195) -->
      </aside>

      <section>
        <p v-if="cargando">Cargando productos...</p>

        <p v-else-if="error" role="alert">
          {{ error }}
          <button type="button" class="reintentar" @click="cargar">Reintentar</button>
        </p>

        <div v-else-if="!productos.length" class="vacio" role="status">
          <p>
            {{
              categoriaId
                ? 'No hay productos en esta categoría por el momento.'
                : 'Todavía no hay productos en el catálogo.'
            }}
          </p>
          <RouterLink v-if="categoriaId" :to="{ name: 'catalogo' }">
            Ver todo el catálogo
          </RouterLink>
        </div>

        <ul v-else class="grilla">
          <li v-for="p in productos" :key="p.id" class="tarjeta">
            <!-- CatalogProduct no tiene imagen todavía -->
            <div class="imagen" aria-hidden="true"><span>Sin imagen</span></div>

            <p class="codigo">COD. {{ p.codigo }}</p>
            <h3>{{ p.nombre }}</h3>
            <p class="precio">Precio a confirmar</p>

            <div class="pie">
              <span class="stock" :class="{ 'stock--no': !p.disponible }">
                {{ p.disponible ? 'Disponible' : 'No disponible' }}
              </span>
              <!-- Conectar al carrito cuando exista -->
              <button type="button" class="agregar" :disabled="!p.disponible">Agregar</button>
            </div>
          </li>
        </ul>

        <nav
          v-if="!error && pagination && pagination.totalPages > 1"
          class="paginacion"
          aria-label="Paginación del catálogo"
        >
          <button
            type="button"
            :disabled="cargando || !pagination.hasPrevious"
            @click="cambiarPagina(pagina - 1)"
          >
            Anterior
          </button>
          <span aria-live="polite">Página {{ pagination.page }} de {{ pagination.totalPages }}</span>
          <button
            type="button"
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

<style scoped>
.catalogo {
  --navy: #0b2438;
  --azul: #145a8d;
  --azul-texto: #103a5c;
  --texto: #13293a;
  --apagado: #6b7a8a;
  --borde: #e2e8f0;
  --verde: #16a34a;
  --rojo: #b42318;

  max-width: 1280px;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 3rem;
  color: var(--texto);
}

.migas { margin: 0 0 .5rem; font-size: .8rem; color: var(--apagado); }
.migas a { color: var(--azul-texto); }

.cabecera {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1.25rem;
}
.cabecera h1 { margin: 0; font-size: 1.5rem; text-transform: uppercase; color: var(--texto); }
.total { margin: .25rem 0 0; font-size: .8rem; color: var(--apagado); }
.orden {
  padding: .5rem .75rem;
  border: 1px solid var(--borde);
  border-radius: 6px;
  background: #fff;
  font: inherit;
  font-size: .9rem;
}

.cuerpo {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 1.25rem;
  align-items: start;
}

.cuerpo > section {
  min-width: 0;
}

.filtros {
  border: 1px solid var(--borde);
  border-radius: 8px;
  padding: 1rem;
  min-height: 260px;
}
.filtros h2 { margin: 0; font-size: 1rem; }
.grupo { margin: 1rem 0 .5rem; font-size: .85rem; font-weight: 600; }
.cats { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: .25rem; }
.cats a {
  display: block;
  padding: .3rem .5rem;
  border-radius: 6px;
  font-size: .85rem;
  color: var(--azul-texto);
  text-decoration: none;
}
.cats a:hover { background: #f1f5f9; }
.cats a.activa { background: #e6eff6; font-weight: 600; }

.grilla {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr));
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 0;
}


.tarjeta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--borde);
  border-radius: 8px;
  padding: 1rem;
  background: #fff;
}
.imagen {
  display: grid;
  place-items: center;
  height: 140px;
  margin-bottom: .75rem;
  border-radius: 6px;
  background: #f1f5f9;
  color: var(--apagado);
  font-size: .8rem;
}
.codigo {
  max-width: 100%;
  min-width: 0;
  margin: 0;
  font-size: 0.7rem;
  color: var(--apagado);
  overflow-wrap: anywhere;
  word-break: break-word;
}
.tarjeta h3 {
  overflow-wrap: anywhere;
  word-break: break-word;
}
.precio { margin: 0 0 .5rem; font-size: .95rem; color: var(--texto); }

.pie {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: .5rem;
  margin-top: auto;
}
.stock { font-size: .85rem; color: var(--verde); }
.stock--no { color: var(--rojo); }

.agregar {
  padding: .5rem 1rem;
  border: 0;
  border-radius: 6px;
  background: var(--azul);
  color: #fff;
  font: inherit;
  font-size: .85rem;
  font-weight: 600;
  cursor: pointer;
}
.agregar:disabled { background: #b8c4d0; cursor: not-allowed; }
.reintentar { margin-left: .5rem; }
.vacio { padding: 2rem 0; color: var(--apagado); }

.paginacion {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  margin-top: 1.5rem;
  font-size: .9rem;
}
.paginacion button {
  min-width: 110px;
  min-height: 44px; /* tamaño táctil */
  border: 1px solid var(--azul);
  border-radius: 6px;
  background: #fff;
  color: var(--azul);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.paginacion button:hover:not(:disabled) { background: var(--azul); color: #fff; }
.paginacion button:disabled { border-color: var(--borde); color: #9aa8b6; cursor: not-allowed; }

@media (max-width: 800px) {
  .cuerpo { grid-template-columns: 1fr; }
  .filtros { min-height: 0; }
  .cabecera { flex-direction: column; }
  .cats { flex-direction: row; flex-wrap: wrap; }
  .cats a { border: 1px solid var(--borde); }
}

@media (max-width: 560px) {
  .catalogo { padding: 1rem .75rem 2rem; }
  .grilla { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem;}
  .tarjeta { padding: .75rem; }
  .imagen { height: 110px; }
  .pie { flex-direction: column; align-items: stretch; }
  .agregar { width: 100%; min-height: 40px; }
  .paginacion { gap: .5rem; }
  .paginacion button { min-width: 0; flex: 1; }
}
</style>