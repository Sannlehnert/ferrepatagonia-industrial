<script setup lang="ts">
import axios from 'axios'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
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
    parseProductImportXlsx,
    parseProductImportCsv,
    readProductImportRecovery,
    saveProductImportRecovery,
    PRODUCT_IMPORT_MAX_FILE_SIZE,
    PRODUCT_IMPORT_PREVIEW_ROWS,
    PRODUCT_IMPORT_REQUEST_TIMEOUT_MS,
    type ProductImportItem,
} from '@/services/adminProductImport'

const categories = ref<CategoryOption[]>([])
const products = ref<AdminProduct[]>([])
const items = ref<ProductImportItem[]>([])
const selectedFileName = ref('')
const referenceError = ref('')
const fileError = ref('')
const recoveryError = ref('')
const isRecovered = ref(false)
const previewPage = ref(0)
const isLoadingReferences = ref(true)
const isImporting = ref(false)
const isDragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const readyItems = computed(() => items.value.filter((item) => item.status === 'ready'))
const previewPageCount = computed(
    () => Math.ceil(items.value.length / PRODUCT_IMPORT_PREVIEW_ROWS),
)
const visibleItems = computed(() =>
    items.value.slice(
        previewPage.value * PRODUCT_IMPORT_PREVIEW_ROWS,
        (previewPage.value + 1) * PRODUCT_IMPORT_PREVIEW_ROWS,
    ),
)
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
        !recoveryError.value &&
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
let activeImportController: AbortController | null = null
let isUnmounting = false

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

function persistRecovery(): boolean {
    try {
        saveProductImportRecovery(window.sessionStorage, {
            fileName: selectedFileName.value,
            items: items.value,
        })
        recoveryError.value = ''
        return true
    } catch (error: unknown) {
        recoveryError.value = errorMessage(
            error,
            'No se pudo guardar el estado recuperable de la importación.',
        )
        return false
    }
}

function restoreRecovery() {
    try {
        const recovery = readProductImportRecovery(window.sessionStorage)
        if (!recovery) return
        selectedFileName.value = recovery.fileName
        items.value = recovery.items
        previewPage.value = 0
        isRecovered.value = true
        if (recovery.items.some((item) => item.status === 'uncertain')) {
            persistRecovery()
        }
    } catch (error: unknown) {
        recoveryError.value = errorMessage(
            error,
            'No se pudo recuperar el estado de la importación anterior.',
        )
    }
}

