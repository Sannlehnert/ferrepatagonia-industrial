import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import axios from 'axios'
import { accountOrderErrorMessage, accountOrderService } from '@/services/accountOrderService'
import { currentSessionGeneration } from '@/services/sessionGeneration'
import { useAuthStore } from '@/stores/auth'
import type {
  AccountOrderAttempt,
  AccountOrderEligibility,
  AccountOrderTransport,
  ConfirmedAccountOrder,
  PendingAccountOrderStorage,
} from '@/types/accountOrder'

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const browserStorage: PendingAccountOrderStorage = {
  get(userId) {
    return typeof window === 'undefined'
      ? null
      : window.sessionStorage.getItem(`account-order:${userId}`)
  },
  set(userId, key) {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(`account-order:${userId}`, key)
    }
  },
  remove(userId) {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(`account-order:${userId}`)
    }
  },
}

export function createAccountOrderStore(
  transport: AccountOrderTransport = accountOrderService,
  storage: PendingAccountOrderStorage = browserStorage,
  createKey: () => string = () => crypto.randomUUID(),
) {
  return defineStore('account-order', () => {
    const auth = useAuthStore()
    const eligibility = shallowRef<AccountOrderEligibility | null>(null)
    const eligibilityLoading = ref(false)
    const eligibilityError = ref('')
    const attemptState = ref<'idle' | 'submitting' | 'pending' | 'confirmed' | 'rejected'>('idle')
    const attemptError = ref('')
    const confirmation = shallowRef<ConfirmedAccountOrder | null>(null)
    const pendingKey = ref('')
    const storageError = ref('')
    const canUseCredit = computed(() => eligibility.value?.elegible === true)

    const sessionKey = computed(() => {
      if (!auth.sessionChecked || auth.sessionError || auth.loggingIn ||
          auth.loggingOut || auth.user?.rol !== 'CLIENTE') return null
      return `${auth.user.id}:${auth.sessionVersion}`
    })

    let activeEligibility: AbortController | undefined
    let activeAttempt: AbortController | undefined
    let revision = 0
    let disposed = false

    function current(userId: number, version: number) {
      return !disposed &&
        auth.user?.id === userId &&
        auth.sessionVersion === version &&
        version === currentSessionGeneration() &&
        sessionKey.value !== null
    }

    function clearState(userId: number | null) {
      revision++
      activeEligibility?.abort()
      activeAttempt?.abort()
      activeEligibility = undefined
      activeAttempt = undefined
      eligibility.value = null
      eligibilityLoading.value = false
      eligibilityError.value = ''
      attemptState.value = 'idle'
      attemptError.value = ''
      confirmation.value = null
      pendingKey.value = ''
      storageError.value = ''

      if (userId === null) return
      try {
        const savedKey = storage.get(userId)
        if (savedKey && uuidV4.test(savedKey)) {
          pendingKey.value = savedKey
          attemptState.value = 'pending'
        } else if (savedKey) {
          storage.remove(userId)
        }
      } catch {
        storageError.value = 'No se pudo recuperar el intento guardado en esta sesión.'
      }
    }

    function isCurrent(requestId: number, userId: number, version: number) {
      return requestId === revision && current(userId, version)
    }

    async function loadEligibility() {
      const userId = auth.user?.id
      const version = currentSessionGeneration()
      if (userId === undefined || !sessionKey.value || disposed) return false

      activeEligibility?.abort()
      const controller = activeEligibility = new AbortController()
      const requestId = revision
      eligibility.value = null
      eligibilityLoading.value = true
      eligibilityError.value = ''
      try {
        const result = await transport.getEligibility(controller.signal)
        if (activeEligibility !== controller || !isCurrent(requestId, userId, version)) return false
        eligibility.value = result
        return true
      } catch (error: unknown) {
        if (activeEligibility === controller && isCurrent(requestId, userId, version)) {
          const message = axios.isAxiosError<{ message?: string }>(error)
            ? error.response?.data?.message
            : undefined
          eligibilityError.value = typeof message === 'string' && message.trim()
            ? message
            : 'No pudimos verificar si tu pedido puede confirmarse a crédito. Reintentá la consulta.'
        }
        return false
      } finally {
        if (activeEligibility === controller) {
          activeEligibility = undefined
          if (isCurrent(requestId, userId, version)) eligibilityLoading.value = false
        }
      }
    }

    function finishAttempt(
      result: AccountOrderAttempt,
      userId: number,
      requestId: number,
      version: number,
    ) {
      if (!isCurrent(requestId, userId, version)) return false
      attemptError.value = ''
      if (result.estado === 'PENDIENTE') {
        attemptState.value = 'pending'
        return false
      }

      confirmation.value = result.result
      attemptState.value = 'confirmed'
      pendingKey.value = ''
      try {
        storage.remove(userId)
        storageError.value = ''
      } catch {
        storageError.value = 'El pedido está confirmado, pero no se pudo limpiar el intento guardado.'
      }
      return true
    }

    async function confirm() {
      const userId = auth.user?.id
      const version = currentSessionGeneration()
      if (userId === undefined || !sessionKey.value ||
          !canUseCredit.value || attemptState.value !== 'idle' || disposed) return false

      let key: string
      try {
        key = createKey()
        if (!uuidV4.test(key)) throw new Error('La clave de confirmación no es un UUID v4 válido.')
        storage.set(userId, key)
      } catch {
        attemptState.value = 'rejected'
        attemptError.value = 'No se pudo iniciar un intento seguro de confirmación. Volvé a intentarlo.'
        return false
      }

      pendingKey.value = key
      attemptState.value = 'submitting'
      attemptError.value = ''
      const requestId = revision
      const controller = activeAttempt = new AbortController()
      try {
        const result = await transport.confirm(key, controller.signal)
        return finishAttempt(result, userId, requestId, version)
      } catch (error: unknown) {
        if (!isCurrent(requestId, userId, version)) return false
        const status = axios.isAxiosError(error) ? error.response?.status : undefined
        if (status === 400 || status === 403 || status === 409 || status === 422) {
          attemptState.value = 'rejected'
          pendingKey.value = ''
          attemptError.value = accountOrderErrorMessage(error)
          try {
            storage.remove(userId)
          } catch {
            storageError.value = 'No se pudo limpiar el intento rechazado de esta sesión.'
          }
          if (status === 409 || status === 422) void loadEligibility()
        } else {
          attemptState.value = 'pending'
          attemptError.value = accountOrderErrorMessage(error)
        }
        return false
      } finally {
        if (activeAttempt === controller) activeAttempt = undefined
      }
    }

    async function consultResult() {
      const userId = auth.user?.id
      const version = currentSessionGeneration()
      const key = pendingKey.value
      if (userId === undefined || !sessionKey.value || !key ||
          attemptState.value === 'submitting' || disposed) return false

      attemptState.value = 'submitting'
      attemptError.value = ''
      const requestId = revision
      const controller = activeAttempt = new AbortController()
      try {
        const result = await transport.recover(key, controller.signal)
        return finishAttempt(result, userId, requestId, version)
      } catch (error: unknown) {
        if (isCurrent(requestId, userId, version)) {
          attemptState.value = 'pending'
          attemptError.value = accountOrderErrorMessage(error)
        }
        return false
      } finally {
        if (activeAttempt === controller) activeAttempt = undefined
      }
    }

    function prepareRetry() {
      if (attemptState.value !== 'rejected') return
      attemptState.value = 'idle'
      attemptError.value = ''
    }

    watch(sessionKey, key => {
      const userId = key === null ? null : auth.user!.id
      clearState(userId)
      if (key !== null) {
        const scheduled = revision
        void loadEligibility()
        if (pendingKey.value) {
          queueMicrotask(() => {
            if (scheduled === revision && sessionKey.value === key) void consultResult()
          })
        }
      }
    }, { immediate: true, flush: 'sync' })

    onScopeDispose(() => {
      disposed = true
      clearState(null)
    })

    return {
      eligibility, eligibilityLoading, eligibilityError, canUseCredit, attemptState,
      attemptError, confirmation, pendingKey, storageError,
      loadEligibility, confirm, consultResult, prepareRetry,
    }
  })
}

export const useAccountOrderStore = createAccountOrderStore()
