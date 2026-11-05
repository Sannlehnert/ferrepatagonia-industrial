import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { cartErrorMessage, cartService } from '@/services/cartService'
import { currentSessionGeneration } from '@/services/sessionGeneration'
import type { CartMutation, CartSnapshot, CartTransport } from '@/types/cart'

function positiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0
}

export function createCartStore(transport: CartTransport) {
  return defineStore('cart', () => {
    const auth = useAuthStore()
    const cart = shallowRef<CartSnapshot | null>(null)
    const loading = ref(false)
    const operation = ref<CartMutation['type'] | null>(null)
    const loadError = ref('')
    const operationError = ref('')
    const needsSync = ref(false)
    // #245 no devuelve precios. Un GET exitoso únicamente revalida stock.
    const pricesNeedValidation = computed(() => true)
    const stockNeedsValidation = computed(() => !cart.value || needsSync.value)
    const checksPending = ref(0)
    const items = computed(() => cart.value?.items ?? [])
    let active: AbortController | undefined
    let revision = 0
    let disposed = false

    const sessionKey = computed(() => {
      if (checksPending.value || !auth.sessionChecked || auth.sessionError ||
          auth.loggingIn || auth.loggingOut || auth.user?.rol !== 'CLIENTE') return null
      return `${auth.user.id}:${auth.sessionVersion}`
    })

    // La verificación puede ejecutarse con sessionChecked todavía en true.
    const unsubscribe = auth.$onAction(({ name, after, onError }) => {
      if (name !== 'fetchSession') return
      checksPending.value++
      const settled = () => { checksPending.value-- }
      after(settled)
      onError(settled)
    }, true)

    function limpiarEstado() {
      revision++
      const previous = active
      active = undefined
      cart.value = null
      loading.value = false
      operation.value = null
      loadError.value = ''
      operationError.value = ''
      needsSync.value = false
      previous?.abort()
    }

    function start(key: string) {
      const controller = active = new AbortController()
      const generation = currentSessionGeneration()
      return {
        signal: controller.signal,
        isCurrent: () => active === controller && !controller.signal.aborted &&
          generation === currentSessionGeneration() && key === sessionKey.value,
        finish: () => {
          if (active === controller) {
            active = undefined
            loading.value = false
            operation.value = null
          }
        },
      }
    }

    async function sync(request: ReturnType<typeof start>) {
      if (!request.isCurrent()) return false
      loadError.value = ''
      needsSync.value = true
      try {
        const result = await transport.get(request.signal)
        if (!request.isCurrent()) return false
        cart.value = result
        needsSync.value = false
        return true
      } catch (cause) {
        if (request.isCurrent()) loadError.value = cartErrorMessage(cause)
        return false
      }
    }

    async function cargarCarrito() {
      const key = sessionKey.value
      if (!key || active || disposed) return false
      const request = start(key)
      loading.value = true
      try {
        return await sync(request)
      } finally {
        request.finish()
      }
    }

    async function mutate(command: CartMutation) {
      const key = sessionKey.value
      if (!key || active || disposed) return false
      if (!positiveInteger(command.productoId) ||
          ('cantidad' in command && !positiveInteger(command.cantidad))) {
        operationError.value = 'Ingresá un producto y una cantidad entera positiva.'
        return false
      }
      if (!transport.mutate) {
        operationError.value = 'Las operaciones del carrito todavía no están disponibles.'
        return false
      }
      if (needsSync.value) {
        operationError.value = 'Volvé a consultar el carrito antes de modificarlo.'
        return false
      }

      const request = start(key)
      operation.value = command.type
      operationError.value = ''
      needsSync.value = true
      try {
        let accepted = false
        try {
          if (!request.isCurrent()) return false
          await transport.mutate(command, request.signal)
          accepted = true
        } catch (cause) {
          if (request.isCurrent()) operationError.value = cartErrorMessage(cause)
        }
        if (!request.isCurrent()) return false
        // El servidor pudo aplicar la escritura aunque se haya perdido la respuesta.
        await sync(request)
        return accepted && request.isCurrent() && !needsSync.value
      } finally {
        request.finish()
      }
    }

    watch(sessionKey, (key) => {
      limpiarEstado()
      if (key !== null) {
        const scheduled = revision
        // Esperar a que termine la transición síncrona del store de autenticación.
        queueMicrotask(() => {
          if (scheduled === revision && key === sessionKey.value) void cargarCarrito()
        })
      }
    }, { immediate: true, flush: 'sync' })

    onScopeDispose(() => {
      disposed = true
      unsubscribe()
      limpiarEstado()
    })

    return {
      cart, items, loading, operation, loadError, operationError, needsSync,
      pricesNeedValidation, stockNeedsValidation,
      cargarCarrito, limpiarEstado,
      agregarProducto: (productoId: number, cantidad: number) => mutate({ type: 'add', productoId, cantidad }),
      actualizarCantidad: (productoId: number, cantidad: number) => mutate({ type: 'update', productoId, cantidad }),
      quitarProducto: (productoId: number) => mutate({ type: 'remove', productoId }),
    }
  })
}

export const useCartStore = createCartStore(cartService)
