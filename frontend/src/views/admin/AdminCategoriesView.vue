<script setup lang="ts">
import axios from 'axios'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AdminCategoryDeactivationDialog from '@/components/AdminCategoryDeactivationDialog.vue'
import AdminCategoryForm from '@/components/AdminCategoryForm.vue'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import {
  activateAdminCategory,
  createAdminCategory,
  deactivateAdminCategory,
  listAdminCategories,
  updateAdminCategory,
  type AdminCategory,
} from '@/services/adminCategoryService'
import { isMutationResultUncertain } from '@/services/adminMutationError'
import { useAuthStore } from '@/stores/auth'

const NOTICE_DURATION_MS = 4000

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
const deactivationError = ref('')
const deactivationUncertain = ref(false)
const activationError = ref('')
const activationUncertain = ref(false)
const busy = ref(false)
const notice = ref('')
const titleHeading = ref<HTMLHeadingElement | null>(null)
const newButton = ref<HTMLButtonElement | null>(null)
const activationReloadButton = ref<HTMLButtonElement | null>(null)
const formTrigger = ref<HTMLElement | null>(null)
const deactivationTrigger = ref<HTMLElement | null>(null)
let formScrollY = 0
let deactivationScrollY = 0
let noticeTimer: ReturnType<typeof setTimeout> | null = null
let unmounted = false

const categoryUncertainMessage = 'No se pudo confirmar el resultado. El formulario quedó bloqueado para evitar duplicados; recargá el listado antes de reintentar.'
const categoryDeactivationUncertainMessage = 'No se pudo confirmar la desactivación. El diálogo quedó bloqueado para evitar duplicados; recargá el listado antes de reintentar.'
const categoryActivationUncertainMessage = 'No se pudo confirmar la activación. Las acciones quedaron bloqueadas para evitar conflictos; recargá el listado antes de reintentar.'

const collator = new Intl.Collator('es', { sensitivity: 'base' })

const visibleCategories = computed(() =>
  (categories.value ?? []).filter(category =>
    filter.value === 'all' || category.activo === (filter.value === 'active' ? 1 : 0),
  ),
)

const actionsBlocked = computed(() =>
  busy.value || formOpen.value || Boolean(pendingDeactivation.value) || activationUncertain.value,
)

function clearNoticeTimer() {
  if (noticeTimer !== null) {
    clearTimeout(noticeTimer)
    noticeTimer = null
  }
}

function clearNotice() {
  clearNoticeTimer()
  notice.value = ''
}

function showNotice(message: string) {
  clearNoticeTimer()
  notice.value = message
  noticeTimer = setTimeout(() => {
    notice.value = ''
    noticeTimer = null
  }, NOTICE_DURATION_MS)
}

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

function resolveTriggerElement(event?: Event): HTMLElement | null {
  if (typeof HTMLElement === 'undefined') return null
  if (event?.currentTarget instanceof HTMLElement) {
    return event.currentTarget
  }
  if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    return document.activeElement
  }
  return null
}

function rememberFormOrigin(event?: Event) {
  const trigger = resolveTriggerElement(event)
  if (trigger) formTrigger.value = trigger

  if (typeof window !== 'undefined') {
    formScrollY = window.scrollY
  }
}

function rememberDeactivationOrigin(event?: Event) {
  const trigger = resolveTriggerElement(event)
  if (trigger) deactivationTrigger.value = trigger

  if (typeof window !== 'undefined') {
    deactivationScrollY = window.scrollY
  }
}

function clearFeedback() {
  formError.value = ''
  formUncertain.value = false
  deactivationError.value = ''
  deactivationUncertain.value = false
  activationError.value = ''
  activationUncertain.value = false
  clearNotice()
}

function openCreate(event?: Event) {
  if (busy.value || loading.value || pendingDeactivation.value || formOpen.value || activationUncertain.value) return

  clearFeedback()
  editingCategory.value = null
  rememberFormOrigin(event)
  formOpen.value = true
}

function openEdit(category: AdminCategory, event?: Event) {
  if (busy.value || loading.value || pendingDeactivation.value || formOpen.value || activationUncertain.value) return

  clearFeedback()
  editingCategory.value = category
  rememberFormOrigin(event)
  formOpen.value = true
}

