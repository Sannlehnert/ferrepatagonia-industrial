<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import ProductFormModal from './ProductFormModal.vue';

// Variable de entorno para la URL de la API
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// Estado del componente
const productos = ref<any[]>([]);
const searchQuery = ref('');
const isLoading = ref(true);
const loadError = ref('');
const actionError = ref('');
const actionSuccess = ref('');
const processingId = ref<number | null>(null);

const actionsDisabled = computed(
    () => isLoading.value || processingId.value !== null
);

// Estado del Modal (Alta y Edición)
const isModalOpen = ref(false);
const selectedProduct = ref<any | null>(null);

// Obtener productos consumiendo el endpoint backend
const fetchProductos = async () => {
    isLoading.value = true;
    loadError.value = '';

    try {
        const res = await fetch(`${API_URL}/admin/productos`, {
            method: 'GET',
            credentials: 'include'
        });

        if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error(
                data?.message || 'No se pudo cargar el listado de productos.'
            );
        }

        productos.value = await res.json();
        actionError.value = '';
    } catch (error) {
        loadError.value = error instanceof TypeError
            ? 'No se pudo conectar con el servidor. Intentá nuevamente.'
            : error instanceof Error
                ? error.message
                : 'No se pudo cargar el listado de productos.';
    } finally {
        isLoading.value = false;
    }
};

// Filtro local rápido por Nombre o Código SKU
const productosFiltrados = computed(() => {
    if (!searchQuery.value) return productos.value;
    const query = searchQuery.value.toLowerCase();
    return productos.value.filter(p => p.nombre.toLowerCase().includes(query) || p.codigo.toLowerCase().includes(query));
});

// Categorías disponibles extraídas del catálogo actual
const categoriasDisponibles = computed(() => {
    const map = new Map<number, string>();
    for (const p of productos.value) {
        if (p.id_categoria && p.categoria_nombre) {
            map.set(Number(p.id_categoria), p.categoria_nombre);
        }
    }
    return Array.from(map.entries()).map(([id_categoria, nombre]) => ({ id_categoria, nombre }));
});

// Formateador de dólares
const formatPrice = (value: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

// Apertura del modal para Creación y Edición
const openCreateModal = () => {
    selectedProduct.value = null;
    isModalOpen.value = true;
};

const openEditModal = (prod: any) => {
    selectedProduct.value = { ...prod };
    isModalOpen.value = true;
};

const closeModal = () => {
    isModalOpen.value = false;
    selectedProduct.value = null;
};

// Activación y desactivación rápida desde la grilla
const toggleStatus = async (prod: any) => {
    if (actionsDisabled.value) return;

    const deactivate = Boolean(prod.activo);

    if (
        deactivate &&
        !window.confirm(
            `¿Desactivar "${prod.nombre}" (${prod.codigo})?\n` +
            'Dejará de estar disponible en el catálogo público.'
        )
    ) {
        return;
    }

    processingId.value = prod.id_producto;
    actionError.value = '';
    actionSuccess.value = '';

    try {
        const url = `${API_URL}/admin/productos/${prod.id_producto}`;

        const res = await fetch(
            deactivate ? `${url}/desactivar` : url,
            deactivate
                ? {
                    method: 'PATCH',
                    credentials: 'include'
                }
                : {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ activo: true })
                }
        );

        const data = await res.json().catch(() => null);

        if (!res.ok) {
            actionError.value = data?.message ||
                'No se pudo cambiar el estado del producto.';
            return;
        }

        actionSuccess.value = deactivate
            ? `"${prod.nombre}" se desactivó correctamente.`
            : `"${prod.nombre}" se activó correctamente.`;

        await fetchProductos();
    } catch {
        actionError.value =
            'No se pudo confirmar el resultado por un problema de conexión. ' +
            'Recargá el listado antes de volver a intentarlo.';
    } finally {
        processingId.value = null;
    }
};

onMounted(() => {
    fetchProductos();
});
</script>

