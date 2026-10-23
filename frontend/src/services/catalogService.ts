import api from '@/services/api'
import type {
    CatalogCategory,
    CatalogCategoriesResponse,
    CatalogData,
    CatalogQuery,
    CatalogResponse,
} from '@/types/catalog'

export async function getCatalog(
    query: CatalogQuery = {},
    signal?: AbortSignal,
): Promise<CatalogData> {
    const params: CatalogQuery = {}

    if (query.page !== undefined) {
        params.page = query.page
    }

    if (query.limit !== undefined) {
        params.limit = query.limit
    }

    if (query.categoria !== undefined) {
        params.categoria = query.categoria
    }

    // Una búsqueda vacía representa la ausencia de filtro.
    // Se conserva el texto original para que el backend aplique sus validaciones.
    if (query.busqueda !== undefined && query.busqueda.trim() !== '') {
        params.busqueda = query.busqueda
    }

    const response = await api.get<CatalogResponse>('/catalogo', {
        params,
        signal,
    })

    return response.data.data
}

export async function getCatalogCategories(
    signal?: AbortSignal,
): Promise<CatalogCategory[]> {
    const response = await api.get<CatalogCategoriesResponse>(
        '/categorias',
        { signal },
    )

    return response.data.data.categorias
}