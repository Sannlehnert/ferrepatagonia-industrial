import api from '@/services/api'
import type {
    AdminClient,
    AdminClientsResponse,
} from '@/types/adminClient'

export async function getAdminClients(): Promise<AdminClient[]> {
    const response = await api.get<AdminClientsResponse>('/admin/clientes')
    return response.data.data.clientes
}