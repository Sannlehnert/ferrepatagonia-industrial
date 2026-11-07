<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'

const props = defineProps<{
  quantity: number
  stock: number
  disabled: boolean
  productName: string
}>()

const emit = defineEmits<{
  change: [quantity: number]
}>()

const errorId = useId()
const error = ref('')
const draft = ref(String(props.quantity))
const maximum = computed(() => Math.min(props.stock, 2147483647))

watch(
  () => [props.quantity, props.stock, props.disabled],
  () => {
    draft.value = String(props.quantity)
    error.value = ''
  },
)

function submit(quantity: number) {
  if (props.disabled) return

  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > maximum.value
  ) {
    error.value = `Ingresá una cantidad entre 1 y ${maximum.value}.`
    return
  }

  error.value = ''
  draft.value = String(quantity)

  if (quantity !== props.quantity) {
    emit('change', quantity)
  }
}

function submitDraft() {
  submit(draft.value.trim() ? Number(draft.value) : NaN)
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center gap-1">
      <button
        type="button"
        class="min-h-11 min-w-8 cursor-pointer rounded border-0
          bg-slate-50 font-bold text-[#103a5c]
          disabled:cursor-not-allowed disabled:opacity-50
          focus-visible:outline-2 focus-visible:outline-[#145a8d]"
        :disabled="disabled || quantity <= 1"
        :aria-label="`Disminuir cantidad de ${productName}`"
        @click="submit(Math.min(quantity - 1, maximum))"
      >
        −
      </button>

      <input
        :value="draft"
        @input="draft = ($event.target as HTMLInputElement).value"
        type="number"
        inputmode="numeric"
        min="1"
        :max="maximum"
        step="1"
        class="box-border min-h-11 w-14 rounded border border-solid
          border-slate-200 bg-white p-1 text-center font-[inherit]
          text-sm text-[#13293a] disabled:opacity-50
          focus-visible:outline-2 focus-visible:outline-[#145a8d]"
        :disabled="disabled"
        :aria-label="`Cantidad de ${productName}`"
        :aria-invalid="!!error"
        :aria-describedby="errorId"
        @change="submitDraft"
      />

      <button
        type="button"
        class="min-h-11 min-w-8 cursor-pointer rounded border-0
          bg-slate-50 font-bold text-[#103a5c]
          disabled:cursor-not-allowed disabled:opacity-50
          focus-visible:outline-2 focus-visible:outline-[#145a8d]"
        :disabled="disabled || quantity >= maximum"
        :aria-label="`Aumentar cantidad de ${productName}`"
        @click="submit(quantity + 1)"
      >
        +
      </button>
    </div>

    <p
      :id="errorId"
      role="alert"
      class="mb-0 mt-1 text-xs text-orange-800 empty:hidden"
    >
      {{ error }}
    </p>
  </div>
</template>