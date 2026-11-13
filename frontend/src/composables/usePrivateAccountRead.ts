import { onBeforeUnmount, ref, shallowRef } from 'vue'

export function usePrivateAccountRead<T>(session: () => string, allowed: () => boolean) {
  const data = shallowRef<T | null>(null)
  const loading = ref(false)
  const error = shallowRef<unknown>(null)
  let sequence = 0
  let controller: AbortController | undefined
  function reset(keepData = false) {
    sequence++
    controller?.abort()
    if (!keepData) data.value = null
    error.value = null
    loading.value = false
  }
  async function load(read: (signal: AbortSignal) => Promise<T>, { keepData = false } = {}) {
    const canRead = allowed()
    reset(keepData && canRead)
    if (!canRead) return
    const current = sequence, identity = session()
    controller = new AbortController()
    const signal = controller.signal
    const valid = () => !signal.aborted && current === sequence && identity === session() && allowed()
    loading.value = true
    try {
      const result = await read(signal)
      if (valid()) data.value = result
    } catch (cause) {
      if (valid()) {
        data.value = null
        error.value = cause
      }
    } finally {
      if (valid()) loading.value = false
    }
  }
  onBeforeUnmount(reset)
  return { data, loading, error, reset, load }
}
