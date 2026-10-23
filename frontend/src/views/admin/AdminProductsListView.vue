<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import ProductFormModal from './ProductFormModal.vue';
import {
    getAdminProducts,
    getActiveCategories,
    type AdminProduct,
    type CategoryOption
} from '../../services/adminProductService';

const router = useRouter();

const productos = ref<AdminProduct[]>([]);
const categorias = ref<CategoryOption[]>([]);
const isLoadingCategories = ref(false);
const categoriesError = ref('');

const searchQuery = ref('');
const isLoading = ref(true);
const loadError = ref('');
const isSessionExpired = ref(false);
const saveMessage = ref('');

const isModalOpen = ref(false);
const selectedProduct = ref<AdminProduct | null>(null);

const fetchProductos = async () => {
    isLoading.value = true;
    loadError.value = '';
    isSessionExpired.value = false;

    try {
        productos.value = await getAdminProducts();
    } catch (error: unknown) {
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
        isLoading.value = false;
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

const productosFiltrados = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    if (!query) return productos.value;
    return productos.value.filter(
        (p) => p.nombre.toLowerCase().includes(query) || p.codigo.toLowerCase().includes(query)
    );
});

const formatPrice = (value: number) =>
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

const openCreateModal = () => {
    saveMessage.value = '';
    selectedProduct.value = null;
    if (categorias.value.length === 0 && !isLoadingCategories.value) {
        fetchCategorias();
    }
    isModalOpen.value = true;
};

const openEditModal = (prod: AdminProduct) => {
    saveMessage.value = '';
    selectedProduct.value = { ...prod };
    if (categorias.value.length === 0 && !isLoadingCategories.value) {
        fetchCategorias();
    }
    isModalOpen.value = true;
};

const handleSaved = async (msg: string) => {
    saveMessage.value = msg;
    await fetchProductos();
};

onMounted(() => {
    fetchProductos();
    fetchCategorias();
});
</script>

