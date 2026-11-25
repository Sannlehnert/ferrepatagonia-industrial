<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import axios from 'axios';
import ProductThumbnail from '@/components/ProductThumbnail.vue';
import {
    saveAdminProduct,
    saveAdminProductWithImage,
    updateAdminProductStock,
    verifyAdminProductPrice,
    canonicalPrice,
    type AdminProduct,
    type CategoryOption
} from '../../services/adminProductService';

import { isMutationResultUncertain, uncertainMutationMessage, adminMutationErrorMessage } from '../../services/adminMutationError';
import { basePriceLabels } from '@/types/pricing';

const props = defineProps<{
    isOpen: boolean;
    product: AdminProduct | null;
    categories?: CategoryOption[];
    isLoadingCategories?: boolean;
    categoriesError?: string;
    mutationBlocked?: boolean;
    isReloading?: boolean;
}>();

type SaveTone = 'success' | 'warning';

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'saved', message: string, tone?: SaveTone): void;
    (e: 'retry-categories'): void;
    (e: 'uncertain'): void;
    (e: 'reload'): void;
}>();

const draftProduct = ref<AdminProduct | null>(null);
const dialog = ref<HTMLDialogElement | null>(null);
const isEditMode = computed(() => Boolean(draftProduct.value?.id_producto));

let lastDialogFocus: HTMLElement | null = null;
let nativeRestorePending = false;
let suppressCancel = false;
let unmounting = false;

const containDialogFocus = (event: KeyboardEvent) => {
    if (!dialog.value) return;

    // Chromium puede completar el cierre del CloseWatcher aunque cancel esté
    // prevenido. Interceptamos Escape para que el cierre siempre pase por la
    // lógica de la aplicación y no desincronice el estado del padre.
    if (event.key === 'Escape') {
        event.preventDefault();
        suppressCancel = true;
        globalThis.setTimeout(() => { suppressCancel = false; }, 0);
        requestClose('implicit');
        return;
    }

    if (event.key !== 'Tab') return;
    const controls = [...dialog.value.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], [tabindex]'
    )].filter(control => !control.matches(':disabled') && control.tabIndex >= 0
        && control.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    const current = dialog.value.ownerDocument.activeElement;
    if (event.shiftKey && current === first) {
        event.preventDefault();
        last?.focus();
    } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first?.focus();
    }
};

const rememberDialogFocus = (event: FocusEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && dialog.value?.contains(target)) {
        lastDialogFocus = target;
    }
};

const restoreNativeDialog = () => {
    const element = dialog.value;
    if (unmounting || !props.isOpen || !element || element.open) return;

    try {
        element.showModal();
    } catch {
        return;
    }

    const target = lastDialogFocus;
    if (target?.isConnected && element.contains(target) && !target.matches(':disabled')) {
        target.focus({ preventScroll: true });
    } else {
        element.querySelector<HTMLInputElement>('form input')?.focus({ preventScroll: true });
    }
};
const isSubmitting = ref(false);
const backendError = ref('');
const uncertain = ref(false);
const closeAttemptNotice = ref('');
const formDisabled = computed(() => isSubmitting.value || uncertain.value || props.mutationBlocked);
const fieldErrors = ref<Record<string, string>>({});
const imageFile = ref<File>();
const previewUrl = ref('');
const imageError = ref('');
const imageInput = ref<HTMLInputElement>();
const verifyPriceAfterSave = ref(false);
const priceEvidence = ref('');
const priceReviewConfirmed = ref(false);

function clearImage(resetInput = true) {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = '';
    imageFile.value = undefined;
    imageError.value = '';
    if (resetInput && imageInput.value) imageInput.value.value = '';
}

function selectImage(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    clearImage(false);
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        imageError.value = 'Seleccioná una foto JPEG, PNG o WebP.';
    } else if (!file.size || file.size > 5 * 1024 * 1024) {
        imageError.value = 'La foto debe tener contenido y pesar hasta 5 MiB.';
    } else {
        imageFile.value = file;
        previewUrl.value = URL.createObjectURL(file);
    }
}

function rejectPreview() {
    clearImage();
    imageError.value = 'No se pudo abrir la foto. Elegí otra imagen.';
}

onBeforeUnmount(() => {
    unmounting = true;
    clearImage();
    if (dialog.value?.open) dialog.value.close();
});

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

