<!-- src/views/cuenta/DatosCliente.vue -->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { Cliente } from '@/types/cuenta'
import { getCliente } from '@/services/cuentaService'

const cliente = ref<Cliente | null>(null)
const cargando = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    cliente.value = await getCliente()
  } catch {
    error.value = 'No se pudieron cargar tus datos.'
  } finally {
    cargando.value = false
  }
})
</script>

<template>
  <h3 class="m-0 mb-4 text-lg font-semibold text-[#0b2438]">Mis datos</h3>

  <p v-if="cargando" class="text-slate-600">Cargando...</p>
  <p v-else-if="error" class="text-red-800">{{ error }}</p>

  <dl v-else-if="cliente" class="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2 max-[420px]:grid-cols-1">
    <dt class="font-semibold">Nombre</dt><dd class="m-0 break-words">{{ cliente.nombre }}</dd>
    <dt class="font-semibold">Email</dt><dd class="m-0 break-words">{{ cliente.email }}</dd>
    <dt class="font-semibold">Teléfono</dt><dd class="m-0 break-words">{{ cliente.telefono }}</dd>
    <dt class="font-semibold">Dirección</dt><dd class="m-0 break-words">{{ cliente.direccion }}</dd>
  </dl>
</template>