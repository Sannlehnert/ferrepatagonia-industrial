import api from '@/services/api'
import type {
    AdminClient,
    AdminClientFilters,
    AdminClientPage,
    AdminClientPriceList,
    AdminClientPriceLists,
    AdminPriceList,
    AdminPriceListInput,
    AdminClientsResponse,
    CompanyApprovalStatus,
} from '@/types/adminClient'

export async function getAdminClients(): Promise<AdminClient[]> {
    const response = await api.get<AdminClientsResponse>('/admin/clientes')
    return response.data.data.clientes
}

export async function getAdminClientPage(
    filters: AdminClientFilters = {},
    signal?: AbortSignal,
): Promise<AdminClientPage> {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 20
    const params: Record<string, string | number> = { page, limit }

    if (filters.busqueda) params.busqueda = filters.busqueda
    if (filters.tipo) params.tipo = filters.tipo
    if (filters.estadoEmpresa) params.estadoEmpresa = filters.estadoEmpresa

    const response = await api.get<AdminClientsResponse>('/admin/clientes', {
        params,
        ...(signal ? { signal } : {}),
    })
    const data = response.data.data
    const pagination = data.paginacion ?? {
        page,
        limit,
        total: data.clientes.length,
        totalPages: data.clientes.length === 0 ? 0 : Math.ceil(data.clientes.length / limit),
    }

    return { clientes: data.clientes, ...pagination }
}

export async function updateAdminCompanyApproval(
    idCliente: number,
    estado: CompanyApprovalStatus,
): Promise<AdminClient> {
    const response = await api.patch<{ data: { cliente: AdminClient }; message: string }>(
        `/admin/clientes/${idCliente}/estado-empresa`,
        { estado },
    )
    return response.data.data.cliente
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

export async function getAdminPriceLists() {
    const response = await api.get<{ data: { listas: AdminPriceList[] } }>('/admin/listas-precio')
    return response.data.data.listas
}

export async function saveAdminPriceList(input: AdminPriceListInput, id?: number) {
    const response = id === undefined
        ? await api.post<{ data: { lista: AdminPriceList } }>('/admin/listas-precio', input)
        : await api.put<{ data: { lista: AdminPriceList } }>(`/admin/listas-precio/${id}`, input)
    return response.data.data.lista
}