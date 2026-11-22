import { onBeforeUnmount } from 'vue'

export interface DeferredRealtimeReconcileOptions {
  allowed: () => boolean
  reconcile: () => void
  isMutating?: () => boolean
}

/**
 * Coordina invalidaciones Socket.IO dentro de ventanas de supresión post-mutación
 * mediante un trailing timer único en lugar de descartar eventos concurrentes.
 */
export function useDeferredRealtimeReconcile(options: DeferredRealtimeReconcileOptions) {
  const isMutating = options.isMutating ?? (() => false)
  let suppressUntil = 0
  let pending = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let timerTarget = 0

  function clearTimer() {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    timerTarget = 0
  }

  function reset() {
    clearTimer()
    pending = false
    suppressUntil = 0
  }

  function scheduleTimer(targetTime: number) {
    if (timer !== undefined && timerTarget >= targetTime) {
      return
    }
    clearTimer()
    timerTarget = targetTime
    const delay = Math.max(0, targetTime - Date.now())
    timer = setTimeout(() => {
      timer = undefined
      timerTarget = 0
      flushPending()
    }, delay)
  }

  function flushPending() {
    if (!pending) return
    if (!options.allowed()) {
      reset()
      return
    }
    if (isMutating()) return
    const now = Date.now()
    if (now < suppressUntil) {
      scheduleTimer(suppressUntil)
      return
    }
    clearTimer()
    pending = false
    options.reconcile()
  }

  function suppress(windowMs = 800) {
    const target = Date.now() + windowMs
    if (target > suppressUntil) {
      suppressUntil = target
    }
  }

  function notify(reconnect: boolean) {
    if (!options.allowed()) return
    if (reconnect) {
      clearTimer()
      pending = false
      options.reconcile()
      return
    }
    const now = Date.now()
    if (isMutating() || now < suppressUntil) {
      pending = true
      if (now < suppressUntil) {
        scheduleTimer(suppressUntil)
      }
      return
    }
    clearTimer()
    pending = false
    options.reconcile()
  }

  onBeforeUnmount(reset)

  return {
    notify,
    reset,
    settleAfterMutation: flushPending,
    suppress,
  }
}
