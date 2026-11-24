<script setup lang="ts">
import ProductThumbnail from '@/components/ProductThumbnail.vue';
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import ProductFormModal from './ProductFormModal.vue';
import {
    getAdminProductPage,
    setAdminProductActive,
    getActiveCategories,
    type AdminProduct,
    type AdminProductPage,
    type CategoryOption
} from '../../services/adminProductService';
import {
    buildProductsWorkbook,
    collectAdminProductsForExport,
    downloadProductsWorkbook,
    productsExportFilename,
} from '../../services/productExportService';

import { isMutationResultUncertain, adminMutationErrorMessage, uncertainMutationMessage } from '../../services/adminMutationError';

const router = useRouter();
const route = useRoute();

const result = ref<AdminProductPage | null>(null);
const categorias = ref<CategoryOption[]>([]);
const isLoadingCategories = ref(false);
const categoriesError = ref('');

const normalizeSearch = (search: unknown) => typeof search === 'string' && [...search].length <= 200
    && !/[\u0000-\u001f\u007f]/u.test(search) ? search.trim() : '';
const appliedSearch = computed(() => normalizeSearch(route.query.busqueda));
const requestedPage = computed(() => {
    const page = route.query.page;
    return typeof page === 'string' && /^[1-9][0-9]{0,6}$/.test(page)
        && Number(page) <= 1000000 ? Number(page) : 1;
});
const searchQuery = ref(appliedSearch.value);
const searchPending = computed(() => searchQuery.value.trim() !== appliedSearch.value);
const searchInput = ref<HTMLInputElement | null>(null);
const previousPageButton = ref<HTMLButtonElement | null>(null);
const nextPageButton = ref<HTMLButtonElement | null>(null);
const tableRegion = ref<HTMLElement | null>(null);
const reloadButton = ref<HTMLButtonElement | null>(null);
const isLoading = ref(true);
const loadError = ref('');
const isSessionExpired = ref(false);
const saveMessage = ref('');
const actionError = ref('');
const exportingProducts = ref(false);
const exportError = ref('');
const exportMessage = ref('');
let exportController: AbortController | undefined;
const processingId = ref<number | null>(null);
const needsReload = ref(false);
const actionsDisabled = computed(() => isLoading.value || processingId.value !== null || needsReload.value || Boolean(loadError.value));
const pagingUnavailable = computed(() => isLoading.value || searchPending.value
    || processingId.value !== null || Boolean(loadError.value));

const isModalOpen = ref(false);
const selectedProduct = ref<AdminProduct | null>(null);
let modalTrigger: HTMLElement | null = null;
let restoreModalFocus = false;

const restoreListFocus = () => {
    if (unmounted || isModalOpen.value || isLoading.value) return;
    const edit = selectedProduct.value && tableRegion.value?.querySelector<HTMLButtonElement>(
        `[data-product-edit="${selectedProduct.value.id_producto}"]`
    );
    const target = edit || (modalTrigger?.isConnected ? modalTrigger : searchInput.value);
    target?.focus({ preventScroll: true });
    restoreModalFocus = false;
};

const revealTableControl = (event: FocusEvent) => {
    const region = tableRegion.value;
    const control = event.target;
    if (!region || !(control instanceof HTMLButtonElement)) return;
    const bounds = region.getBoundingClientRect();
    const button = control.getBoundingClientRect();
    const padding = 6;
    if (button.left < bounds.left + padding) region.scrollLeft += button.left - bounds.left - padding;
    else if (button.right > bounds.right - padding) region.scrollLeft += button.right - bounds.right + padding;
};

let searchTimer: ReturnType<typeof setTimeout> | undefined;
let currentRequest: AbortController | undefined;
let listQuery: { page: number; search: string } | undefined;
let unmounted = false;

const listLocation = (page: number, search: string) => {
    const query = { ...route.query };
    delete query.page;
    delete query.busqueda;
    if (page !== 1) query.page = String(page);
    if (search) query.busqueda = search;
    return { query, hash: route.hash };
};

const changePage = (offset: number) => {
    if (pagingUnavailable.value || !result.value) return;
    void router.push(listLocation(result.value.page + offset, appliedSearch.value));
};

const scheduleSearch = () => {
    clearTimeout(searchTimer);
    if (searchPending.value) {
        searchTimer = setTimeout(() => {
            const search = normalizeSearch(searchQuery.value);
            searchQuery.value = search;
            if (search !== appliedSearch.value) void router.replace(listLocation(1, search));
        }, 300);
    }
};

const clearSearch = () => {
    clearTimeout(searchTimer);
    searchQuery.value = '';
    void router.replace(listLocation(1, ''));
};

