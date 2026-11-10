<script setup lang="ts">
import { ref, watch } from 'vue'
import type {
    CatalogCategory,
    CatalogFiltersValue,
} from '@/types/catalog'

const props = withDefaults(
    defineProps<{
        modelValue: CatalogFiltersValue
        categories: readonly CatalogCategory[]
        categoriesLoading?: boolean
        categoriesError?: string | null
    }>(),
    {
        categoriesLoading: false,
        categoriesError: null,
    },
)

const emit = defineEmits<{
    apply: [filters: CatalogFiltersValue]
    retryCategories: []
}>()

const search = ref(props.modelValue.search)
const categoryId = ref<number | null>(props.modelValue.categoryId)
const validationError = ref<string | null>(null)

// Permite reflejar cambios externos, como la navegación del historial.
watch(
    () => [props.modelValue.search, props.modelValue.categoryId] as const,
    ([nextSearch, nextCategoryId]) => {
        search.value = nextSearch
        categoryId.value = nextCategoryId
        validationError.value = null
    },
)

function applyFilters() {
    if (
        [...search.value].length > 200 ||
        /[\u0000-\u001f\u007f]/u.test(search.value)
    ) {
        validationError.value =
            'Usá hasta 200 caracteres y evitá caracteres de control.'
        return
    }

    validationError.value = null

    emit('apply', {
        search: search.value.trim(),
        categoryId: categoryId.value,
    })
}

function clearFilters() {
    search.value = ''
    categoryId.value = null
    validationError.value = null

    emit('apply', {
        search: '',
        categoryId: null,
    })
}
</script>

<template>
    <form
        class="flex flex-wrap items-end gap-4"
        aria-label="Buscar y filtrar productos"
        @submit.prevent="applyFilters"
    >
        <label class="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5">
            <span class="text-sm font-medium">Nombre o código</span>
            <input
                v-model="search"
                type="search"
                placeholder="Buscá un producto"
                class="fp-input fp-focus"
                :aria-invalid="validationError ? 'true' : undefined"
                :aria-describedby="validationError ? 'catalog-search-error' : undefined"
            />
        </label>

        <label class="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5">
            <span class="text-sm font-medium">Categoría</span>
            <select
                v-model="categoryId"
                class="fp-input fp-focus"
                :disabled="categoriesLoading || Boolean(categoriesError)"
            >
                <option :value="null">Todas las categorías</option>

                <!-- Conserva la selección si la lista todavía no está disponible. -->
                <option
                    v-if="
                        categoryId !== null &&
                        !categories.some((category) => category.id === categoryId)
                    "
                    :value="categoryId"
                    disabled
                >
                    Categoría seleccionada no disponible
                </option>

                <option
                    v-for="category in categories"
                    :key="category.id"
                    :value="category.id"
                >
                    {{ category.nombre }}
                </option>
            </select>
        </label>

        <div class="flex flex-wrap gap-2">
            <button class="fp-action fp-action--primary fp-focus" type="submit">Buscar</button>
            <button class="fp-action fp-action--plain fp-focus" type="button" @click="clearFilters">
                Limpiar filtros
            </button>
        </div>

        <p v-if="validationError" id="catalog-search-error" class="fp-error m-0 basis-full text-sm" role="alert">
            {{ validationError }}
        </p>

        <p
            v-if="categoriesLoading"
            class="m-0 basis-full text-sm text-slate-600"
            role="status"
        >
            Cargando categorías…
        </p>

        <div
            v-else-if="categoriesError"
            class="basis-full text-sm text-slate-700"
        >
            <p class="m-0 mb-2" role="alert">{{ categoriesError }}</p>
            <button class="fp-action fp-action--primary fp-focus" type="button" @click="emit('retryCategories')">
                Reintentar categorías
            </button>
        </div>

        <p
            v-else-if="categories.length === 0"
            class="m-0 basis-full text-sm text-slate-600"
            role="status"
        >
            No hay categorías disponibles. Podés buscar por nombre o código.
        </p>
    </form>
</template>
