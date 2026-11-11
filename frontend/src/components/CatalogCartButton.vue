<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useCartStore } from '@/stores/cart'
import { useCartPanelStore } from '@/stores/cartPanel'
import { precioComprable } from '@/services/pricingService'
import type { CatalogProduct } from '@/types/catalog'
import type { PriceLine } from '@/types/pricing'

const props = defineProps<{
  product: CatalogProduct
  line?: PriceLine
  loading: boolean
  error: string
}>()

const auth = useAuthStore()
const cart = useCartStore()
const panel = useCartPanelStore()

const currentItem = computed(() =>
  cart.items.find(item =>
    item.id_producto === props.product.id,
  ),
)

const message = computed(() => {
  if (!auth.isAuthenticated) {
    return 'Iniciá sesión para agregar productos.'
  }

  if (auth.rol !== 'CLIENTE') {
    return 'El carrito está disponible para cuentas de cliente.'
  }

  if (!props.product.disponible) {
    return 'Producto sin stock disponible.'
  }

  if (props.loading) {
    return 'Consultando precio…'
  }

  if (props.error || !precioComprable(props.line)) {
    return 'Precio no disponible para agregar.'
  }

  if (
    cart.loadError ||
    (cart.needsSync && !cart.loading)
  ) {
    return 'Volvé a consultar el carrito antes de agregar.'
  }

  if (
    currentItem.value &&
    currentItem.value.cantidad >= currentItem.value.stock
  ) {
    return 'Ya agregaste todo el stock disponible.'
  }

  return ''
})

const disabled = computed(() =>
  !!message.value ||
  cart.loading ||
  cart.operation !== null ||
  !cart.cart,
)

async function add() {
  if (disabled.value) return

  const quantity = (currentItem.value?.cantidad ?? 0) + 1
  const accepted = await cart.agregarProducto(
    props.product.id,
    quantity,
  )

  if (accepted || cart.operationError || cart.loadError) {
    panel.open()
  }
}
</script>

<template>
  <div>
    <button
      type="button"
      class="flex min-h-[44px] min-w-[44px] w-full items-center justify-center cursor-pointer rounded-md
        border-0 bg-[#103A5C] hover:bg-[#145A8D] px-4 py-2 font-[inherit]
        text-base sm:text-sm font-semibold text-white
        disabled:cursor-not-allowed disabled:bg-slate-400
        focus-visible:outline-2 focus-visible:outline-offset-2
        focus-visible:outline-[#145a8d] transition-colors"
      :disabled="disabled"
      :aria-describedby="`cart-message-${product.id}`"
      @click="add"
    >
      Agregar
    </button>

    <p
      :id="`cart-message-${product.id}`"
      class="mb-0 mt-2 text-xs text-slate-500 empty:hidden"
    >
      {{ message }}
    </p>
  </div>
</template>