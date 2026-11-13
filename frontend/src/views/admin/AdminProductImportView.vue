<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProductImportBatch } from '@/composables/useProductImportBatch'

const {
  preview,
  report,
  selectedFileName,
  recoveryToken,
  error,
  operation,
  busy,
  canSelectFile,
  canConfirm,
  selectFile,
  confirm,
  refreshStatus,
  reportUnavailable,
  stopTrackingBatch,
} = useProductImportBatch()

const dragging = ref(false)

const templateHeaders = [
  'codigo',
  'nombre',
  'id_categoria',
  'precio_base_usd',
  'stock',
  'descripcion',
  'imagen',
  'activo',
  'descuento_especial_pct',
]

const reportStatus = {
  pendiente: 'Pendiente de confirmación',
  procesando: 'Procesando',
  por_verificar: 'Resultado por verificar',
  completado: 'Completado',
}

const issues = computed(() => {
  if (report.value) {
    return report.value.detalles.flatMap(({ row, motivos }) =>
      motivos.map((issue) => ({ row, ...issue })),
    )
  }

  return preview.value?.errors ?? []
})

function handleFileChange(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''

  if (file) void selectFile(file)
}

function handleDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files[0]
  if (file) void selectFile(file)
}

function downloadCsv(name: string, content: string) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', content], {
    type: 'text/csv;charset=utf-8',
  }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function csvCell(value: string | number) {
  const text = String(value)
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

function downloadTemplate() {
  downloadCsv('productos-fer16-v2.csv', `${templateHeaders.join(',')}\r\n`)
}

function downloadErrors() {
  const rows = issues.value.map(({ row, field, code, message }) =>
    [row, field, code, message].map(csvCell).join(','),
  )

  downloadCsv('errores-importacion.csv', ['fila,campo,codigo,motivo', ...rows].join('\r\n'))
}
</script>

<template>
  <section class="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6">
    <header class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-[#0B2438]">Importar productos</h1>
        <p class="mt-1 text-sm text-slate-600">
          Cargá una planilla CSV o XLSX, revisá la previsualización y confirmá el lote.
        </p>
      </div>
      <button
        type="button"
        class="min-h-11 rounded-md border border-[#103A5C] px-4 py-2 font-semibold text-[#103A5C]"
        @click="downloadTemplate"
      >
        Descargar plantilla CSV
      </button>
    </header>

    <section
      aria-labelledby="import-file-title"
      class="rounded-lg border-2 border-dashed p-5"
      :class="dragging && canSelectFile ? 'border-sky-700 bg-sky-50' : 'border-slate-300 bg-white'"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="handleDrop"
    >
      <h2 id="import-file-title" class="font-semibold">Seleccionar archivo</h2>
      <p class="my-2 text-sm text-slate-700">
        Arrastrá un archivo o elegilo desde tu dispositivo. Hasta 5 MiB y 1.000 filas.
        En XLSX usá la hoja Productos y guardá los SKU como texto.
        Dejá el precio vacío si está ausente o ingresá 0 si es un cero explícito.
      </p>
      <input
        type="file"
        aria-label="Archivo CSV o XLSX"
        accept=".csv,.xlsx"
        class="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:bg-[#103A5C] file:px-3 file:text-white disabled:opacity-50"
        :disabled="!canSelectFile"
        @change="handleFileChange"
      >
      <p v-if="selectedFileName" class="mt-2 break-all text-sm">
        Archivo seleccionado: {{ selectedFileName }}
      </p>
    </section>

    <p v-if="busy" role="status" class="text-sm text-slate-700">
      {{
        operation === 'preview'
          ? 'Previsualizando la planilla…'
          : operation === 'confirm'
            ? 'Confirmando la importación…'
            : 'Consultando el estado del lote…'
      }}
    </p>
    <p v-if="error" role="alert" class="rounded-md bg-red-50 p-3 text-sm text-red-800">
      {{ error }}
    </p>

    <section v-if="preview" aria-labelledby="import-preview-title" class="space-y-3">
      <h2 id="import-preview-title" class="text-lg font-semibold">Previsualización</h2>
      <p class="text-sm">
        {{ preview.totalRows }} filas · {{ preview.validRowsCount }} listas para importar ·
        {{ preview.invalidRowsCount }} descartadas
      </p>
      <p v-if="preview.duplicateInFileCount || preview.existingInDbCount" class="text-sm">
        SKU repetidos en el archivo: {{ preview.duplicateInFileCount }} ·
        SKU existentes en el catálogo: {{ preview.existingInDbCount }}
      </p>

      <div
        v-if="preview.validRows.length"
        role="region"
        aria-label="Filas listas para importar"
        tabindex="0"
        class="max-h-96 overflow-auto rounded-md border border-slate-200"
      >
        <table class="w-full min-w-[64rem] text-left text-sm">
          <thead class="bg-slate-100">
            <tr>
              <th scope="col" class="p-2">Fila</th>
              <th scope="col" class="p-2">SKU</th>
              <th scope="col" class="p-2">Producto</th>
              <th scope="col" class="p-2">Categoría</th>
              <th scope="col" class="p-2">Precio USD</th>
              <th scope="col" class="p-2">Stock</th>
              <th scope="col" class="p-2">Descripción</th>
              <th scope="col" class="p-2">Imagen (URL)</th>
              <th scope="col" class="p-2">Estado activo</th>
              <th scope="col" class="p-2">Descuento (%)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="{ row, producto } in preview.validRows" :key="row" class="border-t">
              <td class="p-2">{{ row }}</td>
              <td class="p-2">{{ producto.codigo }}</td>
              <td class="p-2">{{ producto.nombre }}</td>
              <td class="p-2">{{ producto.id_categoria }}</td>
              <td class="p-2">{{ producto.precio_base_usd ?? 'Sin precio' }}</td>
              <td class="p-2">{{ producto.stock }}</td>
              <td class="max-w-64 break-words p-2">{{ producto.descripcion ?? '—' }}</td>
              <td class="max-w-64 break-all p-2">{{ producto.imagen ?? '—' }}</td>
              <td class="p-2">{{ producto.activo ? 'Activo' : 'Inactivo' }}</td>
              <td class="p-2">{{ producto.descuento_especial_pct ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="preview || recoveryToken" class="flex flex-wrap gap-3">
      <button
        v-if="preview || report?.estado === 'pendiente'"
        type="button"
        class="min-h-11 rounded-md bg-[#103A5C] px-4 py-2 font-semibold text-white disabled:opacity-50"
        :disabled="!canConfirm"
        @click="confirm()"
      >
        {{ recoveryToken ? 'Reintentar confirmación del lote' : 'Confirmar importación' }}
      </button>
      <button
        v-if="recoveryToken"
        type="button"
        class="min-h-11 rounded-md border border-[#103A5C] px-4 py-2 font-semibold text-[#103A5C] disabled:opacity-50"
        :disabled="busy"
        @click="refreshStatus()"
      >
        Consultar estado del lote
      </button>
      <button
        v-if="reportUnavailable"
        type="button"
        class="min-h-11 rounded-md border border-[#103A5C] px-4 py-2 font-semibold text-[#103A5C] disabled:opacity-50"
        :disabled="busy"
        @click="stopTrackingBatch()"
      >
        Ya revisé el catálogo, dejar de seguir este lote
      </button>
    </div>

    <section
      v-if="report"
      aria-labelledby="import-report-title"
      class="space-y-2 rounded-md border border-slate-200 bg-white p-4"
    >
      <h2 id="import-report-title" class="text-lg font-semibold">Resultado de importación</h2>
      <p role="status" class="text-sm">
        {{ reportStatus[report.estado] }} · {{ report.totalProcesados }} filas ·
        {{ report.importados }} importadas · {{ report.omitidos }} omitidas ·
        {{ report.rechazados }} rechazadas · {{ report.pendientes }} pendientes
      </p>
    </section>

    <section v-if="issues.length" aria-labelledby="import-errors-title" class="space-y-3">
      <h2 id="import-errors-title" class="text-lg font-semibold">Motivos por fila</h2>
      <ul class="max-h-64 list-disc space-y-1 overflow-auto pl-6 text-sm">
        <li v-for="(issue, index) in issues" :key="index">
          Fila {{ issue.row }}, {{ issue.field }}: {{ issue.message }}
        </li>
      </ul>
      <button
        type="button"
        class="min-h-11 rounded-md border border-[#103A5C] px-4 py-2 font-semibold text-[#103A5C]"
        @click="downloadErrors"
      >
        Descargar reporte de errores
      </button>
    </section>
  </section>
</template>