const restorePagerFocus = async (page: AdminProductPage) => {
    const previous = previousPageButton.value;
    const next = nextPageButton.value;
    const focused = [previous, next].find(button => button?.matches(':focus'));
    if (!focused || (page.totalPages > 0
        && (focused === previous ? page.page > 1 : page.page < page.totalPages))) return;

    await nextTick();
    const { activeElement, body } = focused.ownerDocument;
    if (activeElement !== focused && activeElement !== body) return;
    const target = page.totalPages <= 1 ? searchInput.value : focused === previous ? next : previous;
    target?.focus();
};

const fetchProductos = async () => {
    if (unmounted) return;
    const restoreReloadFocus = reloadButton.value?.matches(':focus');
    currentRequest?.abort();
    const request = new AbortController();
    currentRequest = request;
    const page = requestedPage.value;
    const search = appliedSearch.value;
    listQuery = { page, search };
    isLoading.value = true;
    loadError.value = '';
    isSessionExpired.value = false;

    try {
        const response = await getAdminProductPage(page, search, request.signal);
        if (request.signal.aborted || requestedPage.value !== page || appliedSearch.value !== search) return;
        result.value = response;
        void restorePagerFocus(response);
        if (needsReload.value) isModalOpen.value = false;
        needsReload.value = false;
        actionError.value = '';
        if (response.page !== page) {
            listQuery = { page: response.page, search };
            void router.replace(listLocation(response.page, search));
        }
    } catch (error: unknown) {
        if (request.signal.aborted) return;
        if (axios.isAxiosError(error)) {
            if (error.response?.status === 401) {
                isSessionExpired.value = true;
            }
            loadError.value = error.response?.data?.message || error.response?.data?.error || error.message;
        } else if (error instanceof Error) {
            loadError.value = error.message;
        } else {
            loadError.value = 'No se pudo cargar el listado de productos.';
        }
    } finally {
        if (!request.signal.aborted) {
            isLoading.value = false;
            await nextTick();
            if (restoreModalFocus) restoreListFocus();
            else if (restoreReloadFocus && !isModalOpen.value) {
                (reloadButton.value ?? searchInput.value)?.focus({ preventScroll: true });
            }
        }
    }
};

const exportProducts = async () => {
    if (exportingProducts.value || isLoading.value || searchPending.value) return;
    exportController?.abort();
    const controller = new AbortController();
    exportController = controller;
    exportingProducts.value = true;
    exportError.value = '';
    exportMessage.value = '';
    try {
        const products = await collectAdminProductsForExport(appliedSearch.value, controller.signal);
        if (controller.signal.aborted) return;
        if (products.length === 0) {
            exportMessage.value = 'No hay productos para exportar con el filtro actual.';
            return;
        }
        downloadProductsWorkbook(
            buildProductsWorkbook(products),
            productsExportFilename(appliedSearch.value),
        );
        exportMessage.value = `Se exportaron ${products.length} productos${appliedSearch.value ? ' del filtro actual' : ''} en Excel.`;
    } catch (error: unknown) {
        if (controller.signal.aborted) return;
        exportError.value = error instanceof Error
            ? error.message
            : 'No se pudo exportar el catálogo. Intentá nuevamente.';
    } finally {
        if (!controller.signal.aborted) exportingProducts.value = false;
    }
};

const fetchCategorias = async () => {
    isLoadingCategories.value = true;
    categoriesError.value = '';

    try {
        categorias.value = await getActiveCategories();
    } catch (error: unknown) {
        if (axios.isAxiosError(error)) {
            categoriesError.value = error.response?.data?.message || error.response?.data?.error || error.message;
        } else if (error instanceof Error) {
            categoriesError.value = error.message;
        } else {
            categoriesError.value = 'No se pudieron cargar las categorías.';
        }
    } finally {
        isLoadingCategories.value = false;
    }
};

const formatPrice = (value: number | string | null | undefined): string => {
    if (value == null || String(value).trim() === '') return 'Sin importe';
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return 'Sin importe';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
};

const openCreateModal = () => {
    if (actionsDisabled.value || isModalOpen.value) return;
    modalTrigger = searchInput.value?.ownerDocument.activeElement as HTMLElement | null;
    saveMessage.value = '';
    selectedProduct.value = null;
    if (categorias.value.length === 0 && !isLoadingCategories.value) {
        fetchCategorias();
    }
    isModalOpen.value = true;
};

const openEditModal = (prod: AdminProduct) => {
    if (actionsDisabled.value || isModalOpen.value) return;
    modalTrigger = searchInput.value?.ownerDocument.activeElement as HTMLElement | null;
    saveMessage.value = '';
    selectedProduct.value = { ...prod };
    if (categorias.value.length === 0 && !isLoadingCategories.value) {
        fetchCategorias();
    }
    isModalOpen.value = true;
};

