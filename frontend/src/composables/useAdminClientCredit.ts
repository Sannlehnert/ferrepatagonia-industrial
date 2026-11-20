import { watch } from 'vue'
import { usePrivateAccountRead } from '@/composables/usePrivateAccountRead'
import { getAdminAccount } from '@/services/adminAccountService'
import { useAuthStore } from '@/stores/auth'
import type { AdminClient } from '@/types/adminClient'
import type { AccountQuery } from '@/types/adminAccount'

export type ClientCredit = { state: 'READY'; account: AccountQuery } | { state: 'ERROR' }

export function useAdminClientCredit(clients: () => AdminClient[]) {
  const auth = useAuthStore()
  const identity = () => [auth.user?.id, auth.rol, auth.sessionVersion].join(':')
  const allowed = () => auth.rol === 'ADMIN' && !auth.loggingIn && !auth.loggingOut
  const query = usePrivateAccountRead<Record<number, ClientCredit>>(identity, allowed)

  function refresh() {
    const companies = clients().filter(client => client.tipoCliente === 'EMPRESA')
    return query.load(async signal => {
      const result: Record<number, ClientCredit> = {}
      let next = 0
      // Limitar las lecturas evita saturar la API al abrir el listado.
      async function worker() {
        while (next < companies.length) {
          signal.throwIfAborted()
          const client = companies[next++]!
          try {
            result[client.id] = { state: 'READY', account: await getAdminAccount(client.id, signal) }
          } catch (cause) {
            if (signal.aborted) throw cause
            result[client.id] = { state: 'ERROR' }
          }
        }
      }
      await Promise.all([worker(), worker()])
      return result
    })
  }

  function status(id: number): ClientCredit | null {
    if (query.loading.value) return null
    return query.data.value?.[id] ?? (query.error.value ? { state: 'ERROR' } : null)
  }

  watch([identity, allowed, clients, () => clients().map(client => client.estadoAprobacionEmpresa).join('|')],
    () => { void refresh() }, { immediate: true, flush: 'sync' })
  return { status, refresh }
}