const formSnapshot = () => JSON.stringify(form.value);
// Los cambios se comparan con el estado con el que se abrió el formulario.
const initialSnapshot = ref('');
const hasVerificationDraft = () => verifyPriceAfterSave.value
    || priceEvidence.value.trim() !== '' || priceReviewConfirmed.value;
const isDirty = computed(() => Boolean(imageFile.value) || hasVerificationDraft()
    || (initialSnapshot.value !== '' && formSnapshot() !== initialSnapshot.value));
const hasPendingError = computed(() => Boolean(backendError.value) || uncertain.value
    || Object.keys(fieldErrors.value).length > 0 || Boolean(imageError.value));

watch([isDirty, hasPendingError], ([dirty, pending]) => {
    if (!dirty && !pending) closeAttemptNotice.value = '';
}, { flush: 'sync' });

const validCategoryId = (value: unknown): number | '' => {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : '';
};

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
        if (!isOpen) {
            clearImage();
            dialog.value?.close();
        }
        if (!isOpen || wasOpen) return;
        draftProduct.value = props.product ? { ...props.product } : null;
        void nextTick(() => {
            if (!props.isOpen || !dialog.value) return;
            dialog.value.showModal();
            dialog.value.querySelector<HTMLInputElement>('form input')?.focus({ preventScroll: true });
        });
        backendError.value = '';
        uncertain.value = false;
        closeAttemptNotice.value = '';
        fieldErrors.value = {};
        verifyPriceAfterSave.value = false;
        priceEvidence.value = '';
        priceReviewConfirmed.value = false;

        if (props.product) {
            const rawPrecio = props.product.precio;
            const hasPrecio = rawPrecio !== null && rawPrecio !== undefined && (rawPrecio as unknown) !== '';

            form.value = {
                nombre: props.product.nombre ?? '',
                codigo: props.product.codigo ?? '',
                id_categoria: validCategoryId(props.product.id_categoria),
                // H05: Si no tiene precio dejamos ''; si tiene precio, Number() normaliza "150.00" a 150
                precio: hasPrecio ? Number(rawPrecio) : '',
                stock: Number(props.product.stock ?? 0),
                descripcion: props.product.descripcion ?? '',
                imagen: props.product.imagen ?? '',
                activo: Boolean(props.product.activo)
            };
        } else {
            form.value = {
                nombre: '',
                codigo: '',
                id_categoria: '',
                precio: '',
                stock: '',
                descripcion: '',
                imagen: '',
                activo: true
            };
        }
        initialSnapshot.value = formSnapshot();
    },
    { immediate: true }
);

watch(
    () => props.categories,
    (newCats) => {
        // En alta, si las categorías llegan después de abrir el modal,
        // seleccionamos la primera válida sin marcar el formulario como editado.
        if (!props.isOpen || isEditMode.value || form.value.id_categoria !== '') return;
        const firstCategory = newCats?.find(cat => validCategoryId(cat.id_categoria) !== '');
        if (!firstCategory) return;

        const untouched = formSnapshot() === initialSnapshot.value;
        form.value.id_categoria = Number(firstCategory.id_categoria);
        if (untouched && !imageFile.value) initialSnapshot.value = formSnapshot();
    }
);

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

    // H05: Permitir precio vacío solo si el producto original ya no tenía precio
    const isOriginalPriceNull = isEditMode.value && (props.product?.precio === null || props.product?.precio === undefined);
    const isPriceEmpty = form.value.precio === '' || form.value.precio === null || form.value.precio === undefined;

    if (!isPriceEmpty) {
        const precioNum = Number(form.value.precio);
        if (isNaN(precioNum) || precioNum < 0) {
            errors.precio = 'El precio debe ser un número mayor o igual a 0.';
        }
    } else if (!isOriginalPriceNull) {
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
        errors.stock = 'El stock debe ser un entero mayor o igual a 0.';
    }

    if (verifyPriceAfterSave.value) {
        const price = canonicalPrice(form.value.precio);
        if (!price || price === '0.00') {
            errors.precio = 'Para verificar el precio, cargá un importe mayor a cero.';
        }
        const evidence = priceEvidence.value.trim();
        if (evidence.length < 8 || evidence.length > 1000) {
            errors.precioEvidencia = 'Indicá una referencia de evidencia de entre 8 y 1000 caracteres.';
        }
        if (!priceReviewConfirmed.value) {
            errors.precioConfirmacion = 'Confirmá explícitamente que revisaste el precio y la evidencia.';
        }
    }

    fieldErrors.value = errors;
    return Object.keys(errors).length === 0;
};