const handleSaved = async (msg: string) => {
    saveMessage.value = msg;
    needsReload.value = true;
    await fetchProductos();
};

const handleUncertain = () => {
    // A read started before this failure cannot confirm the write's outcome.
    currentRequest?.abort();
    isLoading.value = false;
    result.value = null;
    needsReload.value = true;
    actionError.value = uncertainMutationMessage;
};

const toggleStatus = async (prod: AdminProduct, event?: MouseEvent) => {
    if (actionsDisabled.value || isModalOpen.value) return;
    const deactivate = Boolean(prod.activo);
    if (deactivate && !window.confirm(
        `¿Desactivar "${prod.nombre}" (${prod.codigo})?\nDejará de estar disponible en el catálogo público.`
    )) return;
    const trigger = event?.currentTarget as HTMLButtonElement | undefined;
    const restoreFocus = trigger?.matches(':focus');
    processingId.value = prod.id_producto;
    actionError.value = '';
    saveMessage.value = '';
    try {
        await setAdminProductActive(prod.id_producto, !deactivate);
        needsReload.value = true;
        saveMessage.value = `"${prod.nombre}" se ${deactivate ? 'desactivó' : 'activó'} correctamente.`;
        await fetchProductos();
    } catch (error: unknown) {
        if (isMutationResultUncertain(error)) handleUncertain();
        else actionError.value = adminMutationErrorMessage(error);
    } finally {
        processingId.value = null;
        if (trigger && restoreFocus) {
            await nextTick();
            const { activeElement, body } = trigger.ownerDocument;
            if (!unmounted && (activeElement === body || activeElement === trigger)) {
                const statusButton = tableRegion.value?.querySelector<HTMLButtonElement>(
                    `[data-product-status="${prod.id_producto}"]`
                );
                (statusButton ?? reloadButton.value ?? searchInput.value)?.focus();
            }
        }
    }
};

watch([() => route.query.page, () => route.query.busqueda], ([rawPage, rawSearch]) => {
    const page = requestedPage.value;
    const search = appliedSearch.value;
    const location = listLocation(page, search);
    if (rawPage !== location.query.page || rawSearch !== location.query.busqueda) {
        void router.replace(location);
    }
    if (listQuery?.page !== page || listQuery.search !== search) {
        clearTimeout(searchTimer);
        searchQuery.value = search;
        void fetchProductos();
    }
}, { immediate: true });
watch(searchQuery, scheduleSearch);
watch(isModalOpen, async open => {
    if (open) return;
    restoreModalFocus = true;
    await nextTick();
    restoreListFocus();
});
onMounted(fetchCategorias);
onBeforeUnmount(() => {
    unmounted = true;
    clearTimeout(searchTimer);
    currentRequest?.abort();
    exportController?.abort();
});
</script>

