import api from '@/services/api'
import type {
    AdminClient,
    AdminClientPriceList,
    AdminClientPriceLists,
    AdminClientsResponse,
} from '@/types/adminClient'

export async function getAdminClients(): Promise<AdminClient[]> {
    const response = await api.get<AdminClientsResponse>('/admin/clientes')
    return response.data.data.clientes
}

export async function getAdminClientPriceLists(): Promise<AdminClientPriceLists> {
    const response = await api.get<{ data: AdminClientPriceLists }>('/admin/clientes/listas-precio')
    return response.data.data
}

export async function saveAdminClientPriceList(idCliente: number, idListaPrecio: number | null) {
    const response = await api.put<{ data: { lista: AdminClientPriceList | null } }>(
        `/admin/clientes/${idCliente}/lista-precio`,
        { idListaPrecio },
    )
    return response.data.data.lista
}
