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
  <h3>Mis datos</h3>

  <p v-if="cargando">Cargando...</p>
  <p v-else-if="error">{{ error }}</p>

  <dl v-else-if="cliente" class="datos">
    <dt>Nombre</dt><dd>{{ cliente.nombre }}</dd>
    <dt>Email</dt><dd>{{ cliente.email }}</dd>
    <dt>Teléfono</dt><dd>{{ cliente.telefono }}</dd>
    <dt>Dirección</dt><dd>{{ cliente.direccion }}</dd>
  </dl>
</template>

<style scoped>
.datos { display: grid; grid-template-columns: 120px 1fr; gap: .5rem 1rem; }
dt { font-weight: 600; }
dd { margin: 0; }
</style>