import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { currentSessionGeneration } from '@/services/sessionGeneration'
import { getPrices, priceErrorMessage } from '@/services/pricingService'
import type { CatalogProduct } from '@/types/catalog'
import type { PriceLine } from '@/types/pricing'

export function useProductPrices(products: Ref<CatalogProduct[]>, catalogLoading: Ref<boolean>) {
  const auth = useAuthStore()
  const prices = ref<Record<number, PriceLine>>({})
  const loading = ref(false)
  const error = ref('')
  const personalized = computed(() => auth.user?.rol === 'CLIENTE')
  let controller: AbortController | undefined

  async function retry() {
    controller?.abort()
    const current = controller = new AbortController()
    const generation = currentSessionGeneration()
    const version = auth.sessionVersion
    const identity = auth.user?.id
    prices.value = {}
    error.value = ''
    loading.value = false
    // Never label a public request as private while cookies/identity are transitioning.
    if (catalogLoading.value || !products.value.length) return
    if (!auth.sessionChecked || auth.loggingIn || auth.loggingOut || auth.sessionError) {
      loading.value = true
      if (auth.sessionError) { loading.value = false; error.value = 'No se pudo verificar la sesión. Reintentá la consulta de sesión.' }
      return
    }
    loading.value = true
    const isCurrent = () => controller === current && !current.signal.aborted &&
      generation === currentSessionGeneration() && version === auth.sessionVersion && identity === auth.user?.id
    try {
      const result = await getPrices(products.value.map(p => p.id), personalized.value, current.signal)
      if (!isCurrent()) return
      prices.value = Object.fromEntries(result.map(line => [line.productoId, line]))
    } catch (cause) {
      if (isCurrent()) error.value = priceErrorMessage(cause)
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  // Synchronous invalidation removes private values before a render in a new session/page.
  watch(() => [products.value, catalogLoading.value, auth.sessionVersion, auth.user?.id,
    auth.user?.rol, auth.sessionChecked, auth.loggingIn, auth.loggingOut, auth.sessionError],
  () => { void retry() }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => { controller?.abort(); prices.value = {} })
  async function retryPrices() {
    if (auth.sessionError) {
      try { await auth.fetchSession() } catch { return }
    }
    await retry()
  }
  return { prices, loading, error, personalized, retry: retryPrices }
}