const verificationErrorMessage = (error: unknown): string => {
    if (axios.isAxiosError<{ message?: string; code?: string }>(error)) {
        const code = error.response?.data?.code;
        const message = error.response?.data?.message;
        if (code === 'IMPORTE_NO_COINCIDE') {
            return 'El precio guardado no coincide con el importe revisado.';
        }
        if (code === 'VERIFICACION_NO_CONFIGURADA') {
            return 'La verificación administrativa de precios no está configurada.';
        }
        if (code === 'RESULTADO_DESCONOCIDO') {
            return 'No se pudo confirmar el resultado; reintentá desde la acción Verificar precio.';
        }
        if (typeof message === 'string' && message.trim()) return message;
    }
    return 'No se pudo verificar el precio. Reintentá desde la acción Verificar precio.';
};

const handleSubmit = async () => {
    if (!props.isOpen || formDisabled.value || imageError.value) return;
    if (props.product?.id_producto !== draftProduct.value?.id_producto) {
        backendError.value = 'El producto seleccionado cambió. Cerrá el formulario y volvé a abrirlo.';
        return;
    }
    backendError.value = '';
    closeAttemptNotice.value = '';
    if (!validateForm()) return;

    if (isEditMode.value && Boolean(props.product?.activo) && !form.value.activo &&
        !window.confirm(`¿Desactivar "${props.product!.nombre}" (${props.product!.codigo})?\nDejará de estar disponible en el catálogo público.`)) return;

    isSubmitting.value = true;
    try {
        const isPriceEmpty = form.value.precio === '' || form.value.precio === null || form.value.precio === undefined;

        const payload = {
            nombre: form.value.nombre.trim(),
            codigo: form.value.codigo.trim(),
            id_categoria: Number(form.value.id_categoria),
            ...(isPriceEmpty ? {} : { precio: Number(form.value.precio) }),
            stock: Number(form.value.stock),
            descripcion: form.value.descripcion.trim() || null,
            imagen: form.value.imagen.trim() || null,
            activo: Boolean(form.value.activo)
        };

        const original = draftProduct.value;
        const priceUnchanged = original !== null && (
            isPriceEmpty
                ? (original.precio === null || original.precio === undefined)
                : (original.precio !== null && original.precio !== undefined && payload.precio === Number(original.precio))
        );

        const onlyStockChanged = original !== null && payload.stock !== Number(original.stock) &&
            payload.nombre === original.nombre.trim() && payload.codigo === original.codigo.trim() &&
            payload.id_categoria === Number(original.id_categoria) && priceUnchanged &&
            payload.descripcion === (original.descripcion?.trim() || null) &&
            payload.imagen === (original.imagen?.trim() || null) && payload.activo === Boolean(original.activo);

        const data = payload as Parameters<typeof saveAdminProduct>[0];
        if (original && payload.imagen === (original.imagen?.trim() || null)) delete data.imagen;
        let savedProduct: AdminProduct | null = null;
        if (imageFile.value) {
            savedProduct = await saveAdminProductWithImage(data, imageFile.value, original?.id_producto);
        } else if (onlyStockChanged) {
            await updateAdminProductStock(original!.id_producto, payload.stock);
            savedProduct = original ? { ...original, stock: payload.stock } : null;
        } else {
            savedProduct = await saveAdminProduct(data, original?.id_producto);
        }

        let verificationNotice = '';
        let saveTone: SaveTone = 'success';
        if (verifyPriceAfterSave.value) {
            const productId = savedProduct?.id_producto ?? original?.id_producto;
            const amount = canonicalPrice(savedProduct?.precio ?? payload.precio);
            if (!productId || !amount || amount === '0.00') {
                verificationNotice = ' El producto se guardó, pero el precio no permite verificación.';
                saveTone = 'warning';
            } else {
                try {
                    const verified = await verifyAdminProductPrice(productId, {
                        importe: amount,
                        evidencia: priceEvidence.value.trim(),
                        confirmar: true,
                    });
                    if (verified.publicado) {
                        verificationNotice = ' Precio verificado y publicado por FER-17.';
                    } else {
                        verificationNotice = ` La evidencia quedó registrada, pero FER-17 no publica el precio (${verified.estadoFer17}).`;
                        saveTone = 'warning';
                    }
                } catch (error: unknown) {
                    verificationNotice = ` El producto se guardó, pero el precio quedó pendiente de verificación: ${verificationErrorMessage(error)}`;
                    saveTone = 'warning';
                }
            }
        }

        emit(
            'saved',
            (isEditMode.value
                ? `"${payload.nombre}" se actualizó correctamente.`
                : `"${payload.nombre}" se creó correctamente.`) + verificationNotice,
            saveTone
        );
        emit('close');
    } catch (error: unknown) {
        let msg = 'Error al guardar el producto.';
        let status: number | undefined;
        let imageRejected = false;

        if (axios.isAxiosError(error)) {
            status = error.response?.status;
            msg = error.response?.data?.message || error.response?.data?.error || error.message;
            imageRejected = status === 413 || status === 415 || error.response?.data?.code === 'PRODUCT_IMAGE_REJECTED';
        } else if (error instanceof Error) {
            msg = error.message;
        }

        backendError.value = adminMutationErrorMessage(error);
        if (!(imageFile.value && imageRejected) && isMutationResultUncertain(error)) {
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

const requestClose = (source: 'explicit' | 'implicit' = 'explicit') => {
    if (isSubmitting.value || props.isReloading) {
        if (source === 'implicit') {
            closeAttemptNotice.value = isSubmitting.value
                ? 'Esperá a que termine el guardado para cerrar el formulario.'
                : 'Esperá a que termine la recarga para cerrar el formulario.';
        }
        return;
    }
    if (source === 'implicit' && (isDirty.value || hasPendingError.value)) {
        closeAttemptNotice.value = 'Para cerrar el formulario usá «Cancelar» o el botón ×; así no se pierden los datos ni el detalle del error.';
        return;
    }
    if (source === 'explicit' && isDirty.value
        && !window.confirm('¿Descartar los cambios sin guardar del producto?')) return;
    emit('close');
};

const handleCancel = (event: Event) => {
    event.preventDefault();
    if (suppressCancel) return;
    requestClose('implicit');
};

const handleNativeClose = () => {
    if (unmounting || !props.isOpen) return;

    if (isSubmitting.value || props.isReloading) {
        closeAttemptNotice.value = isSubmitting.value
            ? 'Esperá a que termine el guardado para cerrar el formulario.'
            : 'Esperá a que termine la recarga para cerrar el formulario.';
    } else if (isDirty.value || hasPendingError.value) {
        closeAttemptNotice.value = 'Para cerrar el formulario usá «Cancelar» o el botón ×; así no se pierden los datos ni el detalle del error.';
    } else {
        // El cierre nativo fue autorizado: sincronizamos el estado del padre.
        emit('close');
        return;
    }

    if (nativeRestorePending) return;
    nativeRestorePending = true;
    void nextTick(() => {
        nativeRestorePending = false;
        restoreNativeDialog();
    });
};
</script>

<template>
    <dialog
        ref="dialog"
        v-if="isOpen"
        aria-labelledby="product-form-title"
        class="fixed inset-0 m-auto h-full max-h-none w-full max-w-none box-border border-0 bg-[#0B2438]/75 p-2 sm:p-4 open:flex items-center justify-center"
        @cancel="handleCancel"
        @close="handleNativeClose"
        @keydown="containDialogFocus"
        @focusin="rememberDialogFocus"
        @click.self="requestClose('implicit')"
    >
        <div class="bg-[#F8FAFC] w-full max-w-3xl rounded-lg shadow-xl border border-[#E2E8F0] flex flex-col max-h-[90dvh]">
            <!-- Encabezado fijo -->
            <div class="shrink-0 flex justify-between items-center p-4 sm:p-6 border-b border-[#E2E8F0] bg-white rounded-t-lg">
                <h3 id="product-form-title" class="text-lg sm:text-xl font-bold text-[#0B2438]">
                    {{ isEditMode ? `Editar Producto #${draftProduct?.id_producto}` : 'Crear Nuevo Producto' }}
                </h3>
                <button
                    type="button"
                    @click="requestClose()"
                    :disabled="isSubmitting || isReloading"
                    aria-label="Cerrar formulario"
                    class="box-border min-h-11 min-w-11 flex items-center justify-center cursor-pointer border-0 bg-transparent font-[inherit] text-[#64748B] hover:text-[#0B2438] text-2xl focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    ×
                </button>
            </div>

            <!-- Aviso de cierre fijo, fuera del cuerpo desplazable -->
            <div v-if="closeAttemptNotice" class="shrink-0 px-4 pt-4 sm:px-6 sm:pt-5">
                <p
                    role="alert"
                    class="m-0 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 wrap-anywhere"
                >
                    {{ closeAttemptNotice }}
                </p>
            </div>

            <!-- Formulario con cuerpo scrollable y botones fijos abajo -->
            <form @submit.prevent="handleSubmit" novalidate class="flex flex-col flex-1 min-h-0">
                <div class="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
                    <div v-if="uncertain || mutationBlocked" role="alert" class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        <p class="wrap-anywhere">{{ uncertainMutationMessage }}</p>
                        <button type="button" :disabled="isReloading" @click="emit('reload')" class="box-border min-h-11 min-w-11 cursor-pointer border-0 bg-transparent px-2 font-[inherit] underline disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]">{{ isReloading ? 'Recargando...' : 'Recargar listado' }}</button>
                    </div>
                    <div
                        v-if="backendError && !uncertain"
                        role="alert"
                        class="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-md flex items-start gap-3"
                    >
                        <span class="wrap-anywhere min-w-0 flex-1">{{ backendError }}</span>
                        <button
                            type="button"
                            aria-label="Descartar error"
                            class="box-border -my-2 -mr-2 flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent font-[inherit] font-bold focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                            @click="backendError = ''"
                        >✕</button>
                    </div>

                    <div>
                        <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">Nombre del Producto *</label>
                        <input
                            v-model="form.nombre"
                            type="text"
                            :disabled="formDisabled"
                            class="box-border min-h-11 w-full bg-white border border-solid rounded-md px-3 py-2 font-[inherit] text-sm text-[#0B2438] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                            :class="fieldErrors.nombre ? 'border-[#EF4444]' : 'border-[#E2E8F0]'"
                        >
                        <p v-if="fieldErrors.nombre" class="text-xs text-red-700 mt-1">{{ fieldErrors.nombre }}</p>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">Código SKU *</label>
                            <input
                                v-model="form.codigo"
                                type="text"
                                :disabled="formDisabled"
                                class="box-border min-h-11 w-full bg-white border border-solid rounded-md px-3 py-2 font-[inherit] text-sm text-[#0B2438] font-mono focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                                :class="fieldErrors.codigo ? 'border-[#EF4444]' : 'border-[#E2E8F0]'"
                            >
                            <p v-if="fieldErrors.codigo" class="text-xs text-red-700 mt-1 wrap-anywhere">{{ fieldErrors.codigo }}</p>
                        </div>

                        <div>
                            <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">Categoría *</label>
                            <div v-if="isLoadingCategories" class="border border-[#E2E8F0] rounded-md px-3 py-2 text-sm text-[#64748B] bg-[#F1F5F9]">
                                Cargando categorías...
                            </div>
                            <div v-if="categoriesError" role="alert" class="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                                <p class="wrap-anywhere">{{ categoriesError }}</p>
                                <button type="button" @click="emit('retry-categories')" class="mt-1 box-border min-h-11 min-w-11 cursor-pointer border-0 bg-transparent px-2 inline-flex items-center font-[inherit] font-semibold underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]">
                                    Reintentar
                                </button>
                            </div>
                            <select
                                v-if="!isLoadingCategories"
                                v-model.number="form.id_categoria"
                                :disabled="formDisabled || availableCategories.length === 0"
                                class="box-border min-h-11 w-full bg-white border border-solid rounded-md px-3 py-2 font-[inherit] text-sm text-[#0B2438] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                                :class="fieldErrors.id_categoria ? 'border-[#EF4444]' : 'border-[#E2E8F0]'"
                            >
                                <option value="" disabled>Seleccioná una categoría</option>
                                <option v-for="cat in availableCategories" :key="cat.id_categoria" :value="Number(cat.id_categoria)">
                                    {{ cat.nombre }}
                                </option>
                            </select>
                            <p v-if="fieldErrors.id_categoria" class="text-xs text-red-700 mt-1">{{ fieldErrors.id_categoria }}</p>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">Importe base cargado (USD) *</label>
                            <input
                                v-model="form.precio"
                                type="number"
                                min="0"
                                step="0.01"
                                :disabled="formDisabled"
                                class="box-border min-h-11 w-full bg-white border border-solid rounded-md px-3 py-2 font-[inherit] text-sm text-[#0B2438] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                                :class="fieldErrors.precio ? 'border-[#EF4444]' : 'border-[#E2E8F0]'"
                            >
                            <p
                                v-if="isEditMode"
                                data-testid="estado-precio-base"
                                class="mt-1 rounded-md border px-2 py-1 text-xs font-semibold"
                                :class="product?.estado_precio_base === 'VERIFICADO'
                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                    : 'border-amber-300 bg-amber-50 text-amber-900'"
                            >
                                Evidencia actual: {{ product?.estado_precio_base ? basePriceLabels[product.estado_precio_base] : 'No se pudo determinar el estado del precio base' }}
                            </p>
                            <p class="mt-1 text-xs text-[#64748B]">Guardar o cambiar el importe no verifica el precio e invalida la evidencia previa. Requiere nueva evidencia antes de ofrecerlo en el catálogo.</p>
                            <p v-if="fieldErrors.precio" class="text-xs text-red-700 mt-1">{{ fieldErrors.precio }}</p>
                        </div>

                        <div>
                            <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">Stock *</label>
                            <input
                                v-model="form.stock"
                                type="number"
                                min="0"
                                step="1"
                                :disabled="formDisabled"
                                class="box-border min-h-11 w-full bg-white border border-solid rounded-md px-3 py-2 font-[inherit] text-sm text-[#0B2438] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                                :class="fieldErrors.stock ? 'border-[#EF4444]' : 'border-[#E2E8F0]'"
                            >
                            <p v-if="fieldErrors.stock" class="text-xs text-red-700 mt-1">{{ fieldErrors.stock }}</p>
                        </div>
                    </div>

                    <div class="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                        <label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-[#0B2438]">
                            <input
                                v-model="verifyPriceAfterSave"
                                type="checkbox"
                                :disabled="formDisabled"
                                class="box-border h-5 w-5 shrink-0 cursor-pointer accent-[#103A5C] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                            />
                            <span>Verificar este precio al guardar</span>
                        </label>
                        <template v-if="verifyPriceAfterSave">
                            <label for="producto-precio-evidencia" class="mt-3 grid gap-1 text-sm font-semibold text-[#0B2438]">
                                Evidencia comercial
                                <textarea
                                    id="producto-precio-evidencia"
                                    v-model="priceEvidence"
                                    rows="3"
                                    maxlength="1000"
                                    :disabled="formDisabled"
                                    aria-describedby="producto-precio-evidencia-ayuda"
                                    class="box-border w-full rounded-md border border-solid border-[#CBD5E1] bg-white px-3 py-2 font-[inherit] text-sm font-normal text-[#0B2438] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D] disabled:opacity-60"
                                />
                                <span id="producto-precio-evidencia-ayuda" class="text-xs font-normal text-[#64748B]">
                                    Documento, origen y localizador verificable. No se aceptan referencias genéricas, sintéticas ni de demostración.
                                </span>
                            </label>
                            <p v-if="fieldErrors.precioEvidencia" class="mt-1 text-xs text-red-700">{{ fieldErrors.precioEvidencia }}</p>
                            <label class="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm text-[#0B2438]">
                                <input
                                    v-model="priceReviewConfirmed"
                                    type="checkbox"
                                    :disabled="formDisabled"
                                    class="box-border h-5 w-5 shrink-0 cursor-pointer accent-[#103A5C] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                                />
                                <span>Confirmo que revisé manualmente el precio y la evidencia.</span>
                            </label>
                            <p v-if="fieldErrors.precioConfirmacion" class="mt-1 text-xs text-red-700">{{ fieldErrors.precioConfirmacion }}</p>
                            <p class="mt-2 text-xs text-[#64748B]">
                                El producto se guarda primero. Si la verificación falla, quedará pendiente y podrá reintentarse desde la acción Verificar precio.
                            </p>
                        </template>
                    </div>

                    <div>
                        <label for="producto-imagen-archivo" class="block text-xs font-semibold uppercase text-[#64748B] mb-1">
                            Foto del producto (opcional)
                        </label>
                        <input
                            id="producto-imagen-archivo"
                            ref="imageInput"
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            :disabled="formDisabled"
                            aria-describedby="producto-imagen-ayuda"
                            class="box-border min-h-11 w-full min-w-0 cursor-pointer rounded-md border border-solid border-[#E2E8F0] bg-white px-2 py-2 font-[inherit] text-sm text-[#0B2438] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                            @change="selectImage"
                        >
                        <p id="producto-imagen-ayuda" class="mt-1 text-xs text-[#64748B]">JPEG, PNG o WebP, hasta 5 MiB.</p>
                        <p v-if="imageError" role="alert" class="mt-1 text-sm text-red-700">{{ imageError }}</p>
                        <img v-if="previewUrl" :src="previewUrl" alt="Vista previa de la foto"
                            class="mt-2 h-28 max-w-full rounded-md object-contain" @error="rejectPreview">
                        <button v-if="imageFile || imageError" type="button" :disabled="formDisabled" @click="clearImage()"
                            class="box-border min-h-11 min-w-11 cursor-pointer border-0 bg-transparent px-2 font-[inherit] text-sm text-[#103A5C] underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]">Quitar selección</button>
                        <ProductThumbnail v-if="product?.imagen" :image="product.imagen" alt="Foto actual del producto"
                            image-class="mt-2 block h-20 max-w-full rounded-md object-contain" />
                        <label for="producto-imagen-url" class="mt-2 block text-xs font-semibold uppercase text-[#64748B] mb-1">URL de Imagen (Opcional)</label>
                        <input
                            id="producto-imagen-url"
                            v-model="form.imagen"
                            type="text"
                            placeholder="https://..."
                            :disabled="formDisabled || Boolean(imageFile)"
                            class="box-border min-h-11 w-full bg-white border border-solid border-[#E2E8F0] rounded-md px-3 py-2 font-[inherit] text-sm text-[#0B2438] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                        >
                    </div>

                    <div>
                        <label class="block text-xs font-semibold uppercase text-[#64748B] mb-1">Descripción Técnica</label>
                        <textarea
                            v-model="form.descripcion"
                            rows="3"
                            :disabled="formDisabled"
                            class="box-border min-h-11 w-full bg-white border border-solid border-[#E2E8F0] rounded-md px-3 py-2 font-[inherit] text-sm text-[#0B2438] resize-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                        ></textarea>
                    </div>

                    <div class="pt-1">
                        <label for="producto-activo" class="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-[#0B2438]">
                            <input
                                id="producto-activo"
                                v-model="form.activo"
                                type="checkbox"
                                :disabled="formDisabled"
                                class="box-border h-5 w-5 shrink-0 cursor-pointer accent-[#103A5C] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                            >
                            <span>Producto Activo (visible en el catálogo público)</span>
                        </label>
                    </div>
                </div>

                <!-- Pie fijo visible en móvil -->
                <div class="shrink-0 p-4 sm:px-6 bg-white border-t border-[#E2E8F0] rounded-b-lg flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
                    <button
                        type="button"
                        @click="requestClose()"
                        :disabled="isSubmitting || isReloading"
                        class="box-border min-h-11 cursor-pointer px-5 py-2 font-[inherit] text-sm font-semibold text-[#64748B] bg-white border border-solid border-[#E2E8F0] rounded-md hover:bg-[#F1F5F9] disabled:cursor-not-allowed disabled:opacity-50 w-full sm:w-auto focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        :disabled="formDisabled || Boolean(imageError)"
                        class="box-border min-h-11 cursor-pointer border-0 px-6 py-2 font-[inherit] text-sm font-semibold text-white bg-[#103A5C] rounded-md hover:bg-[#145A8D] disabled:cursor-not-allowed disabled:opacity-50 w-full sm:w-auto focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
                    >
                        {{ isSubmitting ? (imageFile ? 'Subiendo foto...' : 'Guardando...') : (isEditMode ? (verifyPriceAfterSave ? 'Guardar y verificar' : 'Guardar Cambios') : (verifyPriceAfterSave ? 'Crear y verificar' : 'Crear Producto')) }}
                    </button>
                </div>
            </form>
        </div>
    </dialog>
</template>