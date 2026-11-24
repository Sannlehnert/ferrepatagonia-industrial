export type CompanyApprovalStatus = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';
export type AdminClientType = 'PARTICULAR' | 'EMPRESA';

export interface AdminClient {
    id: number
    nombreRazonSocial: string
    email: string
    fechaRegistro: string
    tipoCliente?: AdminClientType
    cuit?: string | null
    docCliente?: string | null
    estadoAprobacionEmpresa?: CompanyApprovalStatus | null
}

export interface AdminClientPagination {
    page: number
    limit: number
    total: number
    totalPages: number
}

export interface AdminClientsResponse {
    message: string
    data: {
        clientes: AdminClient[]
        paginacion?: AdminClientPagination
    }
}

export interface AdminClientPage extends AdminClientPagination {
    clientes: AdminClient[]
}

export interface AdminClientFilters {
    page?: number
    limit?: number
    busqueda?: string
    tipo?: AdminClientType
    estadoEmpresa?: CompanyApprovalStatus
}

export interface AdminPriceListOption {
    id: number
    nombre: string
    porcentajeDescuento: string
}

export type AdminPriceList = AdminPriceListOption & { activa: boolean }
export type AdminPriceListInput = Omit<AdminPriceList, 'id'>

export interface AdminClientPriceList {
    idListaPrecio: number
    nombre: string
    activa: boolean
}

export interface AdminClientPriceLists {
    listas: AdminPriceListOption[]
    asignaciones: Array<AdminClientPriceList & { idCliente: number }>
}
