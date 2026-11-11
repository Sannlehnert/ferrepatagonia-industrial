<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AdminCategoryForm from '@/components/AdminCategoryForm.vue'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import {
  createAdminCategory,
  deactivateAdminCategory,
  listAdminCategories,
  updateAdminCategory,
  type AdminCategory,
} from '@/services/adminCategoryService'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const identity = () => `${auth.user?.id}:${auth.rol}:${auth.sessionVersion}`
const allowed = () => auth.isAuthenticated && auth.rol === 'ADMIN'
const { data: categories, loading, error, load } = usePrivateAccountRead<AdminCategory[]>(
  identity,
  allowed,
)

const filter = ref<'all' | 'active' | 'inactive'>('all')
const form = ref<AdminCategory | 'new' | null>(null)
const pendingDeactivation = ref<AdminCategory | null>(null)
const busy = ref(false)
const mutationError = ref('')
const notice = ref('')

const visibleCategories = computed(() =>
  (categories.value ?? []).filter(category =>
    filter.value === 'all' || category.activo === (filter.value === 'active' ? 1 : 0),
  ),
)

function refreshCategories() {
  return load(listAdminCategories)
}

watch(identity, () => {
  form.value = null
  pendingDeactivation.value = null
  mutationError.value = ''
  notice.value = ''
  busy.value = false
  void refreshCategories()
}, { immediate: true, flush: 'sync' })

async function mutate(write: () => Promise<AdminCategory>, success: string) {
  if (busy.value || !allowed()) return

  const session = identity()
  busy.value = true
  mutationError.value = ''
  notice.value = ''

  try {
    await write()
    if (session !== identity()) return

    form.value = null
    pendingDeactivation.value = null
    notice.value = success
    await refreshCategories()
  } catch {
    if (session !== identity()) return

    form.value = null
    pendingDeactivation.value = null
    mutationError.value = 'No se pudo confirmar el cambio. Revisá el listado antes de reintentar.'
    await refreshCategories()
  } finally {
    if (session === identity()) busy.value = false
  }
}

function save(fields: { nombre: string; descripcion: string | null }) {
  const selected = form.value
  if (!selected) return

  if (selected === 'new') {
    return mutate(() => createAdminCategory(fields), 'Categoría creada.')
  }

  return mutate(() => updateAdminCategory(selected.id_categoria, fields), 'Categoría actualizada.')
}

function confirmDeactivation() {
  const selected = pendingDeactivation.value
  if (!selected) return

  return mutate(() => deactivateAdminCategory(selected.id_categoria), 'Categoría desactivada.')
}
</script>

<template>
  <section aria-labelledby="categories-title" class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 id="categories-title" class="m-0 text-xl font-semibold text-[#0b2438]">
        Categorías
      </h2>
      <button
        type="button"
        class="min-h-11 rounded-md bg-[#103a5c] px-4 text-white disabled:opacity-60"
        :disabled="busy || loading || !!form || !!pendingDeactivation"
        @click="form = 'new'"
      >
        Nueva categoría
      </button>
    </div>

    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="mutationError" role="alert" class="text-red-800">{{ mutationError }}</p>

    <AdminCategoryForm
      v-if="form"
      :key="form === 'new' ? 'new' : form.id_categoria"
      :category="form === 'new' ? undefined : form"
      :busy="busy"
      @save="save"
      @cancel="form = null"
    />

    <div v-if="pendingDeactivation" class="space-y-2 rounded-md border border-slate-300 p-4">
      <p class="m-0 break-words">
        ¿Desactivar <strong>{{ pendingDeactivation.nombre }}</strong>?
        La categoría dejará de aparecer en el catálogo público.
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="min-h-11 rounded-md bg-red-800 px-4 text-white disabled:opacity-60"
          :disabled="busy"
          @click="confirmDeactivation()"
        >
          Confirmar desactivación
        </button>
        <button
          type="button"
          class="min-h-11 rounded-md border border-slate-300 px-4 disabled:opacity-60"
          :disabled="busy"
          @click="pendingDeactivation = null"
        >
          Cancelar
        </button>
      </div>
    </div>

    <p v-if="loading" role="status">Cargando categorías…</p>
    <div v-else-if="error" class="space-y-2">
      <p role="alert" class="text-red-800">No se pudieron cargar las categorías.</p>
      <button
        type="button"
        class="min-h-11 rounded-md border border-slate-300 px-4"
        @click="refreshCategories()"
      >
        Reintentar
      </button>
    </div>

    <template v-else-if="categories">
      <label class="flex flex-wrap items-center gap-2 text-sm font-medium">
        Estado
        <select v-model="filter" class="min-h-11 rounded-md border border-slate-300 px-3">
          <option value="all">Todas</option>
          <option value="active">Activas</option>
          <option value="inactive">Inactivas</option>
        </select>
      </label>

      <p v-if="!visibleCategories.length" role="status">
        No hay categorías para mostrar con este filtro.
      </p>
      <ul v-else class="m-0 list-none space-y-3 p-0">
        <li
          v-for="category in visibleCategories"
          :key="category.id_categoria"
          class="space-y-2 rounded-lg border border-slate-200 bg-white p-4"
        >
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="m-0 min-w-0 break-words font-semibold">{{ category.nombre }}</h3>
            <span
              class="rounded-full px-2 py-1 text-xs font-medium"
              :class="category.activo === 1
                ? 'bg-green-100 text-green-900'
                : 'bg-slate-100 text-slate-700'"
            >
              {{ category.activo === 1 ? 'Activa' : 'Inactiva' }}
            </span>
          </div>
          <p class="m-0 whitespace-pre-wrap break-words text-sm text-slate-700">
            {{ category.descripcion ?? 'Sin descripción' }}
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="min-h-11 rounded-md border border-slate-300 px-4 disabled:opacity-60"
              :aria-label="`Editar ${category.nombre}`"
              :disabled="busy || !!form || !!pendingDeactivation"
              @click="form = category"
            >
              Editar
            </button>
            <button
              v-if="category.activo === 1"
              type="button"
              class="min-h-11 rounded-md border border-red-300 px-4 text-red-800 disabled:opacity-60"
              :aria-label="`Desactivar ${category.nombre}`"
              :disabled="busy || !!form || !!pendingDeactivation"
              @click="pendingDeactivation = category"
            >
              Desactivar
            </button>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>