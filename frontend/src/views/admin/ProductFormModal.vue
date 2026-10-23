<script setup lang="ts">
import { ref, computed, watch } from 'vue';

interface ProductData {
    id_producto?: number;
    id_categoria: number;
    codigo: string;
    nombre: string;
    descripcion?: string | null;
    precio: number;
    stock: number;
    imagen?: string | null;
    activo: boolean | number;
}

const props = defineProps<{
    isOpen: boolean;
    product: ProductData | null;
    categories?: Array<{ id_categoria: number; nombre: string }>;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'saved'): void;
}>();

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const isEditMode = computed(() => Boolean(props.product?.id_producto));
const isSubmitting = ref(false);
const backendError = ref('');

// Estado del formulario
const form = ref({
    nombre: '',
    codigo: '',
    id_categoria: 1 as number | string,
    precio: '' as number | string,
    stock: '' as number | string,
    descripcion: '',
    imagen: '',
    activo: true
});

// Errores de validación visibles por campo
const fieldErrors = ref<Record<string, string>>({});

// Sincronizar datos al abrir el modal en modo Alta o Edición
watch(
    () => [props.isOpen, props.product],
    ([isOpen]) => {
        if (!isOpen) return;
        backendError.value = '';
        fieldErrors.value = {};

        if (props.product) {
            form.value = {
                nombre: props.product.nombre ?? '',
                codigo: props.product.codigo ?? '',
                id_categoria: Number(props.product.id_categoria) || 1,
                precio: Number(props.product.precio ?? 0),
                stock: Number(props.product.stock ?? 0),
                descripcion: props.product.descripcion ?? '',
                imagen: props.product.imagen ?? '',
                activo: Boolean(props.product.activo)
            };
        } else {
            form.value = {
                nombre: '',
                codigo: '',
                id_categoria: props.categories?.[0]?.id_categoria ?? 1,
                precio: '',
                stock: '',
                descripcion: '',
                imagen: '',
                activo: true
            };
        }
    },
    { immediate: true }
);

// Validaciones locales alineadas con el backend
const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!form.value.nombre || form.value.nombre.trim() === '') {
        errors.nombre = 'El nombre del producto es obligatorio.';
    }

    if (!form.value.codigo || form.value.codigo.trim() === '') {
        errors.codigo = 'El código SKU es obligatorio.';
    }

    const catId = Number(form.value.id_categoria);
    if (!Number.isInteger(catId) || catId <= 0) {
        errors.id_categoria = 'Seleccioná una categoría válida (entero mayor a 0).';
    }

    const precioNum = Number(form.value.precio);
    if (form.value.precio === '' || form.value.precio === null || isNaN(precioNum) || precioNum < 0) {
        errors.precio = 'El precio debe ser un número mayor o igual a 0.';
    }

    const stockNum = Number(form.value.stock);
    if (
        form.value.stock === '' ||
        form.value.stock === null ||
        !Number.isInteger(stockNum) ||
        stockNum < 0 ||
        stockNum > 2147483647
    ) {
        errors.stock = 'El stock debe ser un número entero mayor o igual a 0 (sin decimales).';
    }

    fieldErrors.value = errors;
    return Object.keys(errors).length === 0;
};

// Alta, edición general y actualización exclusiva de stock.
const handleSubmit = async () => {
    if (isSubmitting.value) return;

    backendError.value = '';
    if (!validateForm()) return;

    const willDeactivate =
        isEditMode.value &&
        Boolean(props.product?.activo) &&
        !form.value.activo;

    if (
        willDeactivate &&
        !window.confirm(
            `¿Desactivar "${props.product!.nombre}" (${props.product!.codigo})?\n` +
            'Dejará de estar disponible en el catálogo público.'
        )
    ) {
        return;
    }

    isSubmitting.value = true;
    try {
        const payload = {
            nombre: form.value.nombre.trim(),
            codigo: form.value.codigo.trim(),
            id_categoria: Number(form.value.id_categoria),
            precio: Number(form.value.precio),
            stock: Number(form.value.stock),
            descripcion: form.value.descripcion.trim() || null,
            imagen: form.value.imagen.trim() || null,
            activo: Boolean(form.value.activo)
        };

        const original = props.product;

        const onlyStockChanged =
            isEditMode.value &&
            original !== null &&
            payload.stock !== Number(original.stock) &&
            payload.nombre === original.nombre.trim() &&
            payload.codigo === original.codigo.trim() &&
            payload.id_categoria === Number(original.id_categoria) &&
            payload.precio === Number(original.precio) &&
            payload.descripcion === (original.descripcion?.trim() || null) &&
            payload.imagen === (original.imagen?.trim() || null) &&
            payload.activo === Boolean(original.activo);

        const productUrl = isEditMode.value
            ? `${API_URL}/admin/productos/${original!.id_producto}`
            : `${API_URL}/admin/productos`;

        const url = onlyStockChanged
            ? `${productUrl}/stock`
            : productUrl;

        const method = onlyStockChanged
            ? 'PATCH'
            : isEditMode.value
                ? 'PUT'
                : 'POST';

        const requestBody = onlyStockChanged
            ? { stock: payload.stock }
            : payload;

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(requestBody)
        });

        const data = await res.json().catch(() => null);

        if (!res.ok) {
            backendError.value = data?.message || 'Ocurrió un error al guardar el producto.';
            return;
        }

        emit('saved');
        emit('close');
    } catch (error) {
        console.error('Error de red al guardar producto:', error);
        backendError.value = 'Error de conexión con el servidor. Intentá nuevamente.';
    } finally {
        isSubmitting.value = false;
    }
};

