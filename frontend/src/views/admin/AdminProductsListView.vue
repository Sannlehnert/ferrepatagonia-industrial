<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import ProductFormModal from './ProductFormModal.vue';

// Variable de entorno para la URL de la API
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// Estado del componente
const productos = ref<any[]>([]);
const searchQuery = ref('');
const isLoading = ref(true);

// Estado del Modal (Alta y Edición)
const isModalOpen = ref(false);
const selectedProduct = ref<any | null>(null);

// Obtener productos consumiendo el endpoint backend
const fetchProductos = async () => {
    try {
        isLoading.value = true;
        const res = await fetch(`${API_URL}/admin/productos`, {
            method: 'GET',
            credentials: 'include' // Obligatorio para enviar la cookie JWT
        });

        if (res.ok) {
            productos.value = await res.json();
        } else {
            console.error('Error de permisos o autenticación al cargar productos');
        }
    } catch (error) {
        console.error('Error de red al cargar productos:', error);
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
    try {
        if (prod.activo) {
            // PATCH para desactivar
            const res = await fetch(`${API_URL}/admin/productos/${prod.id_producto}/desactivar`, {
                method: 'PATCH',
                credentials: 'include'
            });
            if (res.ok) await fetchProductos();
        } else {
            // PUT parcial para activar
            // Enviamos SOLO el campo que queremos cambiar para no disparar validaciones de otros campos
            const payload = { activo: true };
            
            const res = await fetch(`${API_URL}/admin/productos/${prod.id_producto}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            
            if (res.ok) {
                await fetchProductos();
            } else {
                const err = await res.json().catch(() => ({}));
                console.error('El backend rechazó la reactivación:', err.message || res.status);
            }
        }
    } catch (error) {
        console.error('Error de red al cambiar el estado del producto:', error);
    }
};

onMounted(() => {
    fetchProductos();
});
</script>

<template>
    <div class="p-8 max-w-7xl mx-auto flex flex-col h-full w-full bg-[#F1F5F9]">
        <!-- Barra Superior Sticky -->
        <div class="flex justify-between items-center mb-6 sticky top-0 bg-[#F1F5F9] py-4 z-10">
            <h2 class="text-2xl font-bold text-[#0B2438]">Catálogo de Productos</h2>
            <input 
                v-model="searchQuery" 
                type="text" 
                placeholder="Buscar por Nombre o SKU..." 
                class="w-72 bg-white border border-[#E2E8F0] rounded-md px-4 py-2 text-sm text-[#0B2438] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#103A5C] shadow-sm"
            >
        </div>

        <!-- Estado de Carga -->
        <div v-if="isLoading" class="flex-1 flex justify-center items-center text-[#64748B]">
            <svg class="animate-spin h-8 w-8 text-[#103A5C] mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            Cargando catálogo corporativo...
        </div>
        <!-- Estado Vacío -->
        <div v-else-if="productosFiltrados.length === 0" class="flex-1 flex flex-col justify-center items-center text-[#64748B]">
            <svg class="w-16 h-16 mb-4 text-[#94A3B8]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path></svg>
            <p class="text-lg font-semibold">No se encontraron productos.</p>
        </div>
        <!-- Grilla de Productos -->
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 flex-1 overflow-y-auto pb-24">
            <div 
                v-for="prod in productosFiltrados" 
                :key="prod.id_producto" 
                class="bg-white border border-[#E2E8F0] rounded-lg shadow-sm overflow-hidden flex flex-col relative group transition-all hover:shadow-md"
                :class="{'opacity-75 grayscale-[30%]': !prod.activo}"
            >
                <!-- Imagen Placeholder y Badge de Estado -->
                <div class="h-40 bg-[#F8FAFC] flex items-center justify-center text-[#94A3B8] relative border-b border-[#E2E8F0]">
                    <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                
                    <span 
                        v-if="prod.activo" 
                        class="absolute top-2 left-2 bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider border border-emerald-200">
                        Activo</span>
                    <span v-else class="absolute top-2 left-2 bg-slate-100 text-[#64748B] text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider border border-[#E2E8F0]">
                        Inactivo</span>
                </div>
            
                <!-- Info del Producto -->
                <div class="p-4 flex-1 flex flex-col">
                    <span class="text-xs text-[#64748B] font-mono mb-1">{{ prod.codigo }}</span>
                    <h3 class="font-bold text-[#0B2438] text-sm leading-tight mb-3 flex-1 line-clamp-2" :title="prod.nombre">
                        {{ prod.nombre }}
                    </h3>
                    <div class="flex justify-between items-end pt-3 mt-auto border-t border-[#E2E8F0]">
                        <div class="flex flex-col">
                            <span class="text-[10px] text-[#94A3B8] uppercase font-semibold">Stock Disp.</span>
                            <span class="text-sm font-bold" :class="prod.stock > 10 ? 'text-[#0B2438]' : 'text-amber-500'">
                                {{ prod.stock }} un.
                            </span>
                        </div>
                        <div class="flex flex-col items-end">
                            <span class="text-[10px] text-[#94A3B8] uppercase font-semibold">Precio Base (USD)</span>
                            <span class="font-bold text-[#103A5C] text-lg">USD ${{ formatPrice(prod.precio) }}</span>
                        </div>
                    </div>
                </div>
            
                <!-- Acciones Hover -->
                <div class="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                        @click="openEditModal(prod)" 
                        class="p-1.5 bg-white text-[#64748B] hover:text-[#103A5C] border border-[#E2E8F0] rounded-md shadow-sm flex items-center justify-center transition-colors"
                        title="Editar Producto">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                    </button>
                    <button 
                        @click.stop.prevent="toggleStatus(prod)" 
                        class="p-1.5 bg-white border border-[#E2E8F0] rounded-md shadow-sm flex items-center justify-center transition-colors"
                        :class="prod.activo ? 'text-[#64748B] hover:text-amber-600' : 'text-amber-600 hover:text-emerald-600'"
                        :title="prod.activo ? 'Desactivar' : 'Activar'">

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
            </div>
        </div>

        <!-- Barra Inferior Sticky -->
        <div class="sticky bottom-0 bg-[#F1F5F9] border-t border-[#E2E8F0] py-4 flex justify-between items-center z-10">
            <div class="text-sm text-[#64748B] font-medium">
                Mostrando {{ productosFiltrados.length }} productos
            </div>
            <button @click="openCreateModal" class="bg-[#103A5C] text-white font-semibold py-2.5 px-6 rounded-md hover:bg-[#145A8D] transition-colors shadow-md">
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