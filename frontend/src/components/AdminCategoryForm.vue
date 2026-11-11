<script setup lang="ts">
import { ref } from 'vue'
import type { AdminCategory } from '@/services/adminCategoryService'

const props = defineProps<{
  category?: AdminCategory
  busy: boolean
}>()

const emit = defineEmits<{
  save: [fields: { nombre: string; descripcion: string | null }]
  cancel: []
}>()

const name = ref(props.category?.nombre ?? '')
const description = ref(props.category?.descripcion ?? '')
const error = ref('')

function submit() {
  if (props.busy) return

  const nombre = name.value.trim()
  if (nombre.length === 0 || Array.from(nombre).length > 150) {
    error.value = 'Ingresá un nombre de entre 1 y 150 caracteres.'
    return
  }

  if (new TextEncoder().encode(description.value).length > 65535) {
    error.value = 'La descripción supera el límite de 65.535 bytes.'
    return
  }

  error.value = ''
  emit('save', {
    nombre,
    descripcion: description.value.trim() ? description.value : null,
  })
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <fieldset :disabled="busy" class="m-0 min-w-0 space-y-4 border-0 p-0">
      <legend class="mb-3 font-semibold text-[#0b2438]">
        {{ category ? 'Editar categoría' : 'Nueva categoría' }}
      </legend>

      <label class="block text-sm font-medium">
        Nombre
        <input
          v-model="name"
          required
          class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"
        >
      </label>

      <label class="block text-sm font-medium">
        Descripción (opcional)
        <textarea
          v-model="description"
          rows="3"
          class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </label>

      <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>

      <div class="flex flex-wrap gap-2">
        <button type="submit" class="min-h-11 rounded-md bg-[#103a5c] px-4 text-white">
          {{ busy ? 'Guardando…' : 'Guardar categoría' }}
        </button>
        <button
          type="button"
          class="min-h-11 rounded-md border border-slate-300 px-4"
          @click="emit('cancel')"
        >
          Cancelar
        </button>
      </div>
    </fieldset>
  </form>
</template>