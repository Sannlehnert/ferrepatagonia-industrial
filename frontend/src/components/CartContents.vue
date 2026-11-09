<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import CartLine from '@/components/CartLine.vue'
import CartSummary from '@/components/CartSummary.vue'
import AccountOrderCheckout from '@/components/AccountOrderCheckout.vue'
import { useAccountOrderStore } from '@/stores/accountOrder'
import { useCartStore } from '@/stores/cart'
import { useCartPanelStore } from '@/stores/cartPanel'

const cart = useCartStore()
const order = useAccountOrderStore()
const panel = useCartPanelStore()

onMounted(() => {
  void cart.cargarCarrito()
})

const busy = computed(() =>
  cart.loading ||
  cart.operation !== null ||
  order.attemptState === 'submitting' ||
  order.attemptState === 'pending',
)
</script>

<template>
  <section
    aria-label="Contenido del carrito"
    :aria-busy="busy"
    class="text-sm text-[#13293a]"
  >
    <ul
      v-if="order.receipts.length"
      aria-label="Comprobantes de pedidos confirmados"
      class="my-4 list-none rounded-lg border border-solid border-green-300 bg-green-50 p-3"
    >
      <li
        v-for="receipt in order.receipts"
        :key="receipt.pedidoId"
        role="status"
        class="mb-2 last:mb-0"
      >
        Pedido #{{ receipt.pedidoId }} confirmado por USD {{ receipt.totalUSD }}.
        Vence el {{ receipt.venceEl }}.
      </li>
    </ul>

    <p v-if="busy" role="status" class="my-3">
      {{
        cart.operation
          ? 'Actualizando carrito…'
          : 'Consultando carrito…'
      }}
    </p>

    <div
      v-if="cart.loadError || cart.operationError"
      role="alert"
      class="my-4 rounded-lg border border-solid
        border-amber-300 bg-amber-50 p-3"
    >
      <p v-if="cart.operationError" class="mb-2 mt-0">
        {{ cart.operationError }}
      </p>

      <p v-if="cart.loadError" class="mb-2 mt-0">
        {{ cart.loadError }}
      </p>

      <button
        type="button"
        :disabled="busy"
        class="min-h-11 cursor-pointer border-0 bg-transparent
          p-0 font-[inherit] text-[#103a5c] underline
          disabled:cursor-not-allowed disabled:opacity-50
          focus-visible:outline-2 focus-visible:outline-[#145a8d]"
        @click="cart.cargarCarrito()"
      >
        Volver a consultar carrito
      </button>
    </div>

    <template v-if="cart.cart">
      <div
        v-if="!cart.items.length && !cart.needsSync"
        role="status"
        class="py-6"
      >
        <p class="mb-3 mt-0">Tu carrito está vacío.</p>

        <RouterLink
          :to="{ name: 'catalogo' }"
          class="inline-flex min-h-11 items-center
            text-[#103a5c] underline
            focus-visible:outline-2 focus-visible:outline-[#145a8d]"
          @click="panel.close()"
        >
          Explorar catálogo
        </RouterLink>
      </div>

      <ul
        v-else
        aria-label="Productos del carrito"
        class="m-0 list-none p-0"
      >
        <CartLine
          v-for="item in cart.items"
          :key="item.id_producto"
          :item="item"
          :busy="busy"
          :stale="cart.needsSync"
          @quantity="cart.actualizarCantidad(item.id_producto, $event)"
          @remove="cart.quitarProducto(item.id_producto)"
        />
      </ul>

      <CartSummary
        v-if="cart.items.length"
        :snapshot="cart.cart"
        :stale="cart.needsSync"
      />
      <AccountOrderCheckout
        v-if="!cart.items.length && order.attemptState === 'pending'"
        :snapshot="cart.cart"
        :stale="cart.needsSync"
      />
    </template>
  </section>
</template>
