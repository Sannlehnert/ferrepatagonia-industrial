import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

// Diálogo modal nativo con foco contenido, cierre controlado y restauración del
// foco al control que lo abrió. El contenido decide cuándo se puede cerrar.
export function useAdminDialog(options: {
  canClose: () => boolean
  onClose: () => void
}) {
  const dialog = ref<HTMLDialogElement | null>(null)
  const initialFocus = ref<HTMLElement | null>(null)

  let previousOverflow = ''
  let previousPaddingRight = ''
  let opener: HTMLElement | null = null
  let closing = false
  let unmounting = false

  function lockPageScroll() {
    if (typeof document === 'undefined') return
    previousOverflow = document.body.style.overflow
    previousPaddingRight = document.body.style.paddingRight
    const scrollbar = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`
  }

  function unlockPageScroll() {
    if (typeof document === 'undefined') return
    document.body.style.overflow = previousOverflow
    document.body.style.paddingRight = previousPaddingRight
  }

  function focusInitial() {
    const target = initialFocus.value
    if (target?.isConnected && !target.matches(':disabled')) {
      target.focus({ preventScroll: true })
      return
    }

    dialog.value?.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]',
    )?.focus({ preventScroll: true })
  }

  function restoreOpener() {
    if (opener?.isConnected) opener.focus({ preventScroll: true })
  }

  function requestClose() {
    if (!options.canClose() || closing) return
    closing = true
    options.onClose()
  }

  function handleCancel(event: Event) {
    event.preventDefault()
    requestClose()
  }

  function handleNativeClose() {
    if (unmounting || closing) return
    requestClose()
  }

  function focusables(): HTMLElement[] {
    const element = dialog.value
    if (!element) return []
    return Array.from(element.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter(item => item.getClientRects().length > 0)
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      requestClose()
      return
    }
    if (event.key !== 'Tab') return

    const items = focusables()
    const first = items[0]
    const last = items[items.length - 1]
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

  onMounted(async () => {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    lockPageScroll()
    await nextTick()
    const element = dialog.value
    if (!element) return
    if (!element.open) element.showModal()
    focusInitial()
  })

  onBeforeUnmount(() => {
    unmounting = true
    if (dialog.value?.open) dialog.value.close()
    unlockPageScroll()
    restoreOpener()
  })

  return { dialog, initialFocus, handleCancel, handleKeydown, handleNativeClose, requestClose, focusInitial }
}
