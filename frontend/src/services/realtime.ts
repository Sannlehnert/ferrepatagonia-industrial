import { io } from 'socket.io-client'
import { onScopeDispose, watch } from 'vue'
import type { useAuthStore } from '@/stores/auth'

type AuthStore = ReturnType<typeof useAuthStore>
type Invalidation = { cart: boolean; products: Set<number>; order: boolean; reconnect: boolean }
const listeners = new Set<(change: Invalidation) => void>()
const empty = (): Invalidation => ({ cart: false, products: new Set(), order: false, reconnect: false })
const isId = (id: unknown): id is number =>
  typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && id <= 2147483647

export function onRealtime(listener: (change: Invalidation) => void) {
  listeners.add(listener)
  onScopeDispose(() => { listeners.delete(listener) })
}

export function refreshOnStock(
  affected: (products: ReadonlySet<number>) => boolean, refresh: () => void,
) {
  onRealtime(change => {
    if (change.reconnect || (change.products.size > 0 && affected(change.products))) refresh()
  })
}

export function startRealtime(auth: AuthStore) {
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('ferrepatagonia-session')
  const stopAuth = auth.$onAction(({ name, after }) => {
    if (name === 'login' || name === 'logout') {
      after(result => {
        if (result !== false) channel?.postMessage('session-changed')
      })
    }
  })
  if (channel) {
    channel.onmessage = event => {
      if (event.data !== 'session-changed' || auth.loggingIn || auth.loggingOut) return
      auth.clear()
      void auth.fetchSession().catch(() => {})
    }
  }
  onScopeDispose(() => { stopAuth(); channel?.close() })

  watch(() => auth.sessionChecked && !auth.sessionError && !auth.loggingIn && !auth.loggingOut && auth.user
    ? `${auth.user.id}:${auth.user.rol}:${auth.sessionVersion}` : null,
  (session, _, onCleanup) => {
    if (!session) return
    const socket = io({ path: '/socket.io/', autoConnect: false, withCredentials: true })
    let active = true
    let ready = false
    let connectedBefore = false
    let transportVersion = 0
    let batch = empty()
    let scheduled: ReturnType<typeof setTimeout> | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    const seen = new Set<string>()

    function schedule() {
      scheduled ??= setTimeout(() => {
        const pending = batch
        batch = empty()
        scheduled = undefined
        if (active && ready) for (const listener of listeners) listener(pending)
      }, 30)
    }

    async function verifyReconnect(version: number) {
      try {
        if (!await auth.fetchSession(true)) return
        if (!active || version !== transportVersion) return
        ready = true
        batch.reconnect = true
        schedule()
      } catch {
        if (active && version === transportVersion) {
          retry = setTimeout(() => void verifyReconnect(version), 2000)
        }
      }
    }
    socket.on('connect', () => {
      const version = ++transportVersion
      clearTimeout(retry)
      if (connectedBefore) void verifyReconnect(version)
      else ready = true
      connectedBefore = true
    })
    socket.on('disconnect', reason => {
      transportVersion++
      clearTimeout(retry)
      ready = false
      batch = empty()
      if (active && reason === 'io server disconnect') void auth.fetchSession(true).catch(() => {})
    })
    socket.on('connect_error', error => {
      if (!active) return
      if (error.message === 'NO_AUTENTICADO') void auth.fetchSession(true).catch(() => {})
      if (error.message === 'AUTENTICACION_NO_DISPONIBLE') {
        retry = setTimeout(() => { if (active) socket.connect() }, 2000)
      }
    })
    socket.on('carrito.actualizado.v1', payload => {
      if (!ready || payload?.version !== 1) return
      batch.cart = true
      schedule()
    })
    socket.on('stock.actualizado.v1', payload => {
      const ids: unknown = payload?.productosIds
      if (!ready || payload?.version !== 1 || !Array.isArray(ids) || !ids.length || !ids.every(isId)) return
      for (const id of ids) batch.products.add(id)
      schedule()
    })
    socket.on('pedido.confirmado.v1', payload => {
      if (!ready || payload?.version !== 1 || !isId(payload.pedidoId) ||
          payload.estado !== 'CONFIRMADO' || typeof payload.notificadoEn !== 'string' ||
          !Number.isFinite(Date.parse(payload.notificadoEn)) ||
          payload.idEvento !== `pedido.confirmado.v1:${payload.pedidoId}` || seen.has(payload.idEvento)) return
      seen.add(payload.idEvento)
      if (seen.size > 256) seen.delete(seen.values().next().value!)
      batch.order = true
      batch.cart = true
      schedule()
    })
    queueMicrotask(() => { if (active) socket.connect() })
    onCleanup(() => {
      active = false
      clearTimeout(scheduled)
      clearTimeout(retry)
      socket.removeAllListeners()
      socket.disconnect()
    })
  }, { immediate: true, flush: 'sync' })
}
