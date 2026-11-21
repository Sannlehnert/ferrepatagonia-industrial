import { onBeforeUnmount, shallowRef, watch } from 'vue'
import { getAdminAccount } from '@/services/adminAccountService'
import { useAuthStore } from '@/stores/auth'
import type { AdminClient } from '@/types/adminClient'
import type { AccountQuery } from '@/types/adminAccount'

export type ClientCredit = { state: 'READY'; account: AccountQuery } | { state: 'ERROR' }

const CREDIT_TIMEOUT_MS = 15_000

export function useAdminClientCredit(clients: () => AdminClient[]) {
  const auth = useAuthStore()
  const identity = () => [auth.user?.id, auth.rol, auth.sessionVersion].join(':')
  const allowed = () => auth.rol === 'ADMIN' && !auth.loggingIn && !auth.loggingOut
  const results = shallowRef<Record<number, ClientCredit>>({})
  const pending = new Set<number>()
  let queue: number[] = []
  let controller = new AbortController()
  let generation = 0
  let running = 0
  let disposed = false
  const valid = (token: number, session: string) =>
    !disposed && allowed() && generation === token && identity() === session

  function reset() {
    generation++
    controller.abort()
    controller = new AbortController()
    queue = []
    pending.clear()
    running = 0
    results.value = {}
  }

  async function readClient(id: number, signal: AbortSignal): Promise<AccountQuery> {
    const request = new AbortController()
    let interrupt!: () => void
    const interrupted = new Promise<never>((_, reject) => {
      interrupt = () => {
        request.abort()
        reject(new Error('Consulta de crédito cancelada o sin respuesta a tiempo.'))
      }
    })
    signal.addEventListener('abort', interrupt, { once: true })
    const timer = setTimeout(interrupt, CREDIT_TIMEOUT_MS)
    try {
      signal.throwIfAborted()
      return await Promise.race([getAdminAccount(id, request.signal), interrupted])
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', interrupt)
    }
  }

  function pump() {
    const token = generation, session = identity(), signal = controller.signal
    // Publicar por cliente sin superar dos solicitudes simultáneas.
    while (!disposed && allowed() && running < 2 && queue.length) {
      const id = queue.shift()!
      running++
      void readClient(id, signal).then(account => {
        if (valid(token, session)) results.value = { ...results.value, [id]: { state: 'READY', account } }
      }, () => {
        if (valid(token, session)) results.value = { ...results.value, [id]: { state: 'ERROR' } }
      }).finally(() => {
        if (generation !== token) return
        pending.delete(id)
        running--
        pump()
      })
    }
  }

  function refresh(id?: number) {
    if (id === undefined) {
      reset()
      if (disposed || !allowed()) return
      queue = clients().filter(client => client.tipoCliente === 'EMPRESA').map(client => client.id)
      queue.forEach(id => pending.add(id))
    } else {
      if (disposed || !allowed() || pending.has(id) ||
        !clients().some(client => client.id === id && client.tipoCliente === 'EMPRESA')) return
      const next = { ...results.value }
      delete next[id]
      results.value = next
      pending.add(id)
      queue.unshift(id)
    }
    pump()
  }

  function status(id: number): ClientCredit | null {
    return !disposed && allowed() ? results.value[id] ?? null : null
  }

  watch([identity, allowed, clients, () => clients().map(client => client.estadoAprobacionEmpresa).join('|')],
    () => { refresh() }, { immediate: true, flush: 'sync' })
  onBeforeUnmount(() => { disposed = true; reset() })
  return { status, refresh }
}
