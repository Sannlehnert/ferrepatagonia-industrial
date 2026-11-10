import { nextTick, ref } from 'vue'

export function useNavigationDisclosure() {
  const expanded = ref(false)
  const trigger = ref<HTMLButtonElement | null>(null)
  const panel = ref<HTMLElement | null>(null)

  function close(restoreFocus = false) {
    if (!expanded.value) return
    expanded.value = false
    if (restoreFocus) trigger.value?.focus()
  }

  async function toggle() {
    if (expanded.value) {
      close(true)
      return
    }
    expanded.value = true
    await nextTick()
    panel.value?.querySelector('a')?.focus()
  }

  function escape(event: KeyboardEvent) {
    if (!expanded.value || !trigger.value?.getClientRects().length) return
    event.preventDefault()
    close(true)
  }

  return { expanded, trigger, panel, close, toggle, escape }
}
