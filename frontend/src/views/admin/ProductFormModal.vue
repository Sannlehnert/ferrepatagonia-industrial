<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import axios from 'axios';
import {
    saveAdminProduct,
    updateAdminProductStock,
    type AdminProduct,
    type CategoryOption
} from '../../services/adminProductService';

import { isMutationResultUncertain, uncertainMutationMessage, adminMutationErrorMessage } from '../../services/adminMutationError';

const props = defineProps<{
    isOpen: boolean;
    product: AdminProduct | null;
    categories?: CategoryOption[];
    isLoadingCategories?: boolean;
    categoriesError?: string;
    mutationBlocked?: boolean;
    isReloading?: boolean;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'saved', message: string): void;
    (e: 'retry-categories'): void;
    (e: 'uncertain'): void;
    (e: 'reload'): void;
}>();

const isEditMode = computed(() => Boolean(props.product?.id_producto));
const isSubmitting = ref(false);
const backendError = ref('');
const uncertain = ref(false);
const formDisabled = computed(() => isSubmitting.value || uncertain.value || props.mutationBlocked);
const fieldErrors = ref<Record<string, string>>({});

const form = ref({
    nombre: '',
    codigo: '',
    id_categoria: '' as number | string,
    precio: '' as number | string,
    stock: '' as number | string,
    descripcion: '',
    imagen: '',
    activo: true
});

const availableCategories = computed<CategoryOption[]>(() => {
    const list = props.categories ? [...props.categories] : [];
    const currentCatId = props.product?.id_categoria;
    if (
        isEditMode.value &&
        currentCatId &&
        !list.some((c) => Number(c.id_categoria) === Number(currentCatId))
    ) {
        list.push({
            id_categoria: Number(currentCatId),
            nombre: props.product?.categoria_nombre
                ? `${props.product.categoria_nombre} (Actual)`
                : `Categoría #${currentCatId} (Actual)`
        });
    }
    return list;
});

