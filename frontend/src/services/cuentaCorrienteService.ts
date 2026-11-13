import api from '@/services/api'
import type {
    CuentaCorrienteConsulta,
    CuentaCorrientePaginaMovimientos,
    CuentaCorrientePaginaVencimientos,
} from '@/types/cuentaCorriente'

const PAGE_SIZE = 25

function pageParams(cursor?: string) {
    return {
        limite: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
    }
}

export async function getCuentaCorriente(signal?: AbortSignal): Promise<CuentaCorrienteConsulta> {
    const response = await api.get<{ data: CuentaCorrienteConsulta }>('/cuenta-corriente', { signal })
    return response.data.data
}

export async function getCuentaCorrienteMovimientos(
    cursor?: string,
): Promise<CuentaCorrientePaginaMovimientos> {
    const response = await api.get<{ data: CuentaCorrientePaginaMovimientos }>(
        '/cuenta-corriente/movimientos',
        { params: pageParams(cursor) },
    )
    return response.data.data
}

export async function getCuentaCorrienteVencimientos(
    cursor?: string,
): Promise<CuentaCorrientePaginaVencimientos> {
    const response = await api.get<{ data: CuentaCorrientePaginaVencimientos }>(
        '/cuenta-corriente/vencimientos',
        { params: pageParams(cursor) },
    )
    return response.data.data
}
