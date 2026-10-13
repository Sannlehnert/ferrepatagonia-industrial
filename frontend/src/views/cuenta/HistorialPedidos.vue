<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { Pedido, EstadoPedido, FiltroEstado } from '@/types/cuenta'
import { getPedidos } from '@/services/cuentaService'

const pedidos = ref<Pedido[]>([])
const cargando = ref(true)
const error = ref<string | null>(null)

const etiquetas: Record<EstadoPedido, string> = {
  pendiente: 'Pendiente',
  en_camino: 'En camino',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
}

const moneda = (n: number) =>
  n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })

const fecha = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

onMounted(async () => {
  try {
    pedidos.value = await getPedidos()
  } catch {
    error.value = 'No se pudo cargar tu historial de pedidos.'
  } finally {
    cargando.value = false
  }
})
const filtroEstado = ref<FiltroEstado>('')
const desde = ref('') // 'YYYY-MM-DD'
const hasta = ref('') // 'YYYY-MM-DD'

const hayFiltros = computed(
  () => !!filtroEstado.value || !!desde.value || !!hasta.value,
)

const rangoInvalido = computed(
  () => !!desde.value && !!hasta.value && desde.value > hasta.value,
)

const pedidosFiltrados = computed(() => {
  if (rangoInvalido.value) return []
  return pedidos.value.filter(
    (p) =>
      (!filtroEstado.value || p.estado === filtroEstado.value) &&
      (!desde.value || p.fecha >= desde.value) &&
      (!hasta.value || p.fecha <= hasta.value),
  )
})

const limpiarFiltros = () => {
  filtroEstado.value = ''
  desde.value = ''
  hasta.value = ''
}
</script>

<template>
  <h3>Mis pedidos</h3>

  <p v-if="cargando">Cargando...</p>
  <p v-else-if="error">{{ error }}</p>
  <p v-else-if="!pedidos.length">Todavía no hiciste ningún pedido.</p>

  <template v-else>
    <div class="filtros">
      <label>
        Estado
        <select v-model="filtroEstado">
          <option value="">Todos</option>
          <option v-for="(label, valor) in etiquetas" :key="valor" :value="valor">
            {{ label }}
          </option>
        </select>
      </label>

      <label>
        Desde
        <input type="date" v-model="desde" :max="hasta || undefined" />
      </label>

      <label>
        Hasta
        <input type="date" v-model="hasta" :min="desde || undefined" />
      </label>

      <button type="button" :disabled="!hayFiltros" @click="limpiarFiltros">
        Limpiar filtros
      </button>
    </div>

    <p v-if="rangoInvalido" class="aviso">
      La fecha "Desde" no puede ser posterior a "Hasta".
    </p>
    <p v-else-if="!pedidosFiltrados.length">
      No hay pedidos que coincidan con los filtros.
    </p>

    <div v-else class="tabla-wrap">
      <p class="resumen">
        Mostrando {{ pedidosFiltrados.length }} de {{ pedidos.length }} pedidos
      </p>
      <table class="pedidos">
        <thead>
          <tr>
            <th>N°</th>
            <th>Fecha</th>
            <th>Estado</th>
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in pedidosFiltrados" :key="p.id">
            <td>#{{ p.id }}</td>
            <td>{{ fecha(p.fecha) }}</td>
            <td>
              <span class="estado" :class="`estado--${p.estado}`">
                {{ etiquetas[p.estado] }}
              </span>
            </td>
            <td class="num">{{ moneda(p.total) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>

<style scoped>
.tabla-wrap { overflow-x: auto; }
.pedidos { width: 100%; border-collapse: collapse; }
.pedidos th, .pedidos td { padding: .6rem .8rem; text-align: left; border-bottom: 1px solid #ddd; }
.num { text-align: right !important; }
.estado { padding: .15rem .6rem; border-radius: 999px; font-size: .85rem; }
.estado--pendiente { background: #fff3cd; color: #7a5b00; }
.estado--en_camino { background: #cfe2ff; color: #084298; }
.estado--entregado { background: #d1e7dd; color: #0f5132; }
.estado--cancelado { background: #f8d7da; color: #842029; }
.filtros { display: flex; flex-wrap: wrap; gap: 1rem; align-items: end; margin-bottom: 1rem; }
.filtros label { display: flex; flex-direction: column; gap: .25rem; font-size: .9rem; }
.resumen { font-size: .85rem; color: #666; margin: 0 0 .5rem; }
.aviso { color: #842029; }
</style>
