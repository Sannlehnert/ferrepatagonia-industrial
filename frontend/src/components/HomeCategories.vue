<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import CommerceIcon from './CommerceIcon.vue'
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
  <section id="categorias" class="fp-section categories" aria-labelledby="home-categories-title">
    <div class="fp-shell">
      <div class="fp-section-head">
        <div>
          <p class="fp-kicker">Explorá por rubro</p>
          <h2 id="home-categories-title" class="fp-section-title">Categorías del catálogo</h2>
        </div>
        <RouterLink :to="{ name: 'catalogo' }" class="fp-action fp-action--plain fp-focus">
          Ver categorías en el catálogo <CommerceIcon name="arrow" />
        </RouterLink>
      </div>

      <p v-if="loading" class="fp-state" role="status">Cargando categorías…</p>
      <div v-else-if="error" class="fp-state">
        <p role="alert">No se pudieron cargar las categorías.</p>
        <button type="button" class="fp-action fp-action--primary fp-focus" @click="loadCategories">Reintentar categorías</button>
      </div>
      <p v-else-if="categories.length === 0" class="fp-state" role="status">Todavía no hay categorías disponibles.</p>
      <ul v-else class="category-grid">
        <li v-for="category in categories" :key="category.id">
          <RouterLink
            :to="{ name: 'catalogo', query: { categoria: String(category.id) } }"
            class="category-card fp-focus"
          >
            <span class="category-icon"><CommerceIcon name="grid" /></span>
            <strong>{{ category.nombre }}</strong>
            <CommerceIcon name="arrow" class="category-arrow" />
          </RouterLink>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.categories { background: var(--fp-bg); }
.category-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .65rem;
  list-style: none;
  margin: 0;
  padding: 0;
}
.category-card {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  align-content: center;
  gap: .55rem;
  height: 100%;
  min-height: 96px;
  padding: .8rem;
  border: 1px solid var(--fp-line);
  border-radius: 9px;
  background: white;
  color: var(--fp-navy);
  text-decoration: none;
  transition: border-color .16s, box-shadow .16s;
}
.category-card:hover { border-color: #76a2c1; box-shadow: 0 3px 12px #0b243813; }
.category-card strong { grid-row: 2; font-size: .88rem; overflow-wrap: anywhere; }
.category-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 6px;
  background: #eaf2f9;
  color: var(--fp-blue);
}
.category-icon svg { width: 17px; height: 17px; }
.category-arrow { grid-column: 2; grid-row: 2; width: 15px; color: var(--fp-blue); }
.fp-state p { margin: 0 0 .65rem; }

@media (min-width: 680px) {
  .category-grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); gap: .85rem; }
  .category-card { grid-template-columns: auto minmax(0, 1fr) auto; gap: .8rem; min-height: 76px; padding: 1rem; }
  .category-card strong, .category-arrow { grid-area: auto; }
  .category-card strong { font-size: .95rem; }
}
</style>
