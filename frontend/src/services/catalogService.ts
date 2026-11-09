import api from '@/services/api'
import type {
    CatalogCategory,
    CatalogCategoriesResponse,
    CatalogData,
    CatalogProductDetail,
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

export async function getCatalogProduct(
    id: number,
    signal?: AbortSignal,
): Promise<CatalogProductDetail> {
    if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
        throw new Error('Identificador de producto inválido.')
    }
    const response = await api.get<{ data?: { producto?: CatalogProductDetail } }>(
        `/catalogo/${id}`,
        { signal },
    )
    const product = response.data?.data?.producto
    if (!product || product.id !== id || !Number.isSafeInteger(product.id) ||
        typeof product.nombre !== 'string' || typeof product.codigo !== 'string' ||
        !(product.descripcion === null || typeof product.descripcion === 'string') ||
        !(product.imagen === null || typeof product.imagen === 'string') ||
        !Number.isSafeInteger(product.stock) || product.stock < 0 ||
        !Number.isSafeInteger(product.categoria?.id) || product.categoria.id < 1 ||
        typeof product.categoria.nombre !== 'string' || product.precio !== null ||
        product.estadoPrecio !== 'PENDIENTE_DEFINICION' || product.disponible !== (product.stock > 0)) {
        throw new Error('La respuesta del detalle del catálogo no es válida.')
    }
    return product
}
