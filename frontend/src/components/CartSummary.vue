<script setup lang="ts">
import { computed, useId } from 'vue'
import type { CartSnapshot } from '@/types/cart'

const props = defineProps<{
  snapshot: CartSnapshot
  stale: boolean
}>()

const checkoutNoteId = useId()

const showTotal = computed(() =>
  !props.stale &&
  props.snapshot.estado_total === 'DEFINIDO' &&
  !props.snapshot.tiene_incompatibles &&
  props.snapshot.totalUSD !== null &&
  props.snapshot.items.every(item =>
    item.disponible &&
    item.precio?.estadoPrecio === 'DEFINIDO' &&
    item.precio.precioComprable === true &&
    item.precio.datosSinteticos === false,
  ),
)

const listApplied = computed(() =>
  showTotal.value &&
  props.snapshot.items.some(item =>
    item.precio?.origenDescuento === 'LISTA' ||
    item.precio?.origenDescuento === 'AMBOS',
  ),
)

const totalLabel = computed(() =>
  showTotal.value
    ? `USD ${props.snapshot.totalUSD}`
    : 'Pendiente de confirmar',
)
</script>

<template>
  <section aria-label="Resumen del carrito" class="pt-5">
    <dl class="mb-5 mt-0 text-sm font-bold text-[#13293a]">
      <div class="mb-2 flex flex-wrap justify-between gap-2">
        <dt>Subtotal</dt>
        <dd class="m-0">{{ totalLabel }}</dd>
      </div>

      <div
        v-if="listApplied"
        class="mb-2 flex flex-wrap justify-between gap-2"
      >
        <dt>Lista de precios</dt>
        <dd class="m-0 text-green-700">Aplicada</dd>
      </div>

      <div
        class="mt-3 flex flex-wrap justify-between gap-2
          border-0 border-t border-solid border-slate-200
          pt-3 text-xl"
      >
        <dt>Total</dt>
        <dd class="m-0 [overflow-wrap:anywhere]">
          {{ totalLabel }}
        </dd>
      </div>
    </dl>

    <p
      v-if="!showTotal"
      role="status"
      class="mb-3 mt-0 text-xs text-orange-800"
    >
      Volvé a consultar el carrito o revisá los productos
      sin stock o precio disponible.
    </p>

    <p class="mb-3 mt-0 text-xs text-slate-500">
      Precios en USD · IVA incluido.
    </p>

    <button
      type="button"
      disabled
      :aria-describedby="checkoutNoteId"
      class="min-h-12 w-full cursor-not-allowed rounded-lg
        border-0 bg-[#145a8d] px-4 py-2 font-[inherit]
        font-semibold text-white opacity-60"
    >
      Finalizar compra
    </button>

    <p
      :id="checkoutNoteId"
      class="mb-0 mt-2 text-xs text-slate-500"
    >
      La finalización de compra todavía no está disponible.
    </p>
  </section>
</template>