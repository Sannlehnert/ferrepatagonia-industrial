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
        class="catalog-filters"
        aria-label="Buscar y filtrar productos"
        @submit.prevent="applyFilters"
    >
        <label class="catalog-filters__field">
            <span>Nombre o código</span>
            <input
                v-model="search"
                type="search"
                placeholder="Buscá un producto"
                :aria-invalid="validationError ? 'true' : undefined"
            />
        </label>

        <label class="catalog-filters__field">
            <span>Categoría</span>
            <select
                v-model="categoryId"
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

        <div class="catalog-filters__actions">
            <button type="submit">Buscar</button>
            <button type="button" @click="clearFilters">
                Limpiar filtros
            </button>
        </div>

        <p v-if="validationError" class="catalog-filters__message" role="alert">
            {{ validationError }}
        </p>

        <p
            v-if="categoriesLoading"
            class="catalog-filters__message"
            role="status"
        >
            Cargando categorías…
        </p>

        <div
            v-else-if="categoriesError"
            class="catalog-filters__message"
        >
            <p role="alert">{{ categoriesError }}</p>
            <button type="button" @click="emit('retryCategories')">
                Reintentar categorías
            </button>
        </div>

        <p
            v-else-if="categories.length === 0"
            class="catalog-filters__message"
            role="status"
        >
            No hay categorías disponibles. Podés buscar por nombre o código.
        </p>
    </form>
</template>

<style scoped>
.catalog-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 1rem;
}

.catalog-filters__field {
    display: flex;
    flex: 1 1 220px;
    flex-direction: column;
    gap: 0.375rem;
    min-width: 0;
}

.catalog-filters input,
.catalog-filters select,
.catalog-filters button {
    box-sizing: border-box;
    min-height: 44px;
    padding: 0.5rem 0.75rem;
    font: inherit;
}

.catalog-filters input,
.catalog-filters select {
    width: 100%;
}

.catalog-filters__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}

.catalog-filters__message {
    flex-basis: 100%;
    margin: 0;
}

.catalog-filters__message p {
    margin: 0 0 0.5rem;
}
</style>