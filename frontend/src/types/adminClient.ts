export interface AdminClient {
    id: number
    nombreRazonSocial: string
    email: string
    fechaRegistro: string
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

export interface AdminClientPriceList {
    idListaPrecio: number
    nombre: string
    activa: boolean
}

export interface AdminClientPriceLists {
    listas: AdminPriceListOption[]
    asignaciones: Array<AdminClientPriceList & { idCliente: number }>
}
