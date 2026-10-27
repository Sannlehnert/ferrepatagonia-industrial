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
  <h3 class="m-0 mb-4 text-lg font-semibold text-[#0b2438]">Mis pedidos</h3>

  <p v-if="cargando" class="text-slate-600">Cargando...</p>
  <p v-else-if="error" class="text-red-800">{{ error }}</p>
  <p v-else-if="!pedidos.length">Todavía no hiciste ningún pedido.</p>

  <template v-else>
    <div class="mb-4 flex flex-wrap items-end gap-4">
      <label class="flex flex-col gap-1 text-sm">
        Estado
        <select class="box-border min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2" v-model="filtroEstado">
          <option value="">Todos</option>
          <option v-for="(label, valor) in etiquetas" :key="valor" :value="valor">
            {{ label }}
          </option>
        </select>
      </label>

      <label class="flex flex-col gap-1 text-sm">
        Desde
        <input class="box-border min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2" type="date" v-model="desde" :max="hasta || undefined" />
      </label>

      <label class="flex flex-col gap-1 text-sm">
        Hasta
        <input class="box-border min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2" type="date" v-model="hasta" :min="desde || undefined" />
      </label>

      <button class="min-h-11 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-[#103a5c] hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50" type="button" :disabled="!hayFiltros" @click="limpiarFiltros">
        Limpiar filtros
      </button>
    </div>

    <p v-if="rangoInvalido" class="text-red-800">
      La fecha "Desde" no puede ser posterior a "Hasta".
    </p>
    <p v-else-if="!pedidosFiltrados.length">
      No hay pedidos que coincidan con los filtros.
    </p>

    <div v-else class="overflow-x-auto">
      <p class="mb-2 text-sm text-slate-600">
        Mostrando {{ pedidosFiltrados.length }} de {{ pedidos.length }} pedidos
      </p>
      <table class="w-full min-w-[480px] border-collapse text-left">
        <thead>
          <tr>
            <th class="border-b border-slate-300 p-2 text-left">N°</th>
            <th class="border-b border-slate-300 p-2 text-left">Fecha</th>
            <th class="border-b border-slate-300 p-2 text-left">Estado</th>
            <th class="border-b border-slate-300 p-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in pedidosFiltrados" :key="p.id">
            <td class="border-b border-slate-200 p-2">#{{ p.id }}</td>
            <td class="border-b border-slate-200 p-2">{{ fecha(p.fecha) }}</td>
            <td class="border-b border-slate-200 p-2">
              <span class="rounded-full px-2 py-1 text-sm" :class="{
                'bg-amber-100 text-amber-900': p.estado === 'pendiente',
                'bg-blue-100 text-blue-800': p.estado === 'en_camino',
                'bg-green-100 text-green-900': p.estado === 'entregado',
                'bg-red-100 text-red-900': p.estado === 'cancelado',
              }">
                {{ etiquetas[p.estado] }}
              </span>
            </td>
            <td class="border-b border-slate-200 p-2 text-right">{{ moneda(p.total) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>
