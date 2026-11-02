<script setup lang="ts">
import axios from 'axios'
import { computed, onMounted, ref } from 'vue'
import {
    getActiveCategories,
    getAdminProducts,
    saveAdminProduct,
    type AdminProduct,
    type CategoryOption,
} from '@/services/adminProductService'
import {
    createProductImportErrorReport,
    createProductImportTemplate,
    parseProductImportCsv,
    type ProductImportItem,
} from '@/services/adminProductImport'

const categories = ref<CategoryOption[]>([])
const products = ref<AdminProduct[]>([])
const items = ref<ProductImportItem[]>([])
const selectedFileName = ref('')
const referenceError = ref('')
const fileError = ref('')
const isLoadingReferences = ref(true)
const isImporting = ref(false)
const isDragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const readyItems = computed(() => items.value.filter((item) => item.status === 'ready'))
const invalidItems = computed(() => items.value.filter((item) => item.status === 'invalid'))
const rejectedItems = computed(() => items.value.filter((item) => item.status === 'rejected'))
const uncertainItems = computed(() => items.value.filter((item) => item.status === 'uncertain'))
const importableCount = computed(
    () => items.value.filter((item) => item.status !== 'invalid').length,
)
const createdCount = computed(
    () => items.value.filter((item) => item.status === 'created').length,
)
const completedCount = computed(
    () =>
        createdCount.value +
        rejectedItems.value.length +
        uncertainItems.value.length,
)
const progressPercent = computed(() => {
    return importableCount.value === 0
        ? 0
        : Math.round((completedCount.value / importableCount.value) * 100)
})
const canImport = computed(
    () =>
        !isLoadingReferences.value &&
        !referenceError.value &&
        !isImporting.value &&
        readyItems.value.length > 0,
)
const categoryNames = computed(
    () => new Map(categories.value.map((category) => [
        Number(category.id_categoria),
        category.nombre,
    ])),
)
let fileSelectionGeneration = 0

function errorMessage(error: unknown, fallback: string): string {
    if (axios.isAxiosError(error)) {
        return (
            error.response?.data?.message ||
            error.response?.data?.error ||
            error.message ||
            fallback
        )
    }
    return error instanceof Error ? error.message : fallback
}

async function loadReferences() {
    isLoadingReferences.value = true
    referenceError.value = ''
    try {
        const [loadedProducts, loadedCategories] = await Promise.all([
            getAdminProducts(),
            getActiveCategories(),
        ])
        products.value = loadedProducts
        categories.value = loadedCategories
    } catch (error: unknown) {
        referenceError.value = errorMessage(
            error,
            'No se pudieron cargar los productos y categorías para validar la planilla.',
        )
    } finally {
        isLoadingReferences.value = false
    }
}

async function selectFile(file: File | undefined) {
    if (isImporting.value) return
    const generation = ++fileSelectionGeneration
    fileError.value = ''
    items.value = []
    selectedFileName.value = ''
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.csv')) {
        fileError.value = 'Seleccioná un archivo CSV. Podés guardar la planilla de Excel como CSV.'
        return
    }
    if (isLoadingReferences.value || referenceError.value) {
        fileError.value = 'Primero cargá los productos y categorías para validar la planilla.'
        return
    }

    selectedFileName.value = file.name
    try {
        const content = await file.text()
        if (generation !== fileSelectionGeneration) return
        items.value = parseProductImportCsv(content, categories.value, products.value)
    } catch (error: unknown) {
        if (generation !== fileSelectionGeneration) return
        selectedFileName.value = ''
        fileError.value = errorMessage(error, 'No se pudo leer la planilla.')
    }
}

function handleFileChange(event: Event) {
    const input = event.target as HTMLInputElement
    void selectFile(input.files?.[0])
    input.value = ''
}

function handleDrop(event: DragEvent) {
    isDragging.value = false
    void selectFile(event.dataTransfer?.files[0])
}

