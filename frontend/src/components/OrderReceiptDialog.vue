<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from 'vue'
import OrderPaymentReceipts from '@/components/OrderPaymentReceipts.vue'
import type { ClientOrderSummary } from '@/types/clientOrder'

defineProps<{ order: ClientOrderSummary }>()
const emit = defineEmits<{ close: []; updated: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = useId()
let trigger: HTMLElement | null = null

onMounted(() => {
  trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.value?.showModal()
})

onBeforeUnmount(() => {
  dialog.value?.close()
  if (trigger?.isConnected) trigger.focus()
})
</script>

<template>
  <dialog
    ref="dialog"
    :aria-labelledby="titleId"
    class="box-border m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 backdrop:bg-[#0B2438]/60 sm:p-6"
    @cancel.prevent="emit('close')"
  >
    <header class="flex items-center justify-between gap-3">
      <h3 :id="titleId" class="m-0 text-lg font-bold text-[#0B2438]">
        Comprobantes · {{ order.numero }}
      </h3>
      <button type="button" autofocus aria-label="Cerrar comprobantes"
        class="min-h-[44px] min-w-[44px] rounded border border-slate-300 px-3"
        @click="emit('close')">Cerrar</button>
    </header>
    <OrderPaymentReceipts :order="order" @updated="emit('updated')" />
  </dialog>
</template>