// Inicializa solo al abrir el modal para no borrar datos si falla una petición
watch(
    () => props.isOpen,
    (isOpen, wasOpen) => {
        if (!isOpen || wasOpen) return;
        backendError.value = '';
        uncertain.value = false;
        fieldErrors.value = {};

        if (props.product) {
            form.value = {
                nombre: props.product.nombre ?? '',
                codigo: props.product.codigo ?? '',
                id_categoria: Number(props.product.id_categoria) || '',
                precio: Number(props.product.precio ?? 0),
                stock: Number(props.product.stock ?? 0),
                descripcion: props.product.descripcion ?? '',
                imagen: props.product.imagen ?? '',
                activo: Boolean(props.product.activo)
            };
        } else {
            const firstCategory = props.categories?.[0];
            form.value = {
                nombre: '',
                codigo: '',
                id_categoria: firstCategory ? firstCategory.id_categoria : '',
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

watch(
    () => props.categories,
    (newCats) => {
        const firstCategory = newCats?.[0];
        if (props.isOpen && !isEditMode.value && !form.value.id_categoria && firstCategory) {
            form.value.id_categoria = firstCategory.id_categoria;
        }
    }
);

const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    const nombre = form.value.nombre.trim();
    const codigo = form.value.codigo.trim();
    const catId = Number(form.value.id_categoria);
    const precio = Number(form.value.precio);
    const stock = Number(form.value.stock);

    if (!nombre) errors.nombre = 'El nombre del producto es obligatorio.';
    else if (nombre.length > 200) errors.nombre = 'Máximo 200 caracteres.';

    if (!codigo) errors.codigo = 'El código SKU es obligatorio.';
    else if (codigo.length > 100) errors.codigo = 'Máximo 100 caracteres.';

    if (!form.value.id_categoria || !Number.isInteger(catId) || catId <= 0) {
        errors.id_categoria = 'Seleccioná una categoría válida.';
    }

    if (form.value.precio === '' || isNaN(precio) || precio < 0 || precio > 9999999999.99) {
        errors.precio = 'Ingresá un precio válido mayor o igual a 0.';
    }

    if (form.value.stock === '' || !Number.isInteger(stock) || stock < 0 || stock > 2147483647) {
        errors.stock = 'El stock debe ser un entero mayor o igual a 0.';
    }

    fieldErrors.value = errors;
    return Object.keys(errors).length === 0;
};

const handleSubmit = async () => {
    if (formDisabled.value) return;
    backendError.value = '';
    if (!validateForm()) return;

    if (isEditMode.value && Boolean(props.product?.activo) && !form.value.activo &&
        !window.confirm(`¿Desactivar "${props.product!.nombre}" (${props.product!.codigo})?\nDejará de estar disponible en el catálogo público.`)) return;

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
        const onlyStockChanged = original !== null && payload.stock !== Number(original.stock) &&
            payload.nombre === original.nombre.trim() && payload.codigo === original.codigo.trim() &&
            payload.id_categoria === Number(original.id_categoria) && payload.precio === Number(original.precio) &&
            payload.descripcion === (original.descripcion?.trim() || null) &&
            payload.imagen === (original.imagen?.trim() || null) && payload.activo === Boolean(original.activo);
        if (onlyStockChanged) await updateAdminProductStock(original!.id_producto, payload.stock);
        else await saveAdminProduct(payload, props.product?.id_producto);

        emit(
            'saved',
            isEditMode.value
                ? `"${payload.nombre}" se actualizó correctamente.`
                : `"${payload.nombre}" se creó correctamente.`
        );
        emit('close');
    } catch (error: unknown) {
        let msg = 'Error al guardar el producto.';
        let status: number | undefined;

        if (axios.isAxiosError(error)) {
            status = error.response?.status;
            msg = error.response?.data?.message || error.response?.data?.error || error.message;
        } else if (error instanceof Error) {
            msg = error.message;
        }

        backendError.value = adminMutationErrorMessage(error);
        if (isMutationResultUncertain(error)) {
            uncertain.value = true;
            backendError.value = uncertainMutationMessage;
            emit('uncertain');
        }

        if (status === 409) {
            fieldErrors.value = { ...fieldErrors.value, codigo: msg };
        }
    } finally {
        isSubmitting.value = false;
    }
};

const requestClose = () => {
    if (!isSubmitting.value && !props.isReloading) emit('close');
};
</script>

<template>
    <div
        v-if="isOpen"
        class="fixed inset-0 bg-[#0B2438]/75 flex items-center justify-center z-50 p-2 sm:p-4"
        @click.self="requestClose"
    >
        <div class="bg-[#F8FAFC] w-full max-w-3xl rounded-lg shadow-xl border border-[#E2E8F0] flex flex-col max-h-[90dvh]">
            <!-- Encabezado fijo -->
            <div class="shrink-0 flex justify-between items-center p-4 sm:p-6 border-b border-[#E2E8F0] bg-white rounded-t-lg">
                <h3 class="text-lg sm:text-xl font-bold text-[#0B2438]">
                    {{ isEditMode ? `Editar Producto #${product?.id_producto}` : 'Crear Nuevo Producto' }}
                </h3>
                <button
                    type="button"
                    @click="requestClose"
                    :disabled="isSubmitting || isReloading"
                    aria-label="Cerrar formulario"
                    class="box-border min-h-11 min-w-11 flex items-center justify-center border-0 bg-transparent text-[#64748B] hover:text-[#0B2438] text-2xl"
                >
                    ×
                </button>
            </div>

            <!-- Formulario con cuerpo scrollable y botones fijos abajo -->
            <form @submit.prevent="handleSubmit" novalidate class="flex flex-col flex-1 min-h-0">
                <div class="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
                    <div v-if="uncertain || mutationBlocked" role="alert" class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        <p>{{ uncertainMutationMessage }}</p>
                        <button type="button" :disabled="isReloading" @click="emit('reload')" class="box-border min-h-11 border-0 bg-transparent underline">{{ isReloading ? 'Recargando...' : 'Recargar listado' }}</button>
                    </div>
                    <div
                        v-if="backendError && !uncertain"
                        role="alert"
                        class="bg-red-50 border border-red-200 text-[#EF4444] text-sm px-4 py-3 rounded-md flex items-center justify-between"
                    >
                        <span>{{ backendError }}</span>
                        <button type="button" @click="backendError = ''" class="border-0 bg-transparent font-bold ml-4">✕</button>
                    </div>

                    <div>
                        <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">Nombre del Producto *</label>
                        <input
                            v-model="form.nombre"
                            type="text"
                            :disabled="formDisabled"
                            class="box-border min-h-11 w-full bg-white border rounded-md px-3 py-2 text-sm text-[#0B2438]"
                            :class="fieldErrors.nombre ? 'border-[#EF4444]' : 'border-[#E2E8F0]'"
                        >
                        <p v-if="fieldErrors.nombre" class="text-xs text-[#EF4444] mt-1">{{ fieldErrors.nombre }}</p>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">Código SKU *</label>
                            <input
                                v-model="form.codigo"
                                type="text"
                                :disabled="formDisabled"
                                class="box-border min-h-11 w-full bg-white border rounded-md px-3 py-2 text-sm text-[#0B2438] font-mono"
                                :class="fieldErrors.codigo ? 'border-[#EF4444]' : 'border-[#E2E8F0]'"
                            >
                            <p v-if="fieldErrors.codigo" class="text-xs text-[#EF4444] mt-1">{{ fieldErrors.codigo }}</p>
                        </div>

                        <div>
                            <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">Categoría *</label>
                            <div v-if="isLoadingCategories" class="border border-[#E2E8F0] rounded-md px-3 py-2 text-sm text-[#64748B] bg-[#F1F5F9]">
                                Cargando categorías...
                            </div>
                            <div v-if="categoriesError" role="alert" class="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                                <p>{{ categoriesError }}</p>
                                <button type="button" @click="emit('retry-categories')" class="mt-1 font-semibold underline">
                                    Reintentar
                                </button>
                            </div>
                            <select
                                v-if="!isLoadingCategories"
                                v-model.number="form.id_categoria"
                                :disabled="formDisabled || availableCategories.length === 0"
                                class="box-border min-h-11 w-full bg-white border rounded-md px-3 py-2 text-sm text-[#0B2438]"
                                :class="fieldErrors.id_categoria ? 'border-[#EF4444]' : 'border-[#E2E8F0]'"
                            >
                                <option value="" disabled>Seleccioná una categoría</option>
                                <option v-for="cat in availableCategories" :key="cat.id_categoria" :value="Number(cat.id_categoria)">
                                    {{ cat.nombre }}
                                </option>
                            </select>
                            <p v-if="fieldErrors.id_categoria" class="text-xs text-[#EF4444] mt-1">{{ fieldErrors.id_categoria }}</p>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">Precio Base (USD) *</label>
                            <input
                                v-model="form.precio"
                                type="number"
                                min="0"
                                step="0.01"
                                :disabled="formDisabled"
                                class="box-border min-h-11 w-full bg-white border rounded-md px-3 py-2 text-sm text-[#0B2438]"
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
                                :disabled="formDisabled"
                                class="box-border min-h-11 w-full bg-white border rounded-md px-3 py-2 text-sm text-[#0B2438]"
                                :class="fieldErrors.stock ? 'border-[#EF4444]' : 'border-[#E2E8F0]'"
                            >
                            <p v-if="fieldErrors.stock" class="text-xs text-[#EF4444] mt-1">{{ fieldErrors.stock }}</p>
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">URL de Imagen (Opcional)</label>
                        <input
                            v-model="form.imagen"
                            type="text"
                            placeholder="https://..."
                            :disabled="formDisabled"
                            class="box-border min-h-11 w-full bg-white border border-[#E2E8F0] rounded-md px-3 py-2 text-sm text-[#0B2438]"
                        >
                    </div>

                    <div>
                        <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">Descripción Técnica</label>
                        <textarea
                            v-model="form.descripcion"
                            rows="3"
                            :disabled="formDisabled"
                            class="box-border min-h-11 w-full bg-white border border-[#E2E8F0] rounded-md px-3 py-2 text-sm text-[#0B2438] resize-none"
                        ></textarea>
                    </div>

                    <div class="flex items-center gap-3 pt-1">
                        <input
                            id="producto-activo"
                            v-model="form.activo"
                            type="checkbox"
                            :disabled="formDisabled"
                            class="w-4 h-4 text-[#103A5C] border-[#CBD5E1] rounded"
                        >
                        <label for="producto-activo" class="text-sm font-medium text-[#0B2438] cursor-pointer">
                            Producto Activo (visible en el catálogo público)
                        </label>
                    </div>
                </div>

                <!-- Pie fijo visible en móvil -->
                <div class="shrink-0 p-4 sm:px-6 bg-white border-t border-[#E2E8F0] rounded-b-lg flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
                    <button
                        type="button"
                        @click="requestClose"
                        :disabled="isSubmitting || isReloading"
                        class="box-border min-h-11 px-5 py-2 text-sm font-semibold text-[#64748B] bg-white border border-[#E2E8F0] rounded-md hover:bg-[#F1F5F9] disabled:opacity-50 w-full sm:w-auto"
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        :disabled="formDisabled"
                        class="box-border min-h-11 border-0 px-6 py-2 text-sm font-semibold text-white bg-[#103A5C] rounded-md hover:bg-[#145A8D] disabled:opacity-50 w-full sm:w-auto"
                    >
                        {{ isSubmitting ? 'Guardando...' : (isEditMode ? 'Guardar Cambios' : 'Crear Producto') }}
                    </button>
                </div>
            </form>
        </div>
    </div>
</template>