const requestClose = () => {
    if (isSubmitting.value) return;
    emit('close');
};
</script>

<template>
    <div
        v-if="isOpen"
        class="fixed inset-0 bg-[#0B2438]/75 flex items-center justify-center z-50 p-4"
        @click.self="requestClose"
    >
        <div class="bg-[#F8FAFC] w-full max-w-4xl rounded-lg shadow-xl border border-[#E2E8F0] flex flex-col max-h-[90vh]">
            <!-- Encabezado del Modal -->
            <div class="flex justify-between items-center p-6 border-b border-[#E2E8F0] bg-white rounded-t-lg">
                <div>
                    <h3 class="text-xl font-bold text-[#0B2438]">
                        {{ isEditMode ? `Editar Producto #${product?.id_producto}` : 'Crear Nuevo Producto' }}
                    </h3>
                    <p class="text-xs text-[#64748B] mt-0.5">
                        {{ isEditMode ? 'Modificá los datos del producto seleccionado.' : 'Completá los datos para registrar un producto en el catálogo.' }}
                    </p>
                </div>
                <button
                    type="button"
                    @click="requestClose"
                    class="text-[#64748B] hover:text-[#0B2438] text-2xl leading-none px-2"
                    title="Cerrar"
                    :disabled="isSubmitting"
                    aria-label="Cerrar formulario"
                >
                    ×
                </button>
            </div>

            <!-- Cuerpo del Formulario -->
            <form @submit.prevent="handleSubmit" novalidate class="p-4 sm:p-6 min-h-0 overflow-y-auto flex-1 space-y-5">
                <!-- Banner de Error del Backend -->
                <div
                    v-if="backendError"
                    role="alert"
                    class="bg-red-50 border border-red-200 text-[#EF4444] text-sm px-4 py-3 rounded-md flex items-center justify-between"
                >
                    <span>{{ backendError }}</span>
                    <button type="button" @click="backendError = ''" class="text-red-400 hover:text-red-600 font-bold ml-4">✕</button>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <!-- Columna Izquierda: Imagen Placeholder / URL -->
                    <div class="col-span-1 flex flex-col gap-3">
                        <div class="border-2 border-dashed border-[#CBD5E1] rounded-lg flex flex-col items-center justify-center p-6 bg-[#F1F5F9] text-center h-48">
                            <svg class="w-12 h-12 text-[#94A3B8] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                            </svg>
                            <span class="text-xs font-semibold text-[#0B2438]">Imagen del Producto</span>
                            <span class="text-[11px] text-[#64748B] mt-1">Opcional (URL o referencia)</span>
                        </div>
                        <div>
                            <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">URL de Imagen (Opcional)</label>
                            <input
                                v-model="form.imagen"
                                type="text"
                                placeholder="https://..."
                                class="w-full bg-white border border-[#E2E8F0] rounded-md px-3 py-2 text-sm text-[#0B2438] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#103A5C]"
                            >
                        </div>
                    </div>

                    <!-- Columna Derecha: Campos del Producto -->
                    <div class="min-w-0 col-span-1 md:col-span-2 space-y-4">
                        <!-- Nombre -->
                        <div>
                            <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">Nombre del Producto *</label>
                            <input
                                v-model="form.nombre"
                                type="text"
                                placeholder="Ej: Taladro Percutor Industrial"
                                class="w-full bg-white border rounded-md px-3 py-2 text-sm text-[#0B2438] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#103A5C]"
                                :class="fieldErrors.nombre ? 'border-[#EF4444]' : 'border-[#E2E8F0]'"
                            >
                            <p v-if="fieldErrors.nombre" class="text-xs text-[#EF4444] mt-1">{{ fieldErrors.nombre }}</p>
                        </div>

                        <!-- SKU y Categoría -->
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">Código SKU *</label>
                                <input
                                    v-model="form.codigo"
                                    type="text"
                                    placeholder="Ej: PRD-001"
                                    class="w-full bg-white border rounded-md px-3 py-2 text-sm text-[#0B2438] font-mono placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#103A5C]"
                                    :class="fieldErrors.codigo ? 'border-[#EF4444]' : 'border-[#E2E8F0]'"
                                >
                                <p v-if="fieldErrors.codigo" class="text-xs text-[#EF4444] mt-1">{{ fieldErrors.codigo }}</p>
                            </div>

                            <div>
                                <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">Categoría *</label>
                                <select
                                    v-if="categories && categories.length > 0"
                                    v-model.number="form.id_categoria"
                                    class="w-full bg-white border rounded-md px-3 py-2 text-sm text-[#0B2438] focus:outline-none focus:ring-2 focus:ring-[#103A5C]"
                                    :class="fieldErrors.id_categoria ? 'border-[#EF4444]' : 'border-[#E2E8F0]'"
                                >
                                    <option v-for="cat in categories" :key="cat.id_categoria" :value="cat.id_categoria">
                                        {{ cat.nombre }} (#{{ cat.id_categoria }})
                                    </option>
                                </select>
                                <input
                                    v-else
                                    v-model.number="form.id_categoria"
                                    type="number"
                                    min="1"
                                    step="1"
                                    placeholder="ID de Categoría (ej: 1)"
                                    class="w-full bg-white border rounded-md px-3 py-2 text-sm text-[#0B2438] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#103A5C]"
                                    :class="fieldErrors.id_categoria ? 'border-[#EF4444]' : 'border-[#E2E8F0]'"
                                >
                                <p v-if="fieldErrors.id_categoria" class="text-xs text-[#EF4444] mt-1">{{ fieldErrors.id_categoria }}</p>
                            </div>
                        </div>

                        <!-- Precio y Stock -->
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">Precio Base (USD) *</label>
                                <input
                                    v-model="form.precio"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="0.00"
                                    class="w-full bg-white border rounded-md px-3 py-2 text-sm text-[#0B2438] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#103A5C]"
                                    :class="fieldErrors.precio ? 'border-[#EF4444]' : 'border-[#E2E8F0]'"
                                >
                                <p v-if="fieldErrors.precio" class="text-xs text-[#EF4444] mt-1">{{ fieldErrors.precio }}</p>
                            </div>

                            <div>
                                <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">Stock *</label>
                                <input
                                    v-model="form.stock"
                                    type="number"
                                    min="0"
                                    step="1"
                                    placeholder="Ej: 50"
                                    class="w-full bg-white border rounded-md px-3 py-2 text-sm text-[#0B2438] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#103A5C]"
                                    :class="fieldErrors.stock ? 'border-[#EF4444]' : 'border-[#E2E8F0]'"
                                >
                                <p v-if="fieldErrors.stock" class="text-xs text-[#EF4444] mt-1">{{ fieldErrors.stock }}</p>
                            </div>
                        </div>

                        <!-- Descripción -->
                        <div>
                            <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">Descripción Técnica</label>
                            <textarea
                                v-model="form.descripcion"
                                rows="3"
                                placeholder="Detalles técnicos, medidas o especificaciones..."
                                class="w-full bg-white border border-[#E2E8F0] rounded-md px-3 py-2 text-sm text-[#0B2438] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#103A5C] resize-none"
                            ></textarea>
                        </div>

                        <!-- Estado Activo -->
                        <div class="flex items-center gap-3 pt-1">
                            <input
                                id="producto-activo"
                                v-model="form.activo"
                                type="checkbox"
                                class="w-4 h-4 text-[#103A5C] border-[#CBD5E1] rounded focus:ring-[#103A5C]"
                            >
                            <label for="producto-activo" class="text-sm font-medium text-[#0B2438] cursor-pointer">
                                Producto Activo (visible en el catálogo público)
                            </label>
                        </div>
                    </div>
                </div>

                <!-- Pie del Modal / Botones -->
                <div class="pt-4 border-t border-[#E2E8F0] flex flex-col sm:flex-row sm:justify-end gap-3">
                    <button
                        type="button"
                        @click="requestClose"
                        :disabled="isSubmitting"
                        class="px-5 py-2 text-sm font-semibold text-[#64748B] bg-white border border-[#E2E8F0] rounded-md hover:bg-[#F1F5F9] transition-colors disabled:opacity-50"
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        :disabled="isSubmitting"
                        class="px-6 py-2 text-sm font-semibold text-white bg-[#103A5C] rounded-md hover:bg-[#145A8D] transition-colors shadow-sm disabled:opacity-50"
                    >
                        {{ isSubmitting ? 'Guardando...' : (isEditMode ? 'Guardar Cambios' : 'Crear Producto') }}
                    </button>
                </div>
            </form>
        </div>
    </div>
</template>