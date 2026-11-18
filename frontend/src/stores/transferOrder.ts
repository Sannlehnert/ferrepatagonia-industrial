import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import axios from 'axios'
import { currentSessionGeneration } from '@/services/sessionGeneration'
import { onRealtime } from '@/services/realtime'
import { transferOrderErrorMessage, transferOrderService } from '@/services/transferOrderService'
import { useAuthStore } from '@/stores/auth'
import { useCartStore } from '@/stores/cart'
import type {
  PendingTransferOrderStorage,
  TransferOrderAttempt,
  TransferOrderEligibility,
  TransferOrderTransport,
  ConfirmedTransferOrder,
} from '@/types/transferOrder'

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const browserStorage: PendingTransferOrderStorage = {
  get(userId) {
    return typeof window === 'undefined'
      ? null
      : window.sessionStorage.getItem(`transfer-order:${userId}`)
  },
  set(userId, key, quoteToken) {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(`transfer-order:${userId}`, JSON.stringify({ key, quoteToken }))
    }
  },
  remove(userId) {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(`transfer-order:${userId}`)
    }
  },
}

export function createTransferOrderStore(
  transport: TransferOrderTransport = transferOrderService,
  storage: PendingTransferOrderStorage = browserStorage,
  createKey: () => string = () => crypto.randomUUID(),
) {
  return defineStore('transfer-order', () => {
    const auth = useAuthStore()
    const cart = useCartStore()
    const eligibility = shallowRef<TransferOrderEligibility | null>(null)
    const eligibilityLoading = ref(false)
    const eligibilityError = ref('')
    const attemptState = ref<'idle' | 'submitting' | 'pending' | 'confirmed' | 'rejected'>('idle')
    const attemptError = ref('')
    const confirmation = shallowRef<ConfirmedTransferOrder | null>(null)
    const pendingKey = ref('')
    const pendingQuoteToken = ref('')
    const storageError = ref('')
    const canUseTransfer = computed(() => eligibility.value?.elegible === true)

    const sessionKey = computed(() => {
      if (!auth.sessionChecked || auth.sessionError || auth.loggingIn ||
          auth.loggingOut || auth.user?.rol !== 'CLIENTE') return null
      return `${auth.user.id}:${auth.sessionVersion}`
    })

    let activeEligibility: AbortController | undefined
    let activeAttempt: AbortController | undefined
    let revision = 0
    let disposed = false
    let recoverAfterRequest = false

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
      recoverAfterRequest = false
      eligibility.value = null
      eligibilityLoading.value = false
      eligibilityError.value = ''
      attemptState.value = 'idle'
      attemptError.value = ''
      confirmation.value = null
      pendingKey.value = ''
      pendingQuoteToken.value = ''
      storageError.value = ''

      if (userId === null) return
      try {
        const saved = storage.get(userId)
        let decoded: { key?: unknown; quoteToken?: unknown } | null = null
        if (saved) {
          try { decoded = JSON.parse(saved) as { key?: unknown; quoteToken?: unknown } }
          catch { decoded = uuidV4.test(saved) ? { key: saved } : null }
        }
        if (decoded && typeof decoded.key === 'string' && uuidV4.test(decoded.key) &&
            (decoded.quoteToken === undefined || typeof decoded.quoteToken === 'string')) {
          pendingKey.value = decoded.key
          pendingQuoteToken.value = typeof decoded.quoteToken === 'string' ? decoded.quoteToken : ''
          attemptState.value = 'pending'
        } else if (saved) {
          storage.remove(userId)
        }
      } catch {
        storageError.value = 'No se pudo recuperar el intento de transferencia guardado en esta sesión.'
      }
    }

    function isCurrent(requestId: number, userId: number, version: number) {
      return requestId === revision && current(userId, version)
    }

    async function loadEligibility() {
      const userId = auth.user?.id
      const version = currentSessionGeneration()
      if (userId === undefined || !sessionKey.value || disposed) return false

      if (attemptState.value === 'confirmed') {
        attemptState.value = 'idle'
        confirmation.value = null
      }
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
            : 'No pudimos verificar si tu pedido puede pagarse por transferencia. Reintentá la consulta.'
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
      result: TransferOrderAttempt,
      userId: number,
      requestId: number,
      version: number,
      reconcileCart = true,
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
      pendingQuoteToken.value = ''
      try {
        storage.remove(userId)
        storageError.value = ''
      } catch {
        storageError.value = 'El pedido está registrado, pero no se pudo limpiar el intento guardado.'
      }
      if (reconcileCart) cart.reconciliarPedidoConfirmado()
      return true
    }

    function handleAttemptError(error: unknown, userId: number) {
      const response = axios.isAxiosError<{ estado?: string }>(error) ? error.response : undefined
      attemptError.value = transferOrderErrorMessage(error)
      if (response?.data?.estado !== 'RECHAZADO') {
        attemptState.value = 'pending'
        if (response?.status === 404) {
          attemptError.value = 'No encontramos todavía un resultado para esta clave. Conservamos el mismo identificador; reintentá la consulta o la confirmación con él.'
        }
        return
      }

      attemptState.value = 'rejected'
      pendingKey.value = ''
      pendingQuoteToken.value = ''
      try {
        storage.remove(userId)
      } catch {
        storageError.value = 'No se pudo limpiar el intento de transferencia rechazado de esta sesión.'
      }
    }

    async function confirm() {
      const userId = auth.user?.id
      const version = currentSessionGeneration()
      if (userId === undefined || !sessionKey.value || !canUseTransfer.value ||
          !eligibility.value?.cotizacion || attemptState.value !== 'idle' || disposed) return false

      let key: string
      try {
        key = createKey()
        if (!uuidV4.test(key)) throw new Error('La clave de confirmación no es un UUID v4 válido.')
        storage.set(userId, key, eligibility.value.cotizacion)
      } catch {
        attemptState.value = 'rejected'
        attemptError.value = 'No se pudo iniciar un intento seguro de confirmación. Volvé a intentarlo.'
        return false
      }

      pendingKey.value = key
      pendingQuoteToken.value = eligibility.value.cotizacion
      attemptState.value = 'submitting'
      attemptError.value = ''
      const requestId = revision
      const controller = activeAttempt = new AbortController()
      try {
        const result = await transport.confirm(key, pendingQuoteToken.value, controller.signal)
        return finishAttempt(result, userId, requestId, version)
      } catch (error: unknown) {
        if (!isCurrent(requestId, userId, version)) return false
        handleAttemptError(error, userId)
        return false
      } finally {
        finishRequest(controller)
      }
    }

    async function consultResult(reconcileCart = true) {
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
        return finishAttempt(result, userId, requestId, version, reconcileCart)
      } catch (error: unknown) {
        if (isCurrent(requestId, userId, version)) {
          handleAttemptError(error, userId)
        }
        return false
      } finally {
        finishRequest(controller)
      }
    }

    async function retryPendingConfirmation() {
      const userId = auth.user?.id
      const version = currentSessionGeneration()
      const key = pendingKey.value
      const token = pendingQuoteToken.value
      if (userId === undefined || !sessionKey.value || !key || !token ||
          attemptState.value !== 'pending' || disposed) return false
      attemptState.value = 'submitting'
      attemptError.value = ''
      const requestId = revision
      const controller = activeAttempt = new AbortController()
      try {
        return finishAttempt(await transport.confirm(key, token, controller.signal), userId, requestId, version)
      } catch (error: unknown) {
        if (isCurrent(requestId, userId, version)) {
          handleAttemptError(error, userId)
        }
        return false
      } finally {
        finishRequest(controller)
      }
    }

    function prepareRetry() {
      if (attemptState.value !== 'rejected') return
      attemptState.value = 'idle'
      attemptError.value = ''
    }

    function finishRequest(controller: AbortController) {
      if (activeAttempt !== controller) return
      activeAttempt = undefined
      if (!recoverAfterRequest) return
      recoverAfterRequest = false
      if (pendingKey.value) void consultResult(false)
    }

    onRealtime(change => {
      if (!(change.orders.size || change.reconnect) || !sessionKey.value || !pendingKey.value) return
      if (activeAttempt) recoverAfterRequest = true
      else void consultResult(false)
    })

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
      eligibility, eligibilityLoading, eligibilityError, canUseTransfer, attemptState,
      attemptError, confirmation, pendingKey, pendingQuoteToken, storageError,
      loadEligibility, confirm, consultResult, retryPendingConfirmation, prepareRetry,
    }
  })
}

export const useTransferOrderStore = createTransferOrderStore()
