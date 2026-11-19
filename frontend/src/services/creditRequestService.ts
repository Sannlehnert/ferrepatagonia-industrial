import axios from 'axios'
import api from '@/services/api'
import type { CreateCreditRequestPayload, CreditRequest } from '@/types/creditRequest'

interface CreditRequestListResponse {
    items: CreditRequest[]
    siguienteAntesDeId: number | null
}

export async function getClientCreditRequests(signal?: AbortSignal): Promise<CreditRequest[]> {
    const response = await api.get<{ data: CreditRequestListResponse }>(
        '/cuenta-corriente/solicitudes',
        { params: { limite: 25 }, signal },
    )
    return response.data.data.items
}

export async function createClientCreditRequest(
    payload: CreateCreditRequestPayload,
    idempotencyKey: string,
): Promise<CreditRequest> {
    const response = await api.post<{ data: { solicitud: CreditRequest } }>(
        '/cuenta-corriente/solicitudes',
        payload,
        { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    return response.data.data.solicitud
}

export function isDefinitiveCreditRequestRejection(error: unknown): boolean {
    if (!axios.isAxiosError<{ code?: string }>(error)) return false
    const status = error.response?.status
    return status === 400 || status === 422 ||
        (status === 409 && error.response?.data?.code === 'SOLICITUD_PENDIENTE')
}

export function isPendingCreditRequestConflict(error: unknown): boolean {
    return axios.isAxiosError<{ code?: string }>(error) &&
        error.response?.status === 409 && error.response.data?.code === 'SOLICITUD_PENDIENTE'
}

export function creditRequestErrorMessage(error: unknown): string {
    if (!axios.isAxiosError<{ code?: string; message?: string }>(error)) {
        return 'No se pudo completar la operación de crédito. Intentá nuevamente.'
    }

    const status = error.response?.status
    const code = error.response?.data?.code
    const message = error.response?.data?.message
    if (typeof message === 'string' && message.trim()) return message
    if (status === 401) return 'Tu sesión venció. Iniciá sesión y consultá nuevamente.'
    if (status === 403) return 'Tu empresa no está habilitada para solicitar crédito.'
    if (status === 409 && code === 'SOLICITUD_PENDIENTE') {
        return 'Ya existe una solicitud pendiente de resolución.'
    }
    if (status === 503) {
        return 'No se pudo confirmar el resultado. Reintentá sin cambiar los datos de la solicitud.'
    }
    return 'No se pudo completar la operación de crédito. Intentá nuevamente.'
}
