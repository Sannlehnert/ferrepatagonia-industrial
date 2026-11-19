<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AdminCategory } from '@/services/adminCategoryService'

const props = defineProps<{
  category?: AdminCategory | null
  busy: boolean
  error?: string
  uncertain?: boolean
}>()

const emit = defineEmits<{
  save: [fields: { nombre: string; descripcion: string | null }]
  cancel: []
  reload: []
}>()

type CategoryFieldErrors = {
  nombre?: string
  descripcion?: string
}

const dialog = ref<HTMLDialogElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const descriptionInput = ref<HTMLTextAreaElement | null>(null)
const name = ref(props.category?.nombre ?? '')
const description = ref(props.category?.descripcion ?? '')
const fieldErrors = ref<CategoryFieldErrors>({})

let previousOverflow = ''
let previousPaddingRight = ''
let lastFocused: HTMLElement | null = null
let suppressCancel = false
let restorePending = false
let closingAuthorized = false
let unmounting = false

function isDirty() {
  return name.value !== (props.category?.nombre ?? '')
    || description.value !== (props.category?.descripcion ?? '')
}

function lockPageScroll() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return

  const body = document.body
  previousOverflow = body.style.overflow
  previousPaddingRight = body.style.paddingRight
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth

  body.style.overflow = 'hidden'
  if (scrollbarWidth > 0) {
    body.style.paddingRight = `${scrollbarWidth}px`
  }
}

function unlockPageScroll() {
  if (typeof document === 'undefined') return

  document.body.style.overflow = previousOverflow
  document.body.style.paddingRight = previousPaddingRight
}

async function showDialog() {
  await nextTick()

  const element = dialog.value
  if (!element) return

  if (!element.open) {
    element.showModal()
  }

  nameInput.value?.focus()
}

onMounted(() => {
  lockPageScroll()
  void showDialog()
})

onBeforeUnmount(() => {
  unmounting = true
  if (dialog.value?.open) dialog.value.close()
  unlockPageScroll()
})

function restoreNativeDialog() {
  const element = dialog.value
  if (unmounting || element?.open || !element) return

  try {
    element.showModal()
  } catch {
    return
  }

  const target = lastFocused
  if (target?.isConnected && element.contains(target) && !target.matches(':disabled')) {
    target.focus({ preventScroll: true })
  } else if (!nameInput.value?.disabled) {
    nameInput.value?.focus({ preventScroll: true })
  }
}

function handleNativeClose() {
  if (unmounting || closingAuthorized) return

  if (props.busy || props.uncertain || isDirty()) {
    if (restorePending) return
    restorePending = true
    void nextTick(() => {
      restorePending = false
      restoreNativeDialog()
    })
    return
  }

  // Cierre nativo sin cambios ni bloqueos: sincronizamos al padre.
  closingAuthorized = true
  emit('cancel')
}