function openDeactivation(category: AdminCategory, event?: Event) {
  if (busy.value || loading.value || formOpen.value || pendingDeactivation.value || activationUncertain.value) return

  clearFeedback()
  rememberDeactivationOrigin(event)
  pendingDeactivation.value = category
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

async function dismissDeactivation() {
  const selected = pendingDeactivation.value
  pendingDeactivation.value = null
  deactivationError.value = ''
  deactivationUncertain.value = false
  await nextTick()

  const trigger = deactivationTrigger.value
  deactivationTrigger.value = null
  let target: HTMLElement | null = trigger?.isConnected ? trigger : null

  if (!target && selected && typeof document !== 'undefined') {
    target = document.querySelector<HTMLElement>(
      `[data-category-edit-id="${selected.id_categoria}"]`,
    )
  }

  target ??= titleHeading.value ?? newButton.value
  target?.focus({ preventScroll: true })

  if (typeof window !== 'undefined') {
    window.scrollTo(0, deactivationScrollY)
  }
}

function closeDeactivation() {
  if (busy.value || deactivationUncertain.value) return
  void dismissDeactivation()
}

watch(identity, () => {
  formOpen.value = false
  editingCategory.value = null
  formError.value = ''
  formUncertain.value = false
  formTrigger.value = null
  pendingDeactivation.value = null
  deactivationError.value = ''
  deactivationUncertain.value = false
  deactivationTrigger.value = null
  activationError.value = ''
  activationUncertain.value = false
  clearNotice()
  busy.value = false
  void refreshCategories()
}, { immediate: true, flush: 'sync' })

onBeforeUnmount(() => {
  unmounted = true
  clearNoticeTimer()
})

async function save(fields: { nombre: string; descripcion: string | null }) {
  if (busy.value || !allowed() || !formOpen.value) return

  const session = identity()
  const selected = editingCategory.value
  busy.value = true
  formError.value = ''
  formUncertain.value = false
  activationError.value = ''
  clearNotice()

  try {
    const saved = selected
      ? await updateAdminCategory(selected.id_categoria, fields)
      : await createAdminCategory(fields)
    if (session !== identity()) return

    upsertCategory(saved)
    showNotice(selected ? 'Categoría actualizada.' : 'Categoría creada.')
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
    showNotice('Listado actualizado.')
    busy.value = false
    await dismissForm()
  } finally {
    if (session === identity()) busy.value = false
  }
}

async function confirmDeactivation() {
  const selected = pendingDeactivation.value
  if (!selected || busy.value || !allowed() || deactivationUncertain.value) return

  const session = identity()
  busy.value = true
  deactivationError.value = ''
  activationError.value = ''
  clearNotice()

  try {
    const updated = await deactivateAdminCategory(selected.id_categoria)
    if (session !== identity()) return

    upsertCategory(updated)
    showNotice('Categoría desactivada.')
    busy.value = false
    await dismissDeactivation()
  } catch (cause) {
    if (session !== identity()) return

    if (isMutationResultUncertain(cause)) {
      deactivationUncertain.value = true
      deactivationError.value = categoryDeactivationUncertainMessage
    } else {
      deactivationError.value = categoryMutationErrorMessage(cause)
    }
  } finally {
    if (session === identity()) busy.value = false
  }
}

async function reloadAfterDeactivationUncertain() {
  if (busy.value || !pendingDeactivation.value || !deactivationUncertain.value) return

  const session = identity()
  busy.value = true
  deactivationError.value = ''

  try {
    await refreshCategories()
    if (session !== identity()) return

    if (error.value) {
      deactivationError.value = 'No se pudo recargar el listado. Reintentá antes de continuar.'
      return
    }

    deactivationUncertain.value = false
    showNotice('Listado actualizado.')
    busy.value = false
    await dismissDeactivation()
  } finally {
    if (session === identity()) busy.value = false
  }
}

async function activateCategory(category: AdminCategory, event?: Event) {
  if (
    busy.value
    || loading.value
    || formOpen.value
    || pendingDeactivation.value
    || activationUncertain.value
    || !allowed()
  ) return

  const session = identity()
  const trigger = resolveTriggerElement(event)
  const scrollY = typeof window !== 'undefined' ? window.scrollY : 0

  busy.value = true
  activationError.value = ''
  activationUncertain.value = false
  clearNotice()

  try {
    const updated = await activateAdminCategory(category.id_categoria)
    if (session !== identity()) return

    upsertCategory(updated)
    showNotice('Categoría activada.')
    busy.value = false
    await nextTick()
    if (session !== identity() || unmounted) return

    let target: HTMLElement | null = null
    if (typeof document !== 'undefined') {
      target = document.querySelector<HTMLElement>(
        `[data-category-status-id="${category.id_categoria}"]`,
      )
    }
    if (!target && trigger?.isConnected) {
      target = trigger
    }
    target ??= titleHeading.value ?? newButton.value
    target?.focus({ preventScroll: true })

    if (typeof window !== 'undefined') {
      window.scrollTo(0, scrollY)
    }
  } catch (cause) {
    if (session !== identity()) return

    if (isMutationResultUncertain(cause)) {
      activationUncertain.value = true
      activationError.value = categoryActivationUncertainMessage
      busy.value = false
      await nextTick()
      if (session !== identity() || unmounted) return
      activationReloadButton.value?.focus({ preventScroll: true })
    } else {
      activationError.value = categoryMutationErrorMessage(cause)
      busy.value = false
      await nextTick()
      if (session !== identity() || unmounted) return
      if (trigger?.isConnected) {
        trigger.focus({ preventScroll: true })
      }
    }

    if (typeof window !== 'undefined') {
      window.scrollTo(0, scrollY)
    }
  } finally {
    if (session === identity()) busy.value = false
  }
}

async function reloadAfterActivationUncertain() {
  if (busy.value || !activationUncertain.value) return

  const session = identity()
  busy.value = true
  activationError.value = ''

  try {
    await refreshCategories()
    if (session !== identity()) return

    if (error.value) {
      activationError.value = 'No se pudo recargar el listado. Reintentá antes de continuar.'
      return
    }

    activationUncertain.value = false
    showNotice('Listado actualizado.')
    busy.value = false
    await nextTick()
    if (session !== identity() || unmounted) return
    ;(titleHeading.value ?? newButton.value)?.focus({ preventScroll: true })
  } finally {
    if (session === identity()) busy.value = false
  }
}
</script>

<template>
  <section aria-labelledby="categories-title" class="min-w-0 space-y-4" :aria-busy="busy ? 'true' : 'false'">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2
        id="categories-title"
        ref="titleHeading"
        tabindex="-1"
        class="m-0 min-w-0 text-xl font-semibold text-[#0b2438] wrap-anywhere"
      >
        Categorías
      </h2>
      <button
        ref="newButton"
        type="button"
        class="box-border min-h-11 rounded-md bg-[#103a5c] px-4 font-[inherit] text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
        :disabled="loading || actionsBlocked"
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

    <div
      v-if="activationError || activationUncertain"
      role="alert"
      class="box-border rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 wrap-anywhere"
    >
      <p class="m-0 wrap-anywhere">
        {{ activationError || categoryActivationUncertainMessage }}
      </p>
      <button
        v-if="activationUncertain"
        ref="activationReloadButton"
        type="button"
        class="mt-2 box-border min-h-11 border-0 bg-transparent p-0 font-[inherit] font-semibold text-red-900 underline disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
        :disabled="busy"
        @click="reloadAfterActivationUncertain"
      >
        {{ busy ? 'Recargando…' : 'Recargar listado' }}
      </button>
    </div>

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

    <AdminCategoryDeactivationDialog
      v-if="pendingDeactivation"
      :key="pendingDeactivation.id_categoria"
      :category="pendingDeactivation"
      :busy="busy"
      :error="deactivationError"
      :uncertain="deactivationUncertain"
      @confirm="confirmDeactivation"
      @cancel="closeDeactivation"
      @reload="reloadAfterDeactivationUncertain"
    />

    <p v-if="loading" role="status">Cargando categorías…</p>
    <div v-else-if="error && !activationUncertain" class="space-y-2">
      <p role="alert" class="text-red-800 wrap-anywhere">No se pudieron cargar las categorías.</p>
      <button
        type="button"
        class="box-border min-h-11 rounded-md border border-slate-300 px-4 font-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
        @click="refreshCategories()"
      >
        Reintentar
      </button>
    </div>

    <template v-else-if="categories">
      <label class="flex flex-wrap items-center gap-2 text-sm font-medium">
        Estado
        <select v-model="filter" class="box-border min-h-11 rounded-md border border-slate-300 px-3 font-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]">
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
              class="box-border min-h-11 rounded-md border border-slate-300 px-4 font-[inherit] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
              :aria-label="`Editar ${category.nombre}`"
              :data-category-edit-id="category.id_categoria"
              :disabled="actionsBlocked"
              @click="openEdit(category, $event)"
            >
              Editar
            </button>
            <button
              v-if="category.activo === 1"
              type="button"
              class="box-border min-h-11 rounded-md border border-red-300 px-4 font-[inherit] text-red-800 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
              :aria-label="`Desactivar ${category.nombre}`"
              :data-category-status-id="category.id_categoria"
              :disabled="actionsBlocked"
              @click="openDeactivation(category, $event)"
            >
              Desactivar
            </button>
            <button
              v-else
              type="button"
              class="box-border min-h-11 rounded-md border border-emerald-700 bg-white px-4 font-[inherit] font-medium text-emerald-800 enabled:hover:bg-emerald-50 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
              :aria-label="`Activar ${category.nombre}`"
              :data-category-status-id="category.id_categoria"
              :disabled="actionsBlocked"
              @click="activateCategory(category, $event)"
            >
              Activar
            </button>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>