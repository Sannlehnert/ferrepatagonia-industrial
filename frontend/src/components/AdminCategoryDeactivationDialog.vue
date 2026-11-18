<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AdminCategory } from '@/services/adminCategoryService'

const props = defineProps<{
  category: AdminCategory
  busy: boolean
  error?: string
  uncertain?: boolean
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
  reload: []
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)

let previousOverflow = ''
let previousPaddingRight = ''

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

  // Una desactivación es destructiva: el foco inicial queda en Cancelar.
  cancelButton.value?.focus({ preventScroll: true })
}

onMounted(() => {
  lockPageScroll()
  void showDialog()
})

onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
  unlockPageScroll()
})

function getFocusableElements(): HTMLElement[] {
  const element = dialog.value
  if (!element) return []

  return Array.from(element.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter(item => item.getClientRects().length > 0)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab') return

  const focusables = getFocusableElements()
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (!first || !last) {
    event.preventDefault()
    return
  }

  const active = dialog.value?.ownerDocument.activeElement
  const inside = Boolean(dialog.value && active && dialog.value.contains(active))

  if (event.shiftKey && (active === first || !inside)) {
    event.preventDefault()
    last.focus({ preventScroll: true })
  } else if (!event.shiftKey && (active === last || !inside)) {
    event.preventDefault()
    first.focus({ preventScroll: true })
  }
}

function requestCancel() {
  if (props.busy || props.uncertain) return
  emit('cancel')
}

function handleBackdropClick(event: MouseEvent) {
  if (event.target === event.currentTarget) requestCancel()
}

function confirm() {
  if (props.busy || props.uncertain) return
  emit('confirm')
}

function reload() {
  if (props.busy) return
  emit('reload')
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      aria-labelledby="category-deactivation-title"
      aria-describedby="category-deactivation-description"
      class="m-auto w-[calc(100%-1rem)] max-w-md border-0 bg-transparent p-0 text-left text-[#0b2438] backdrop:bg-[#0b2438]/70 sm:w-[calc(100%-2rem)]"
      @cancel.prevent="requestCancel"
      @click="handleBackdropClick"
      @keydown="handleKeydown"
    >
      <div class="flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#f8fafc] shadow-2xl">
        <header class="shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
          <h2 id="category-deactivation-title" class="m-0 text-lg font-bold text-[#0b2438] sm:text-xl">
            Desactivar categoría
          </h2>
        </header>

        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm sm:p-6">
          <p id="category-deactivation-description" class="m-0 break-words">
            ¿Desactivar <strong>{{ category.nombre }}</strong>?
            La categoría dejará de aparecer en el catálogo público.
          </p>

          <div
            v-if="uncertain"
            role="alert"
            class="rounded-md border border-red-200 bg-red-50 p-3 text-red-800"
          >
            <p class="m-0">{{ error || 'No se pudo confirmar la desactivación. Recargá el listado antes de reintentar.' }}</p>
            <button
              type="button"
              class="mt-2 min-h-11 border-0 bg-transparent font-semibold text-red-900 underline disabled:opacity-60"
              :disabled="busy"
              @click="reload"
            >
              {{ busy ? 'Recargando…' : 'Recargar listado' }}
            </button>
          </div>
          <p
            v-else-if="error"
            role="alert"
            class="m-0 rounded-md border border-red-200 bg-red-50 p-3 text-red-800"
          >
            {{ error }}
          </p>
        </div>

        <footer class="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row sm:justify-end sm:gap-3 sm:px-6 sm:py-4">
          <button
            ref="cancelButton"
            type="button"
            class="min-h-11 w-full rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            :disabled="busy || uncertain"
            @click="requestCancel"
          >
            Cancelar
          </button>
          <button
            type="button"
            class="min-h-11 w-full rounded-md border-0 bg-red-800 px-5 text-sm font-semibold text-white hover:bg-red-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            :disabled="busy || uncertain"
            @click="confirm"
          >
            {{ busy ? 'Desactivando…' : 'Confirmar desactivación' }}
          </button>
        </footer>
      </div>
    </dialog>
  </Teleport>
</template>