function downloadCsv(filename: string, content: string) {
    const url = URL.createObjectURL(
        new Blob([content], { type: 'text/csv;charset=utf-8' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
}

function downloadTemplate() {
    downloadCsv('plantilla-productos.csv', createProductImportTemplate())
}

function downloadErrorReport() {
    downloadCsv(
        'reporte-errores-importacion.csv',
        createProductImportErrorReport(items.value),
    )
}

function isDefinitiveRejection(error: unknown): boolean {
    if (!axios.isAxiosError(error)) return false
    return [400, 401, 403, 404, 409, 422, 429].includes(
        error.response?.status ?? 0,
    )
}

async function importProducts(retryRejected = false) {
    if (isImporting.value || referenceError.value) return
    const targets = items.value.filter((item) =>
        retryRejected ? item.status === 'rejected' : item.status === 'ready',
    )
    if (targets.length === 0) return

    isImporting.value = true
    try {
        for (const item of targets) {
            if (!item.payload) continue
            item.status = 'creating'
            item.errors = []

            try {
                await saveAdminProduct(item.payload)
                item.status = 'created'
            } catch (error: unknown) {
                item.errors = [
                    errorMessage(error, 'No se pudo confirmar la creación del producto.'),
                ]
                if (isDefinitiveRejection(error)) {
                    item.status = 'rejected'
                    const status = axios.isAxiosError(error)
                        ? error.response?.status
                        : undefined
                    if (status === 401 || status === 403 || status === 429) break
                } else {
                    item.status = 'uncertain'
                    item.errors.push(
                        'El resultado puede haberse guardado. Revisá el catálogo antes de reintentar.',
                    )
                    break
                }
            }
        }
    } finally {
        isImporting.value = false
    }
}

onMounted(loadReferences)
</script>

<template>
    <section class="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
                <h1 class="text-2xl font-bold text-[#0B2438]">Importar productos</h1>
                <p class="mt-1 text-sm text-slate-600">
                    Cargá una planilla CSV, revisá cada fila y confirmá la importación.
                </p>
            </div>
            <button
                type="button"
                class="min-h-11 rounded-md border border-[#103A5C] bg-white px-4 py-2 text-sm font-semibold text-[#103A5C] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                @click="downloadTemplate"
            >
                Descargar plantilla CSV
            </button>
        </header>

        <section
            class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
            aria-labelledby="format-title"
        >
            <h2 id="format-title" class="font-semibold text-[#0B2438]">
                Formato de la planilla
            </h2>
            <p class="mt-2 text-sm text-slate-700">
                Usá los encabezados de la plantilla. Código, nombre, categoría, precio y stock
                son obligatorios; descripción, imagen y activo son opcionales. La categoría se
                identifica con su ID y el precio admite punto o coma decimal, con hasta dos
                decimales. Los SKU existentes o repetidos se informan como errores.
            </p>
            <p class="mt-2 text-sm text-slate-600">
                Categorías activas:
                <span v-if="isLoadingReferences">cargando…</span>
                <span v-else-if="categories.length">
                    {{ categories.map((category) => `${category.id_categoria}: ${category.nombre}`).join(' · ') }}
                </span>
                <span v-else>no hay categorías activas disponibles.</span>
            </p>
        </section>

        <div
            v-if="isLoadingReferences"
            role="status"
            class="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
        >
            Cargando productos y categorías para validar…
        </div>
        <div
            v-else-if="referenceError"
            role="alert"
            class="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
            <p>{{ referenceError }}</p>
            <button
                type="button"
                class="mt-3 min-h-11 rounded-md border border-red-300 bg-white px-4 py-2 font-semibold hover:bg-red-100"
                @click="loadReferences"
            >
                Reintentar carga
            </button>
        </div>

        <section aria-labelledby="file-title" class="flex flex-col gap-3">
            <h2 id="file-title" class="font-semibold text-[#0B2438]">
                Seleccionar archivo
            </h2>
            <div
                class="rounded-lg border-2 border-dashed p-6 text-center transition-colors"
                :class="isDragging ? 'border-[#145A8D] bg-sky-50' : 'border-slate-300 bg-white'"
                @dragenter.prevent="isDragging = true"
                @dragover.prevent="isDragging = true"
                @dragleave.prevent="isDragging = false"
                @drop.prevent="handleDrop"
            >
                <p class="text-sm text-slate-700">
                    Arrastrá tu archivo CSV acá o seleccionalo desde tu dispositivo.
                </p>
                <label
                    for="product-import-file"
                    class="mt-3 inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-[#103A5C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#145A8D] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#145A8D]"
                >
                    Elegir archivo CSV
                    <input
                        id="product-import-file"
                        ref="fileInput"
                        type="file"
                        accept=".csv,text/csv"
                        class="sr-only"
                        :disabled="isLoadingReferences || Boolean(referenceError) || isImporting"
                        @change="handleFileChange"
                    >
                </label>
                <p v-if="selectedFileName" class="mt-3 text-sm font-medium text-slate-700">
                    Archivo: {{ selectedFileName }}
                </p>
            </div>
            <p v-if="fileError" role="alert" class="text-sm text-red-700">
                {{ fileError }}
            </p>
        </section>

        <section v-if="items.length" aria-labelledby="preview-title" class="flex flex-col gap-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 id="preview-title" class="text-lg font-semibold text-[#0B2438]">
                        Previsualización
                    </h2>
                    <p class="text-sm text-slate-600">
                        {{ readyItems.length }} listas para importar ·
                        {{ items.filter((item) => item.status === 'invalid' || item.status === 'rejected' || item.status === 'uncertain').length }}
                        con errores o resultado a revisar
                    </p>
                </div>
                <div class="flex flex-col gap-2 sm:flex-row">
                    <button
                        v-if="rejectedItems.length"
                        type="button"
                        class="min-h-11 rounded-md border border-[#103A5C] bg-white px-4 py-2 text-sm font-semibold text-[#103A5C] hover:bg-slate-50 disabled:opacity-50"
                        :disabled="isImporting"
                        @click="importProducts(true)"
                    >
                        Reintentar filas rechazadas ({{ rejectedItems.length }})
                    </button>
                    <button
                        type="button"
                        class="min-h-11 rounded-md bg-[#103A5C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#145A8D] disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="!canImport"
                        @click="importProducts()"
                    >
                        {{ isImporting ? 'Importando…' : `Confirmar importación (${readyItems.length})` }}
                    </button>
                </div>
            </div>

            <div v-if="isImporting || completedCount" class="flex flex-col gap-2">
                <div class="flex justify-between text-sm text-slate-700">
                    <span role="status">
                        {{ isImporting ? 'Procesando productos…' : 'Proceso de importación finalizado o detenido.' }}
                    </span>
                    <span>{{ completedCount }} de {{ importableCount }}</span>
                </div>
                <progress
                    class="h-3 w-full accent-[#145A8D]"
                    :value="progressPercent"
                    max="100"
                    aria-label="Progreso de importación"
                />
            </div>

            <div
                v-if="createdCount || invalidItems.length || rejectedItems.length || uncertainItems.length"
                role="status"
                class="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800"
            >
                <p>
                    Creados: {{ createdCount }} · Errores de validación: {{ invalidItems.length }} ·
                    Rechazados: {{ rejectedItems.length }} ·
                    Resultado incierto: {{ uncertainItems.length }}
                </p>
                <p v-if="uncertainItems.length" class="mt-2 text-amber-800">
                    No reintentes estas filas sin revisar primero el catálogo: la respuesta del servidor no confirmó si se guardaron.
                </p>
                <div class="mt-3 flex flex-wrap gap-3">
                    <button
                        v-if="items.some((item) => item.status === 'invalid' || item.status === 'rejected' || item.status === 'uncertain')"
                        type="button"
                        class="min-h-11 rounded-md border border-slate-400 bg-white px-4 py-2 font-semibold hover:bg-slate-100"
                        @click="downloadErrorReport"
                    >
                        Descargar reporte de errores
                    </button>
                    <button
                        type="button"
                        class="min-h-11 rounded-md border border-slate-400 bg-white px-4 py-2 font-semibold hover:bg-slate-100 disabled:opacity-50"
                        :disabled="isImporting"
                        @click="fileInput?.click()"
                    >
                        Seleccionar otra planilla
                    </button>
                </div>
            </div>

            <div class="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table class="w-full min-w-[760px] border-collapse text-left text-sm">
                    <caption class="sr-only">Detalle de validación y resultado de cada fila</caption>
                    <thead class="bg-slate-100 text-[#0B2438]">
                        <tr>
                            <th scope="col" class="p-3">Fila</th>
                            <th scope="col" class="p-3">Código</th>
                            <th scope="col" class="p-3">Producto</th>
                            <th scope="col" class="p-3">Categoría</th>
                            <th scope="col" class="p-3">Precio</th>
                            <th scope="col" class="p-3">Stock</th>
                            <th scope="col" class="p-3">Estado y detalle</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="item in items"
                            :key="item.line"
                            class="border-t border-slate-200 align-top"
                        >
                            <td class="p-3">{{ item.line }}</td>
                            <td class="p-3 font-mono">{{ item.codigo || '—' }}</td>
                            <td class="p-3">{{ item.nombre || '—' }}</td>
                            <td class="p-3">
                                {{
                                    item.payload
                                        ? categoryNames.get(item.payload.id_categoria)
                                        : item.categoryId || '—'
                                }}
                            </td>
                            <td class="p-3">{{ item.price || '—' }}</td>
                            <td class="p-3">{{ item.stock || '—' }}</td>
                            <td class="max-w-sm p-3">
                                <span class="font-semibold">
                                    {{
                                        item.status === 'ready' ? 'Lista' :
                                        item.status === 'invalid' ? 'Error de validación' :
                                        item.status === 'creating' ? 'Importando…' :
                                        item.status === 'created' ? 'Creado' :
                                        item.status === 'uncertain' ? 'Resultado incierto' :
                                        'Rechazado'
                                    }}
                                </span>
                                <ul v-if="item.errors.length" class="mt-1 list-disc pl-5 text-red-700">
                                    <li v-for="error in item.errors" :key="error">{{ error }}</li>
                                </ul>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>
    </section>
</template>