<template>
    <div class="p-4 md:p-8 max-w-7xl mx-auto flex flex-col min-w-0 w-full bg-[#F1F5F9]">
        <!-- Barra Superior -->
        <div class="flex flex-col gap-3 md:flex-row md:justify-between md:items-center mb-6 sticky top-0 bg-[#F1F5F9] py-4 z-20">
            <h2 class="text-2xl font-bold text-[#0B2438]">Catálogo de Productos</h2>
            <input
                v-model="searchQuery"
                type="text"
                placeholder="Buscar por Nombre o SKU..."
                aria-label="Buscar productos por nombre o SKU"
                class="w-full min-w-0 md:w-72 bg-white border border-[#E2E8F0] rounded-md px-4 py-2 text-sm text-[#0B2438] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#103A5C] shadow-sm"
            >
        </div>

        <p
            v-if="saveMessage"
            role="status"
            class="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
            {{ saveMessage }}
        </p>

        <!-- Estado de Carga -->
        <div v-if="isLoading" class="flex-1 flex justify-center items-center py-12 text-[#64748B]">
            Cargando catálogo corporativo...
        </div>

        <!-- Estado de Error (500, red o sesión expirada 401) -->
        <div
            v-else-if="loadError"
            role="alert"
            class="rounded-md border border-red-200 bg-red-50 p-5 text-red-700 my-4"
        >
            <p class="font-semibold">{{ loadError }}</p>
            <div class="mt-3 flex gap-3">
                <button
                    v-if="isSessionExpired"
                    type="button"
                    class="min-h-11 bg-[#103A5C] text-white text-sm font-semibold px-4 py-2 rounded-md hover:bg-[#145A8D]"
                    @click="router.push('/login')"
                >
                    Iniciar sesión
                </button>
                <button
                    v-else
                    type="button"
                    class="min-h-11 bg-white border border-red-300 text-red-700 text-sm font-semibold px-4 py-2 rounded-md hover:bg-red-100"
                    @click="fetchProductos"
                >
                    Reintentar
                </button>
            </div>
        </div>

        <!-- Estado Vacío (Solo cuando la API respondió OK) -->
        <div v-else-if="productosFiltrados.length === 0" class="flex-1 flex flex-col justify-center items-center py-12 text-[#64748B]">
            <p class="text-lg font-semibold">No se encontraron productos.</p>
        </div>

        <!-- Grilla de Productos -->
        <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-6 content-start items-stretch pb-6">
            <div
                v-for="prod in productosFiltrados"
                :key="prod.id_producto"
                class="w-full max-w-[21rem] justify-self-center bg-white border border-[#E2E8F0] rounded-lg shadow-sm overflow-hidden flex flex-col relative transition-all hover:shadow-md"
                :class="{ 'opacity-75 grayscale-[30%]': !prod.activo }"
            >
                <!-- Botón Editar siempre visible en móvil y desktop -->
                <div class="absolute top-2 right-2 z-10 flex gap-1">
                    <button
                        type="button"
                        @click="openEditModal(prod)"
                        :aria-label="`Editar ${prod.nombre}`"
                        title="Editar Producto"
                        class="min-h-11 min-w-11 [@media(pointer:fine)]:min-h-8 [@media(pointer:fine)]:min-w-8 p-1.5 bg-white text-[#64748B] hover:text-[#103A5C] border border-[#E2E8F0] rounded-md shadow-sm flex items-center justify-center transition-colors"
                    >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                    </button>
                </div>

                <!-- Imagen Placeholder y Estado -->
                <div class="h-32 bg-[#F8FAFC] flex items-center justify-center text-[#94A3B8] relative border-b border-[#E2E8F0]">
                    <span
                        class="absolute top-2 left-2 text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider border"
                        :class="prod.activo
                            ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-[#64748B] border-[#E2E8F0]'"
                    >
                        {{ prod.activo ? 'Activo' : 'Inactivo' }}
                    </span>
                </div>

                <!-- Datos del Producto -->
                <div class="p-3 flex flex-1 flex-col min-w-0">
                    <span class="block truncate text-[10px] text-[#64748B] font-mono mb-1" :title="prod.codigo">
                        {{ prod.codigo }}
                    </span>
                    <h3 class="font-bold text-[#0B2438] text-sm leading-5 min-h-10 mb-3 line-clamp-2" :title="prod.nombre">
                        {{ prod.nombre }}
                    </h3>

                    <div class="grid grid-cols-[auto_minmax(0,1fr)] gap-2 items-end pt-3 mt-auto border-t border-[#E2E8F0]">
                        <div class="flex flex-col">
                            <span class="text-[10px] text-[#64748B] uppercase font-semibold">Stock</span>
                            <span class="text-sm font-bold whitespace-nowrap" :class="prod.stock > 10 ? 'text-[#0B2438]' : 'text-amber-600'">
                                {{ prod.stock }} un.
                            </span>
                        </div>
                        <div class="flex flex-col min-w-0 text-right">
                            <span class="text-[10px] text-[#64748B] uppercase font-semibold">Precio USD</span>
                            <span class="font-bold text-[#103A5C] text-sm break-words">
                                ${{ formatPrice(prod.precio) }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Barra Inferior -->
        <div class="bg-[#F1F5F9] border-t border-[#E2E8F0] py-4 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
            <div class="text-sm text-[#64748B] font-medium">
                Mostrando {{ productosFiltrados.length }} productos
            </div>
            <button
                type="button"
                @click="openCreateModal"
                :disabled="isLoading"
                class="min-h-11 bg-[#103A5C] text-white font-semibold py-2.5 px-6 rounded-md hover:bg-[#145A8D] transition-colors shadow-md disabled:opacity-50 w-full sm:w-auto"
            >
                + Nuevo Producto
            </button>
        </div>

        <ProductFormModal
            :is-open="isModalOpen"
            :product="selectedProduct"
            :categories="categorias"
            :is-loading-categories="isLoadingCategories"
            :categories-error="categoriesError"
            @retry-categories="fetchCategorias"
            @close="isModalOpen = false"
            @saved="handleSaved"
        />
    </div>
</template>