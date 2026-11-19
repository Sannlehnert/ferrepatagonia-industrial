<script setup lang="ts">
import axios from 'axios'
import { computed, nextTick, ref, watch } from 'vue'
import AdminCategoryForm from '@/components/AdminCategoryForm.vue'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import {
  createAdminCategory,
  deactivateAdminCategory,
  listAdminCategories,
  updateAdminCategory,
  type AdminCategory,
} from '@/services/adminCategoryService'
import { isMutationResultUncertain } from '@/services/adminMutationError'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const identity = () => `${auth.user?.id}:${auth.rol}:${auth.sessionVersion}`
const allowed = () => auth.isAuthenticated && auth.rol === 'ADMIN'
const { data: categories, loading, error, load } = usePrivateAccountRead<AdminCategory[]>(
  identity,
  allowed,
)

const filter = ref<'all' | 'active' | 'inactive'>('all')
const formOpen = ref(false)
const editingCategory = ref<AdminCategory | null>(null)
const formError = ref('')
const formUncertain = ref(false)
const pendingDeactivation = ref<AdminCategory | null>(null)
const busy = ref(false)
const mutationError = ref('')
const notice = ref('')
const newButton = ref<HTMLButtonElement | null>(null)
const formTrigger = ref<HTMLElement | null>(null)
let formScrollY = 0

const categoryUncertainMessage = 'No se pudo confirmar el resultado. El formulario quedó bloqueado para evitar duplicados; recargá el listado antes de reintentar.'

const collator = new Intl.Collator('es', { sensitivity: 'base' })

const visibleCategories = computed(() =>
  (categories.value ?? []).filter(category =>
    filter.value === 'all' || category.activo === (filter.value === 'active' ? 1 : 0),
  ),
)

function refreshCategories() {
  return load(listAdminCategories)
}

function sortCategories(list: AdminCategory[]) {
  return [...list].sort((a, b) =>
    collator.compare(a.nombre, b.nombre) || a.id_categoria - b.id_categoria,
  )
}

function upsertCategory(category: AdminCategory) {
  const current = categories.value ?? []
  const exists = current.some(item => item.id_categoria === category.id_categoria)
  const next = exists
    ? current.map(item => item.id_categoria === category.id_categoria ? category : item)
    : [...current, category]

  categories.value = sortCategories(next)
}

function categoryMutationErrorMessage(cause: unknown) {
  if (axios.isAxiosError(cause)) {
    if (cause.response?.status === 401) return 'La sesión expiró. Iniciá sesión nuevamente.'
    if (cause.response?.status === 403) return 'No tenés permisos para modificar categorías.'
    return cause.response?.data?.message || cause.response?.data?.error || cause.message
  }

  return cause instanceof Error ? cause.message : 'No se pudo guardar la categoría.'
}

function rememberFormOrigin(event?: Event) {
  if (typeof HTMLElement !== 'undefined' && event?.currentTarget instanceof HTMLElement) {
    formTrigger.value = event.currentTarget
  } else if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    formTrigger.value = document.activeElement
  }

  if (typeof window !== 'undefined') {
    formScrollY = window.scrollY
  }
}

function clearFeedback() {
  formError.value = ''
  formUncertain.value = false
  mutationError.value = ''
  notice.value = ''
}

function openCreate(event?: Event) {
  if (busy.value || loading.value || pendingDeactivation.value || formOpen.value) return

  clearFeedback()
  editingCategory.value = null
  rememberFormOrigin(event)
  formOpen.value = true
}

function openEdit(category: AdminCategory, event?: Event) {
  if (busy.value || loading.value || pendingDeactivation.value || formOpen.value) return

  clearFeedback()
  editingCategory.value = category
  rememberFormOrigin(event)
  formOpen.value = true
}

async function dismissForm() {
  formOpen.value = false
  editingCategory.value = null
  formError.value = ''
  formUncertain.value = false
  await nextTick()

  const trigger = formTrigger.value
  formTrigger.value = null

  if (trigger?.isConnected) {
    trigger.focus({ preventScroll: true })
  } else {
    newButton.value?.focus({ preventScroll: true })
  }

  if (typeof window !== 'undefined') {
    window.scrollTo(0, formScrollY)
  }
}

function closeForm() {
  if (busy.value) return
  void dismissForm()
}

watch(identity, () => {
  formOpen.value = false
  editingCategory.value = null
  formError.value = ''
  formUncertain.value = false
  formTrigger.value = null
  pendingDeactivation.value = null
  mutationError.value = ''
  notice.value = ''
  busy.value = false
  void refreshCategories()
}, { immediate: true, flush: 'sync' })

async function save(fields: { nombre: string; descripcion: string | null }) {
  if (busy.value || !allowed() || !formOpen.value) return

  const session = identity()
  const selected = editingCategory.value
  busy.value = true
  formError.value = ''
  formUncertain.value = false
  mutationError.value = ''
  notice.value = ''

  try {
    const saved = selected
      ? await updateAdminCategory(selected.id_categoria, fields)
      : await createAdminCategory(fields)
    if (session !== identity()) return

    upsertCategory(saved)
    notice.value = selected ? 'Categoría actualizada.' : 'Categoría creada.'
    busy.value = false
    await dismissForm()
  } catch (cause) {
    if (session !== identity()) return

    if (isMutationResultUncertain(cause)) {
      formUncertain.value = true
      formError.value = categoryUncertainMessage
    } else {
      formError.value = categoryMutationErrorMessage(cause)
    }
  } finally {
    if (session === identity()) busy.value = false
  }
}