<template>
    <div class="p-4 md:p-8 max-w-7xl mx-auto flex flex-col min-w-0 w-full bg-[#F1F5F9]">
        <!-- Barra Superior Sticky -->
        <div class="flex flex-col gap-3 md:flex-row md:justify-between md:items-center mb-6 sticky top-0 bg-[#F1F5F9] py-4 z-20">
            <h2 class="text-2xl font-bold text-[#0B2438]">Catálogo de Productos</h2>
            <input 
                v-model="searchQuery" 
                type="text" 
                placeholder="Buscar por Nombre o SKU..." 
                aria-label="Buscar productos por nombre o SKU"
                class="w-full min-w-0 md:w-72 md:shrink-0 bg-white border border-[#E2E8F0] rounded-md px-4 py-2 text-sm text-[#0B2438] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#103A5C] shadow-sm "
            >
        </div>

        <p
            v-if="processingId !== null"
            role="status"
            class="mb-4 text-sm text-[#103A5C]"
        >
            Actualizando estado del producto...
        </p>

        <p
            v-if="actionSuccess"
            role="status"
            class="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-800"
        >
            {{ actionSuccess }}
        </p>

        <div
            v-if="actionError"
            role="alert"
            class="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-red-700"
        >
            <p>{{ actionError }}</p>
            <button
                type="button"
                :disabled="actionsDisabled"
                class="mt-2 min-h-11 underline disabled:opacity-50"
                @click="fetchProductos"
            >
                Recargar listado
            </button>
        </div>

        <!-- Estado de Carga -->
        <div v-if="isLoading" class="flex-1 flex justify-center items-center text-[#64748B]">
            <svg class="animate-spin h-8 w-8 text-[#103A5C] mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            Cargando catálogo corporativo...
        </div>
        <div
            v-else-if="loadError"
            role="alert"
            class="rounded-md border border-red-200 bg-red-50 p-4 text-red-700"
        >
            <p>No se pudo actualizar el listado: {{ loadError }}</p>
            <button
                type="button"
                :disabled="actionsDisabled"
                class="mt-2 min-h-11 underline disabled:opacity-50"
                @click="fetchProductos"
            >
                Reintentar
            </button>
        </div>
        <!-- Estado Vacío -->
        <div v-else-if="productosFiltrados.length === 0" class="flex-1 flex flex-col justify-center items-center text-[#64748B]">
            <svg class="w-16 h-16 mb-4 text-[#94A3B8]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path></svg>
            <p class="text-lg font-semibold">No se encontraron productos.</p>
        </div>
        <!-- Grilla de Productos -->
        <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-6 content-start items-stretch pb-6">
            <div 
                v-for="prod in productosFiltrados" 
                :key="prod.id_producto" 
                class="w-full max-w-[21rem] justify-self-center bg-white border border-[#E2E8F0] rounded-lg shadow-sm overflow-hidden flex flex-col relative group transition-all hover:shadow-md"
                :class="{'opacity-75 grayscale-[30%]': !prod.activo}"
            >
                <!-- Acciones siempre visibles -->
                <div class="absolute top-2 right-2 z-10 flex gap-1">
                    <button
                        type="button"
                        @click="openEditModal(prod)"
                        :disabled="actionsDisabled"
                        :aria-label="`Editar ${prod.nombre}`"
                        title="Editar Producto"
                        class="min-h-11 min-w-11 [@media(pointer:fine)]:min-h-8 [@media(pointer:fine)]:min-w-8 p-1.5 bg-white text-[#64748B] hover:text-[#103A5C] border border-[#E2E8F0] rounded-md shadow-sm flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                    </button>
                    <button
                        type="button"
                        @click.stop.prevent="toggleStatus(prod)"
                        :disabled="actionsDisabled"
                        :aria-label="`${prod.activo ? 'Desactivar' : 'Activar'} ${prod.nombre}`"
                        :title="prod.activo ? 'Desactivar' : 'Activar'"
                        :class="prod.activo ? 'text-[#64748B] hover:text-amber-600' : 'text-amber-600 hover:text-emerald-600'"
                        class="min-h-11 min-w-11 [@media(pointer:fine)]:min-h-8 [@media(pointer:fine)]:min-w-8 p-1.5 bg-white border border-[#E2E8F0] rounded-md shadow-sm flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                        <!-- Ícono Desactivar (Ban/Block) -->
                        <svg v-if="prod.activo" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"></path>
                        </svg>

                        <!-- Ícono Reactivar (Check Circle) -->
                        <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                    </button>
                </div>
                <!-- Imagen Placeholder y Badge de Estado -->
                <div class="h-32 bg-[#F8FAFC] flex items-center justify-center text-[#94A3B8] relative border-b border-[#E2E8F0]">
                    <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                
                    <span 
                        v-if="prod.activo" 
                        class="absolute top-2 left-2 bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider border border-emerald-200">
                        Activo</span>
                    <span v-else class="absolute top-2 left-2 bg-slate-100 text-[#64748B] text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider border border-[#E2E8F0]">
                        Inactivo</span>
                </div>
            
                <!-- Info del Producto -->
                <div class="p-3 flex flex-1 flex-col min-w-0">
                    <span
                        class="block truncate text-[10px] text-[#64748B] font-mono mb-1"
                        :title="prod.codigo"
                    >
                        {{ prod.codigo }}
                    </span>

                    <h3
                        class="font-bold text-[#0B2438] text-sm leading-5 min-h-10 mb-3 line-clamp-2"
                        :title="prod.nombre"
                    >
                        {{ prod.nombre }}
                    </h3>

                    <div class="grid grid-cols-[auto_minmax(0,1fr)] gap-2 items-end pt-3 mt-auto border-t border-[#E2E8F0]">
                        <div class="flex flex-col">
                            <span class="text-[10px] text-[#64748B] uppercase font-semibold">
                                Stock
                            </span>
                            <span
                                class="text-sm font-bold whitespace-nowrap"
                                :class="prod.stock > 10 ? 'text-[#0B2438]' : 'text-amber-600'"
                            >
                                {{ prod.stock }} un.
                            </span>
                        </div>

                        <div class="flex flex-col min-w-0 text-right">
                            <span class="text-[10px] text-[#64748B] uppercase font-semibold">
                                Precio USD
                            </span>
                            <span class="font-bold text-[#103A5C] text-sm break-words">
                                ${{ formatPrice(prod.precio) }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Barra Inferior Sticky -->
        <div class="bg-[#F1F5F9] border-t border-[#E2E8F0] py-4 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
            <div class="text-sm text-[#64748B] font-medium">
                Mostrando {{ productosFiltrados.length }} productos
            </div>
            <button
                type="button"
                @click="openCreateModal"
                :disabled="actionsDisabled"
                class="min-h-11 bg-[#103A5C] text-white font-semibold py-2.5 px-6 rounded-md hover:bg-[#145A8D] transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 w-full sm:w-auto whitespace-nowrap"
            >
                + Nuevo Producto
            </button>
        </div>

        <!-- Modal Reutilizable de Alta y Edición -->
        <ProductFormModal
            :is-open="isModalOpen"
            :product="selectedProduct"
            :categories="categoriasDisponibles"
            @close="closeModal"
            @saved="fetchProductos"
        />
    </div>
</template>