function getFocusableElements(): HTMLElement[] {
  const element = dialog.value
  if (!element) return []

  return Array.from(element.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter(item => item.getClientRects().length > 0)
}

function rememberFocus(event: FocusEvent) {
  const target = event.target
  if (target instanceof HTMLElement && dialog.value?.contains(target)) {
    lastFocused = target
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    suppressCancel = true
    globalThis.setTimeout(() => { suppressCancel = false }, 0)
    requestClose()
    return
  }

  if (event.key !== 'Tab') return

  const focusables = getFocusableElements()
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (!first || !last) {
    event.preventDefault()
    return
  }

  const active = dialog.value?.ownerDocument.activeElement

  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

function handleCancel(event: Event) {
  event.preventDefault()
  if (suppressCancel) return
  requestClose()
}

function requestClose() {
  if (props.busy || props.uncertain) return

  if (isDirty()
    && typeof window !== 'undefined'
    && !window.confirm('Hay cambios sin guardar. ¿Descartar y cerrar el formulario?')) {
    return
  }

  closingAuthorized = true
  emit('cancel')
}

function handleBackdropClick(event: MouseEvent) {
  if (event.target === event.currentTarget) requestClose()
}

function reload() {
  if (props.busy) return
  emit('reload')
}

async function focusFirstInvalidField(errors: CategoryFieldErrors) {
  await nextTick()

  if (errors.nombre) {
    nameInput.value?.focus()
  } else if (errors.descripcion) {
    descriptionInput.value?.focus()
  }
}

function submit() {
  if (props.busy || props.uncertain) return

  const nombre = name.value.trim()
  const errors: CategoryFieldErrors = {}

  if (Array.from(nombre).length === 0 || Array.from(nombre).length > 150) {
    errors.nombre = 'Ingresá un nombre de entre 1 y 150 caracteres.'
  }

  if (new TextEncoder().encode(description.value).length > 65535) {
    errors.descripcion = 'La descripción supera el límite de 65.535 bytes.'
  }

  fieldErrors.value = errors

  if (Object.keys(errors).length > 0) {
    void focusFirstInvalidField(errors)
    return
  }

  emit('save', {
    nombre,
    descripcion: description.value.trim() ? description.value : null,
  })
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      aria-labelledby="category-form-title"
      class="box-border m-auto w-[calc(100%-1rem)] max-w-xl border-0 bg-transparent p-0 text-left text-[#0b2438] backdrop:bg-[#0b2438]/70 sm:w-[calc(100%-2rem)]"
      @cancel="handleCancel"
      @close="handleNativeClose"
      @click="handleBackdropClick"
      @focusin="rememberFocus"
      @keydown="handleKeydown"
    >
      <div class="box-border flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#f8fafc] shadow-2xl">
        <header class="box-border flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
          <h2 id="category-form-title" class="m-0 min-w-0 text-lg font-bold text-[#0b2438] wrap-anywhere sm:text-xl">
            {{ category ? 'Editar categoría' : 'Nueva categoría' }}
          </h2>
          <button
            type="button"
            class="box-border flex min-h-11 min-w-11 items-center justify-center rounded-md border-0 bg-transparent text-2xl leading-none text-slate-500 hover:bg-slate-100 hover:text-[#0b2438] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Cerrar formulario"
            :disabled="busy || uncertain"
            @click="requestClose"
          >
            &times;
          </button>
        </header>

        <form class="box-border flex min-h-0 flex-1 flex-col" novalidate @submit.prevent="submit">
          <!-- Zona fija entre el encabezado y el cuerpo desplazable -->
          <div
            v-if="uncertain || error"
            class="box-border shrink-0 space-y-2 px-4 pt-4 sm:px-6 sm:pt-5"
          >
            <div
              v-if="uncertain"
              role="alert"
              class="box-border rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              <p class="m-0 wrap-anywhere">{{ error || 'No se pudo confirmar el resultado. Recargá el listado antes de continuar.' }}</p>
              <button
                type="button"
                class="mt-2 min-h-11 border-0 bg-transparent font-semibold text-red-900 underline disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                :disabled="busy"
                @click="reload"
              >
                {{ busy ? 'Recargando…' : 'Recargar listado' }}
              </button>
            </div>
            <p
              v-else
              role="alert"
              class="m-0 box-border rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 wrap-anywhere"
            >
              {{ error }}
            </p>
          </div>

          <div class="box-border min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
            <div>
              <label for="category-name" class="block text-sm font-medium">
                Nombre
              </label>
              <input
                id="category-name"
                ref="nameInput"
                v-model="name"
                type="text"
                required
                autocomplete="off"
                :disabled="busy || uncertain"
                :aria-invalid="fieldErrors.nombre ? 'true' : 'false'"
                :aria-describedby="fieldErrors.nombre ? 'category-name-hint category-name-error' : 'category-name-hint'"
                class="box-border mt-1 block min-h-11 w-full rounded-md border bg-white px-3 py-2 font-[inherit] text-sm text-[#0b2438] disabled:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                :class="fieldErrors.nombre ? 'border-red-500' : 'border-slate-300'"
              >
              <p id="category-name-hint" class="mt-1 text-xs text-slate-600">
                Entre 1 y 150 caracteres.
              </p>
              <p
                v-if="fieldErrors.nombre"
                id="category-name-error"
                role="alert"
                class="mt-1 text-sm text-red-800 wrap-anywhere"
              >
                {{ fieldErrors.nombre }}
              </p>
            </div>

            <div>
              <label for="category-description" class="block text-sm font-medium">
                Descripción (opcional)
              </label>
              <textarea
                id="category-description"
                ref="descriptionInput"
                v-model="description"
                rows="4"
                :disabled="busy || uncertain"
                :aria-invalid="fieldErrors.descripcion ? 'true' : 'false'"
                :aria-describedby="fieldErrors.descripcion ? 'category-description-hint category-description-error' : 'category-description-hint'"
                class="box-border mt-1 block min-h-11 w-full resize-y rounded-md border bg-white px-3 py-2 font-[inherit] text-sm text-[#0b2438] disabled:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                :class="fieldErrors.descripcion ? 'border-red-500' : 'border-slate-300'"
              />
              <p id="category-description-hint" class="mt-1 text-xs text-slate-600">
                Hasta 65.535 bytes.
              </p>
              <p
                v-if="fieldErrors.descripcion"
                id="category-description-error"
                role="alert"
                class="mt-1 text-sm text-red-800 wrap-anywhere"
              >
                {{ fieldErrors.descripcion }}
              </p>
            </div>
          </div>

          <footer class="box-border flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row sm:justify-end sm:gap-3 sm:px-6 sm:py-4">
            <button
              type="button"
              class="box-border min-h-11 w-full rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              :disabled="busy || uncertain"
              @click="requestClose"
            >
              Cancelar
            </button>
            <button
              type="submit"
              class="box-border min-h-11 w-full rounded-md border-0 bg-[#103a5c] px-5 text-sm font-semibold text-white hover:bg-[#145a8d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              :disabled="busy || uncertain"
            >
              {{ busy ? 'Guardando…' : 'Guardar categoría' }}
            </button>
          </footer>
        </form>
      </div>
    </dialog>
  </Teleport>
</template>