async function reloadAfterUncertain() {
  if (busy.value) return

  const session = identity()
  busy.value = true
  formError.value = ''

  try {
    await refreshCategories()
    if (session !== identity()) return

    if (error.value) {
      formError.value = 'No se pudo recargar el listado. Reintentá antes de continuar.'
      return
    }

    formUncertain.value = false
    notice.value = 'Listado actualizado.'
    busy.value = false
    await dismissForm()
  } finally {
    if (session === identity()) busy.value = false
  }
}

async function confirmDeactivation() {
  const selected = pendingDeactivation.value
  if (!selected || busy.value || !allowed()) return

  const session = identity()
  busy.value = true
  mutationError.value = ''
  notice.value = ''

  try {
    const updated = await deactivateAdminCategory(selected.id_categoria)
    if (session !== identity()) return

    upsertCategory(updated)
    pendingDeactivation.value = null
    notice.value = 'Categoría desactivada.'
  } catch (cause) {
    if (session !== identity()) return

    mutationError.value = isMutationResultUncertain(cause)
      ? 'No se pudo confirmar la desactivación. Recargá el listado antes de reintentar.'
      : categoryMutationErrorMessage(cause)
  } finally {
    if (session === identity()) busy.value = false
  }
}
</script>

<template>
  <section aria-labelledby="categories-title" class="min-w-0 space-y-4" :aria-busy="busy ? 'true' : 'false'">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 id="categories-title" class="m-0 min-w-0 text-xl font-semibold text-[#0b2438] wrap-anywhere">
        Categorías
      </h2>
      <button
        ref="newButton"
        type="button"
        class="box-border min-h-11 rounded-md bg-[#103a5c] px-4 text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
        :disabled="busy || loading || formOpen || !!pendingDeactivation"
        @click="openCreate($event)"
      >
        Nueva categoría
      </button>
    </div>

    <p
      v-if="notice"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      class="pointer-events-none fixed left-4 right-4 top-4 z-[60] m-0 box-border rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 shadow-lg wrap-anywhere sm:left-auto sm:max-w-sm"
    >
      {{ notice }}
    </p>
    <p
      v-if="mutationError"
      role="alert"
      class="pointer-events-none fixed left-4 right-4 top-4 z-[60] m-0 box-border rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 shadow-lg wrap-anywhere sm:left-auto sm:max-w-sm"
    >
      {{ mutationError }}
    </p>

    <AdminCategoryForm
      v-if="formOpen"
      :key="editingCategory?.id_categoria ?? 'new'"
      :category="editingCategory"
      :busy="busy"
      :error="formError"
      :uncertain="formUncertain"
      @save="save"
      @cancel="closeForm"
      @reload="reloadAfterUncertain"
    />

    <div v-if="pendingDeactivation" class="box-border space-y-2 rounded-md border border-slate-300 p-4">
      <p class="m-0 wrap-anywhere">
        ¿Desactivar <strong>{{ pendingDeactivation.nombre }}</strong>?
        La categoría dejará de aparecer en el catálogo público.
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="box-border min-h-11 rounded-md bg-red-800 px-4 text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
          :disabled="busy"
          @click="confirmDeactivation()"
        >
          Confirmar desactivación
        </button>
        <button
          type="button"
          class="box-border min-h-11 rounded-md border border-slate-300 px-4 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
          :disabled="busy"
          @click="pendingDeactivation = null"
        >
          Cancelar
        </button>
      </div>
    </div>

    <p v-if="loading" role="status">Cargando categorías…</p>
    <div v-else-if="error" class="space-y-2">
      <p role="alert" class="text-red-800 wrap-anywhere">No se pudieron cargar las categorías.</p>
      <button
        type="button"
        class="box-border min-h-11 rounded-md border border-slate-300 px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
        @click="refreshCategories()"
      >
        Reintentar
      </button>
    </div>

    <template v-else-if="categories">
      <label class="flex flex-wrap items-center gap-2 text-sm font-medium">
        Estado
        <select v-model="filter" class="box-border min-h-11 rounded-md border border-slate-300 px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]">
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
          class="box-border min-w-0 space-y-2 rounded-lg border border-slate-200 bg-white p-4"
        >
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="m-0 min-w-0 font-semibold wrap-anywhere">{{ category.nombre }}</h3>
            <span
              class="box-border rounded-full px-2 py-1 text-xs font-medium"
              :class="category.activo === 1
                ? 'bg-green-100 text-green-900'
                : 'bg-slate-100 text-slate-700'"
            >
              {{ category.activo === 1 ? 'Activa' : 'Inactiva' }}
            </span>
          </div>
          <p class="m-0 whitespace-pre-wrap text-sm text-slate-700 wrap-anywhere">
            {{ category.descripcion ?? 'Sin descripción' }}
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="box-border min-h-11 rounded-md border border-slate-300 px-4 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
              :aria-label="`Editar ${category.nombre}`"
              :disabled="busy || formOpen || !!pendingDeactivation"
              @click="openEdit(category, $event)"
            >
              Editar
            </button>
            <button
              v-if="category.activo === 1"
              type="button"
              class="box-border min-h-11 rounded-md border border-red-300 px-4 text-red-800 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
              :aria-label="`Desactivar ${category.nombre}`"
              :disabled="busy || formOpen || !!pendingDeactivation"
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
