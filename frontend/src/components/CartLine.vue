<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import CartQuantityControl from '@/components/CartQuantityControl.vue'
import type { CartItem } from '@/types/cart'
import { precioCarritoComprable } from '@/services/cartService'

const props = defineProps<{
  item: CartItem
  busy: boolean
  stale: boolean
}>()

const emit = defineEmits<{
  quantity: [quantity: number]
  remove: []
}>()

const failedImage = ref(false)

watch(() => props.item.imagen, () => {
  failedImage.value = false
})

const priced = computed(() =>
  !props.stale &&
  precioCarritoComprable(props.item.precio),
)

const adjustable = computed(() =>
  !props.busy &&
  !props.stale &&
  props.item.stock > 0 &&
  props.item.motivo_no_disponible !== 'INACTIVO' &&
  priced.value,
)

const availabilityMessage = computed(() => {
  if (props.stale) return 'Stock y precio pendientes de confirmar.'
  if (props.item.motivo_no_disponible === 'INACTIVO') {
    return 'Producto no disponible.'
  }
  if (props.item.disponible) return ''
  return props.item.stock > 0
    ? `Stock insuficiente. Disponibles: ${props.item.stock}.`
    : 'Sin stock.'
})
</script>

<template>
  <li
    class="grid grid-cols-[72px_minmax(0,1fr)_auto] gap-3
      border-0 border-b border-solid border-slate-200 py-4
      max-[380px]:grid-cols-[56px_minmax(0,1fr)]"
  >
    <img
      v-if="item.imagen && !failedImage"
      :src="item.imagen"
      :alt="item.nombre"
      class="size-[72px] rounded-lg object-contain max-[380px]:size-14"
      loading="lazy"
      @error="failedImage = true"
    />

    <div
      v-else
      class="grid size-[72px] place-items-center rounded-lg
        bg-slate-100 text-[11px] text-slate-500 max-[380px]:size-14"
    >
      Sin imagen
    </div>

    <div class="min-w-0">
      <h3
        class="m-0 text-sm font-semibold text-[#13293a]
          [overflow-wrap:anywhere]"
      >
        {{ item.nombre }}
      </h3>

      <p class="my-1 text-xs text-slate-500 [overflow-wrap:anywhere]">
        {{ item.codigo }}
      </p>

      <CartQuantityControl
        :quantity="item.cantidad"
        :stock="item.stock"
        :disabled="!adjustable"
        :product-name="item.nombre"
        @change="emit('quantity', $event)"
      />

      <p
        v-if="availabilityMessage"
        class="my-1 text-xs text-orange-800"
      >
        {{ availabilityMessage }}
      </p>

      <p
        v-if="!stale && !priced"
        class="my-1 text-xs text-orange-800"
      >
        Precio no disponible.
      </p>

      <button
        type="button"
        class="min-h-11 cursor-pointer border-0 bg-transparent p-0
          font-[inherit] text-xs text-[#103a5c] underline
          disabled:cursor-not-allowed disabled:opacity-50
          focus-visible:outline-2 focus-visible:outline-[#145a8d]"
        :disabled="busy || stale"
        :aria-label="`Eliminar ${item.nombre} del carrito`"
        @click="emit('remove')"
      >
        Eliminar
      </button>
    </div>

    <div
      class="max-w-[115px] text-right [overflow-wrap:anywhere]
        max-[380px]:col-start-2 max-[380px]:max-w-none
        max-[380px]:text-left"
    >
      <template v-if="priced && item.disponible && item.precio">
        <p v-if="item.precio.compraAcademica" class="m-0 text-[11px] text-slate-600">Precio simulado</p>
        <p class="m-0 text-sm font-bold text-[#13293a]">
          USD {{ item.precio.subtotalUSD }}
        </p>
        <p class="mb-0 mt-1 text-[11px] text-slate-500">
          USD {{ item.precio.precioUnitarioUSD }} c/u
        </p>
        <p
          v-if="item.precio.descuentoAplicado !== '0.00'"
          class="mb-0 mt-1 text-[11px] text-slate-500"
        >
          Descuento {{ item.precio.descuentoAplicado }}%
        </p>
      </template>

      <p v-else class="m-0 text-xs text-slate-500">
        Importe pendiente
      </p>
    </div>
  </li>
</template>
