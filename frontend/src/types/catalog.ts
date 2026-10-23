export interface CatalogCategory {
    id: number
    nombre: string
}

export interface CatalogProduct {
    id: number
    nombre: string
    codigo: string
    categoria: CatalogCategory
    precio: null
    estadoPrecio: 'PENDIENTE_DEFINICION'
    disponible: boolean
}

export interface CatalogPagination {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrevious: boolean
}

export interface CatalogData {
    productos: CatalogProduct[]
    pagination: CatalogPagination
}

export interface CatalogResponse {
    data: CatalogData
}

export interface CatalogQuery {
    page?: number
    limit?: number
    categoria?: number
    busqueda?: string
}