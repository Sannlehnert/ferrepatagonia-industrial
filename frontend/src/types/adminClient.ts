export type CompanyApprovalStatus = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';

export interface AdminClient {
    id: number
    nombreRazonSocial: string
    email: string
    fechaRegistro: string
    tipoCliente?: 'PARTICULAR' | 'EMPRESA'
    cuit?: string | null
    docCliente?: string | null
    estadoAprobacionEmpresa?: CompanyApprovalStatus | null
}

export interface AdminClientsResponse {
    message: string
    data: {
        clientes: AdminClient[]
    }
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