async function selectFile(file: File | undefined) {
    if (isImporting.value) return
    const generation = ++fileSelectionGeneration
    fileError.value = ''
    if (!file) return

    const extension = file.name.toLowerCase().split('.').pop()
    if (extension !== 'csv' && extension !== 'xlsx') {
        fileError.value = 'Seleccioná un archivo CSV o XLSX.'
        return
    }
    if (file.size > PRODUCT_IMPORT_MAX_FILE_SIZE) {
        fileError.value = 'El archivo supera el límite de 5 MB.'
        return
    }

    try {
        await loadReferences()
        if (generation !== fileSelectionGeneration) return
        if (referenceError.value) {
            fileError.value = 'No se pudieron cargar las referencias. Reintentá la carga antes de validar.'
            return
        }
        const parsedItems =
            extension === 'xlsx'
                ? await parseProductImportXlsx(file, categories.value)
                : parseProductImportCsv(await file.text(), categories.value)
        if (generation !== fileSelectionGeneration) return
        saveProductImportRecovery(window.sessionStorage, {
            fileName: file.name,
            items: parsedItems,
        })
        items.value = parsedItems
        selectedFileName.value = file.name
        previewPage.value = 0
        isRecovered.value = false
        recoveryError.value = ''
    } catch (error: unknown) {
        if (generation !== fileSelectionGeneration) return
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
    if (
        isImporting.value ||
        isLoadingReferences.value ||
        referenceError.value ||
        recoveryError.value
    ) return
    const targets = items.value.filter((item) =>
        retryRejected ? item.status === 'rejected' : item.status === 'ready',
    )
    if (targets.length === 0) return

    if (!persistRecovery()) return
    isImporting.value = true
    const controller = new AbortController()
    activeImportController = controller
    try {
        for (const item of targets) {
            if (!item.payload) continue
            item.status = 'creating'
            item.errors = []
            if (!persistRecovery()) {
                item.status = 'ready'
                break
            }

            let shouldStop = false
            try {
                await saveAdminProduct(item.payload, undefined, {
                    signal: controller.signal,
                    timeout: PRODUCT_IMPORT_REQUEST_TIMEOUT_MS,
                })
                if (isUnmounting || controller.signal.aborted) {
                    item.status = 'uncertain'
                    item.errors = [
                        'La pantalla se cerró antes de confirmar el resultado. Revisá el catálogo antes de reintentar.',
                    ]
                    break
                }
                item.status = 'created'
            } catch (error: unknown) {
                if (isUnmounting) break
                item.errors = [
                    errorMessage(error, 'No se pudo confirmar la creación del producto.'),
                ]
                if (isDefinitiveRejection(error)) {
                    item.status = 'rejected'
                    const status = axios.isAxiosError(error)
                        ? error.response?.status
                        : undefined
                    shouldStop = status === 401 || status === 403 || status === 429
                } else {
                    item.status = 'uncertain'
                    item.errors.push(
                        'El resultado puede haberse guardado. Revisá el catálogo antes de reintentar.',
                    )
                    shouldStop = true
                }
            }
            if (!persistRecovery()) break
            if (shouldStop) break
        }
    } finally {
        isImporting.value = false
        activeImportController = null
        if (!isUnmounting) await loadReferences()
    }
}

function recoverInterruptedImport() {
    isUnmounting = true
    if (!activeImportController) return
    activeImportController.abort()
    const inFlightItem = items.value.find((item) => item.status === 'creating')
    if (inFlightItem) {
        inFlightItem.status = 'uncertain'
        inFlightItem.errors = [
            'La pantalla se cerró mientras la solicitud estaba pendiente. Revisá el catálogo antes de reintentar.',
        ]
    }
    if (!persistRecovery()) {
        console.error('No se pudo guardar la importación interrumpida.', recoveryError.value)
    }
}

onMounted(() => {
    restoreRecovery()
    void loadReferences()
})
onBeforeUnmount(recoverInterruptedImport)
</script>

<template>
    <section class="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
                <h1 class="text-2xl font-bold text-[#0B2438]">Importar productos</h1>
                <p class="mt-1 text-sm text-slate-600">
                    Cargá una planilla CSV o XLSX, revisá cada fila y confirmá la importación.
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
                decimales. Se procesa la primera hoja XLSX y los SKU deben estar almacenados como
                texto para conservar ceros iniciales. La unicidad de los SKU se confirma en el servidor.
            </p>
            <p class="mt-2 text-sm text-slate-600">
                Categorías activas:
                <span v-if="isLoadingReferences">cargando…</span>
                <span v-else-if="categories.length">
                    {{ categories.map((category) => `${category.id_categoria}: ${category.nombre}`).join(' · ') }}
                </span>
                <span v-else>no hay categorías activas disponibles.</span>
            </p>
            <p class="mt-2 text-sm text-slate-600">
                Productos del catálogo consultados: {{ products.length }}.
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

        <div
            v-if="recoveryError"
            role="alert"
            class="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
            {{ recoveryError }} No se iniciarán altas hasta poder guardar el estado recuperable.
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
                    Arrastrá tu archivo CSV o XLSX acá o seleccionalo desde tu dispositivo.
                </p>
                <label
                    for="product-import-file"
                    class="mt-3 inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-[#103A5C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#145A8D] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#145A8D]"
                >
                    Elegir archivo CSV o XLSX
                    <input
                        id="product-import-file"
                        ref="fileInput"
                        type="file"
                        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        class="sr-only"
                        :disabled="isLoadingReferences || Boolean(referenceError) || isImporting"
                        @change="handleFileChange"
                    >
                </label>
                <p v-if="selectedFileName" class="mt-3 text-sm font-medium text-slate-700">
                    Archivo: {{ selectedFileName }}
                </p>
                <p v-if="isRecovered" class="mt-2 text-sm text-amber-800" role="status">
                    Se recuperó el estado guardado de esta importación.
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
                    <p v-if="items.length > visibleItems.length" class="text-sm text-slate-600">
                        Mostrando filas {{ previewPage * PRODUCT_IMPORT_PREVIEW_ROWS + 1 }}–{{ Math.min((previewPage + 1) * PRODUCT_IMPORT_PREVIEW_ROWS, items.length) }} de {{ items.length }}.
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
                <table class="w-full min-w-[1280px] border-collapse text-left text-sm">
                    <caption class="sr-only">Detalle de validación y resultado de cada fila</caption>
                    <thead class="bg-slate-100 text-[#0B2438]">
                        <tr>
                            <th scope="col" class="p-3">Fila</th>
                            <th scope="col" class="p-3">Código</th>
                            <th scope="col" class="p-3">Producto</th>
                            <th scope="col" class="p-3">Categoría</th>
                            <th scope="col" class="p-3">Precio</th>
                            <th scope="col" class="p-3">Stock</th>
                            <th scope="col" class="p-3">Descripción</th>
                            <th scope="col" class="p-3">Imagen (URL)</th>
                            <th scope="col" class="p-3">Estado activo</th>
                            <th scope="col" class="p-3">Estado y detalle</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="item in visibleItems"
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
                            <td class="max-w-xs p-3">
                                <span class="block max-h-24 overflow-auto whitespace-pre-wrap break-words">
                                    {{ item.description || '—' }}
                                </span>
                            </td>
                            <td class="max-w-xs p-3">
                                <span class="block max-h-24 overflow-auto break-all">
                                    {{ item.image || '—' }}
                                </span>
                            </td>
                            <td class="p-3">
                                {{
                                    item.payload
                                        ? (item.payload.activo ? 'Activo' : 'Inactivo')
                                        : item.active || '—'
                                }}
                            </td>
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
            <nav
                v-if="previewPageCount > 1"
                class="flex items-center justify-between gap-3"
                aria-label="Páginas de la previsualización"
            >
                <button
                    type="button"
                    class="min-h-11 rounded-md border border-slate-400 bg-white px-4 py-2 font-semibold hover:bg-slate-100 disabled:opacity-50"
                    :disabled="previewPage === 0"
                    @click="previewPage -= 1"
                >
                    Anterior
                </button>
                <span class="text-sm text-slate-600">
                    Página {{ previewPage + 1 }} de {{ previewPageCount }}
                </span>
                <button
                    type="button"
                    class="min-h-11 rounded-md border border-slate-400 bg-white px-4 py-2 font-semibold hover:bg-slate-100 disabled:opacity-50"
                    :disabled="previewPage + 1 >= previewPageCount"
                    @click="previewPage += 1"
                >
                    Siguiente
                </button>
            </nav>
        </section>
    </section>
</template>