<template>
    <div class="admin-products p-4 md:p-8 max-w-7xl mx-auto flex flex-col min-w-0 w-full bg-[#F1F5F9]">
        <!-- Barra Superior -->
        <div class="flex flex-col gap-3 md:flex-row md:justify-between md:items-center mb-6 bg-[#F1F5F9] py-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 class="text-2xl font-bold text-[#0B2438]">Catálogo de Productos</h2>
                <div class="flex flex-wrap items-center gap-2">
                    <RouterLink
                        :to="{ name: 'admin-product-import' }"
                        class="box-border flex min-h-11 items-center justify-center rounded-md border border-[#103A5C] bg-white px-4 py-2 text-sm font-semibold text-[#103A5C] no-underline hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                    >
                        Importar desde planilla
                    </RouterLink>
                    <button
                        type="button"
                        class="box-border flex min-h-11 items-center justify-center rounded-md border border-[#103A5C] bg-white px-4 py-2 text-sm font-semibold text-[#103A5C] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="exportingProducts || isLoading || searchPending"
                        @click="exportProducts"
                    >
                        {{ exportingProducts ? 'Exportando…' : 'Exportar a Excel' }}
                    </button>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <input
                    ref="searchInput"
                    v-model="searchQuery"
                    type="text"
                    maxlength="200"
                    placeholder="Buscar por Nombre o SKU..."
                    aria-label="Buscar productos por nombre o SKU"
                    class="box-border min-h-11 w-full min-w-0 md:w-72 bg-white border border-[#E2E8F0] rounded-md px-4 py-2 text-sm text-[#0B2438] placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-[#103A5C] shadow-sm"
                >
                <button
                    v-if="searchQuery || appliedSearch"
                    type="button"
                    class="min-h-11 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                    @click="clearSearch"
                >
                    Limpiar búsqueda
                </button>
            </div>
        </div>

        <p class="mb-4 mt-0 text-sm text-slate-600">
            La exportación incluye todos los productos que coinciden con la búsqueda activa, no solo la página visible.
        </p>

        <p
            v-if="saveMessage"
            role="status"
            class="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 wrap-anywhere"
        >
            {{ saveMessage }}
        </p>

        <p
            v-if="exportMessage"
            role="status"
            class="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 wrap-anywhere"
        >
            {{ exportMessage }}
        </p>
        <div
            v-if="exportError"
            role="alert"
            class="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 wrap-anywhere"
        >
            {{ exportError }}
        </div>

        <p v-if="processingId !== null" id="admin-products-lock" role="status" class="mb-4">Actualizando estado del producto. Las acciones están temporalmente deshabilitadas.</p>
        <div v-if="actionError || needsReload" role="alert" class="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
            <p class="wrap-anywhere">{{ actionError || 'Recargá el listado para confirmar los datos antes de modificar productos.' }}</p>
            <button ref="reloadButton" type="button" :disabled="isLoading || processingId !== null" class="min-h-11 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] disabled:opacity-50" @click="fetchProductos">Recargar listado</button>
        </div>

        <!-- Estado de Carga -->
        <div v-if="isLoading" role="status" class="flex-1 flex justify-center items-center py-12 text-slate-700">
            Cargando catálogo corporativo...
        </div>

        <!-- Estado de Error (500, red o sesión expirada 401) -->
        <div
            v-else-if="loadError"
            role="alert"
            class="rounded-md border border-red-200 bg-red-50 p-5 text-red-700 my-4"
        >
            <p class="font-semibold wrap-anywhere">{{ loadError }}</p>
            <div class="mt-3 flex gap-3">
                <button
                    v-if="isSessionExpired"
                    type="button"
                    class="box-border min-h-11 border-0 bg-[#103A5C] text-white text-sm font-semibold px-4 py-2 rounded-md hover:bg-[#145A8D] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                    @click="router.push('/login')"
                >
                    Iniciar sesión
                </button>
                <button
                    v-else
                    type="button"
                    class="box-border min-h-11 bg-white border border-red-300 text-red-700 text-sm font-semibold px-4 py-2 rounded-md hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                    @click="fetchProductos"
                >
                    Reintentar
                </button>
            </div>
        </div>

        <!-- Estado Vacío (Solo cuando la API respondió OK) -->
        <div v-else-if="result && !result.data.length" role="status" class="flex-1 flex flex-col justify-center items-center py-12 text-slate-700">
            <p class="text-lg font-semibold">No se encontraron productos.</p>
        </div>

        <template v-else-if="result && result.data.length">
            <p id="admin-products-scroll" class="mb-2 text-sm text-slate-700">
                Si no ves todas las columnas, desplazá la tabla hacia los lados. Con teclado, enfocá la tabla y usá las flechas.
            </p>
            <p id="admin-products-price" class="mb-3 text-sm text-slate-700">
                Los importes base son de uso interno. El listado no informa su verificación comercial.
            </p>
            <div
                ref="tableRegion"
                role="region"
                aria-label="Tabla desplazable de productos"
                aria-describedby="admin-products-scroll"
                tabindex="0"
                @focusin="revealTableControl"
                class="relative mb-6 w-full min-w-0 overflow-x-auto rounded-md border border-slate-300 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
            >
                <table class="w-full min-w-[48rem] border-collapse text-left text-sm text-[#0B2438]" aria-describedby="admin-products-price">
                    <caption class="sr-only">Productos del catálogo</caption>
                    <thead class="border-b border-slate-300 bg-slate-100">
                        <tr>
                            <th scope="col" class="px-3 py-3">Producto</th>
                            <th scope="col" class="px-3 py-3">SKU</th>
                            <th scope="col" class="px-3 py-3">Categoría</th>
                            <th scope="col" class="px-3 py-3 text-right">Stock</th>
                            <th scope="col" class="px-3 py-3 text-right">Precio base (USD)</th>
                            <th scope="col" class="px-3 py-3">Estado</th>
                            <th scope="col" class="px-3 py-3">Acciones</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200">
                        <tr v-for="prod in result.data" :key="prod.id_producto" class="even:bg-slate-50">
                            <th scope="row" class="px-3 py-2 font-semibold">
                                <div class="flex items-center gap-2">
                                    <ProductThumbnail :image="prod.imagen" alt="" image-class="size-10 shrink-0 rounded object-contain" />
                                    <span class="wrap-anywhere">{{ prod.nombre }}</span>
                                </div>
                            </th>
                            <td class="px-3 py-2 wrap-anywhere">
                                <span :id="`product-sku-${prod.id_producto}`"><span class="sr-only">SKU: </span>{{ prod.codigo }}</span>
                            </td>
                            <td class="px-3 py-2 wrap-anywhere">{{ prod.categoria_nombre || 'Sin categoría informada' }}</td>
                            <td class="px-3 py-2 text-right tabular-nums">{{ prod.stock }}</td>
                            <td class="px-3 py-2 whitespace-nowrap text-right tabular-nums">{{ formatPrice(prod.precio) }}</td>
                            <td class="px-3 py-2">
                                <span
                                    class="rounded-full px-2 py-1 font-semibold"
                                    :class="prod.activo ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-800'"
                                >{{ prod.activo ? 'Activo' : 'Inactivo' }}</span>
                            </td>
                            <td class="px-3 py-2">
                                <div class="flex gap-2">
                                    <button
                                        type="button"
                                        :disabled="actionsDisabled"
                                        :aria-label="`Editar ${prod.nombre}`"
                                        :data-product-edit="prod.id_producto"
                                        :aria-describedby="`product-sku-${prod.id_producto}${actionsDisabled ? ' admin-products-lock' : ''}`"
                                        class="min-h-11 whitespace-nowrap rounded-md border border-[#103A5C] bg-white px-3 font-semibold text-[#103A5C] enabled:hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] disabled:opacity-50"
                                        @click="openEditModal(prod)"
                                    >Editar</button>
                                    <button
                                        type="button"
                                        :disabled="actionsDisabled"
                                        :data-product-status="prod.id_producto"
                                        :aria-label="`${prod.activo ? 'Desactivar' : 'Activar'} ${prod.nombre}`"
                                        :aria-describedby="`product-sku-${prod.id_producto}${actionsDisabled ? ' admin-products-lock' : ''}`"
                                        class="min-h-11 whitespace-nowrap rounded-md border bg-white px-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] disabled:opacity-50"
                                        :class="prod.activo ? 'border-red-700 text-red-800 enabled:hover:bg-red-50' : 'border-emerald-700 text-emerald-800 enabled:hover:bg-emerald-50'"
                                        @click="toggleStatus(prod, $event)"
                                    >{{ prod.activo ? 'Desactivar' : 'Activar' }}</button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>

        <p class="text-sm text-slate-600">El importe base no es necesariamente el precio final del catálogo. Guardarlo no reemplaza la verificación.</p>

        <!-- Barra Inferior -->
        <div class="bg-[#F1F5F9] border-t border-[#E2E8F0] py-4 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
            <div v-if="result" class="text-sm text-slate-700 font-medium">
                <span v-if="!isLoading && !loadError">Mostrando {{ result.data.length }} de {{ result.total }} productos</span>
                <nav v-if="result.totalPages > 0" aria-label="Paginación de productos" :aria-busy="isLoading" class="flex flex-wrap items-center gap-3">
                    <button ref="previousPageButton" type="button" class="min-h-11 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] disabled:opacity-50 aria-disabled:opacity-50"
                        :disabled="result.page <= 1" :aria-disabled="pagingUnavailable || undefined"
                        @click="changePage(-1)">Anterior</button>
                    <span>Página {{ result.page }} de {{ result.totalPages }}</span>
                    <button ref="nextPageButton" type="button" class="min-h-11 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] disabled:opacity-50 aria-disabled:opacity-50"
                        :disabled="result.page >= result.totalPages" :aria-disabled="pagingUnavailable || undefined"
                        @click="changePage(1)">Siguiente</button>
                </nav>
            </div>
            <button
                type="button"
                @click="openCreateModal"
                :disabled="actionsDisabled"
                class="box-border min-h-11 border-0 bg-[#103A5C] text-white font-semibold py-2.5 px-6 rounded-md hover:bg-[#145A8D] transition-colors shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] disabled:opacity-50 w-full sm:w-auto"
            >
                + Nuevo Producto
            </button>
        </div>

        <ProductFormModal
            :is-open="isModalOpen"
            :product="selectedProduct"
            :categories="categorias"
            :mutation-blocked="needsReload"
            :is-reloading="isLoading"
            @uncertain="handleUncertain"
            @reload="fetchProductos"
            :is-loading-categories="isLoadingCategories"
            :categories-error="categoriesError"
            @retry-categories="fetchCategorias"
            @close="isModalOpen = false"
            @saved="handleSaved"
        />
    </div>
</template>