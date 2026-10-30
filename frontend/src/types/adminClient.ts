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