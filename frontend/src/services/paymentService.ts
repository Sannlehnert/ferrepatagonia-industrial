import axios, { isAxiosError } from 'axios'
import api from '@/services/api'
import type {
    ClientPayment,
    ClientPaymentPage,
    DeclarePaymentPayload,
    DeclarePaymentResult,
} from '@/types/payment'

const UNCERTAIN_CODES = new Set([
    'RESULTADO_DESCONOCIDO',
    'CONFLICTO_CONCURRENCIA',
])

export async function listClientPayments(
    pagina: number,
    signal?: AbortSignal,
): Promise<ClientPaymentPage> {
    const response = await api.get<{ data: ClientPaymentPage }>('/cuenta-corriente/pagos', {
        params: { pagina },
        signal,
    })
    return response.data.data
}

export async function getClientPayment(
    id: number,
    signal?: AbortSignal,
): Promise<ClientPayment> {
    const response = await api.get<{ data: ClientPayment }>(`/cuenta-corriente/pagos/${id}`, { signal })
    return response.data.data
}

export async function declareClientPayment(
    payload: DeclarePaymentPayload,
    idempotencyKey: string,
    signal?: AbortSignal,
): Promise<DeclarePaymentResult> {
    const response = await api.post<{
        data: ClientPayment
        meta?: { replay?: boolean }
    }>('/cuenta-corriente/pagos', payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
        signal,
    })
    return {
        payment: response.data.data,
        replay: response.data.meta?.replay === true,
    }
}

export async function findClientPaymentByReceipt(
    receiptId: string,
    signal?: AbortSignal,
    maxPages = 10,
): Promise<ClientPayment | null> {
    let pagina = 1
    for (let visited = 0; visited < maxPages; visited++) {
        const result = await listClientPayments(pagina, signal)
        const match = result.items.find(item => item.comprobanteId === receiptId)
        if (match) return match
        if (result.paginaSiguiente === null) return null
        pagina = result.paginaSiguiente
    }
    return null
}

export function paymentErrorCode(error: unknown): string | null {
    if (!isAxiosError(error)) return null
    const code = error.response?.data?.code
    return typeof code === 'string' ? code : null
}

export function paymentErrorStatus(error: unknown): number | null {
    if (!isAxiosError(error)) return null
    return error.response?.status ?? null
}

export function isUncertainDeclarationError(error: unknown): boolean {
    if (!isAxiosError(error)) return true
    const status = error.response?.status
    if (status === undefined) return true
    if (status >= 500) return true
    const code = paymentErrorCode(error)
    return code !== null && UNCERTAIN_CODES.has(code)
}

export function paymentErrorMessage(error: unknown, fallback: string): string {
    if (!isAxiosError(error)) return fallback
    const status = error.response?.status
    if (status === undefined) {
        return 'No se pudo confirmar la comunicación con el servidor. Verificá tu conexión antes de reintentar.'
    }
    if (status === 401) return 'Tu sesión expiró. Iniciá sesión nuevamente para continuar.'
    if (status === 403) return 'No tenés permiso para realizar esta operación.'

    const code = paymentErrorCode(error)
    const messages: Record<string, string> = {
        COMPROBANTE_NO_ENCONTRADO: 'No encontramos ese comprobante entre los de tu cuenta. Elegí un comprobante propio ya cargado.',
        COMPROBANTE_YA_DECLARADO: 'Ese comprobante ya tiene una declaración registrada. Consultá el historial de pagos.',
        CLAVE_IDEMPOTENCIA_REUTILIZADA: 'La clave de idempotencia ya fue utilizada con otros datos. Revisá la declaración antes de volver a enviarla.',
        CLAVE_IDEMPOTENCIA_REQUERIDA: 'No se pudo generar una clave de idempotencia válida. Recargá la página e intentá nuevamente.',
        CUENTA_NO_ENCONTRADA: 'No encontramos una cuenta corriente habilitada para declarar el pago.',
        CUENTA_RESTRINGIDA: 'La cuenta corriente tiene un libro restringido y no admite esta operación.',
        CUENTA_NO_ACREDITADA: 'La cuenta corriente no tiene cobertura histórica completa para esta operación.',
        CLIENTE_INACTIVO: 'La cuenta de cliente no está habilitada.',
        PAGO_NO_ENCONTRADO: 'No encontramos el pago solicitado.',
        PAGO_PENDIENTE_REVISION: 'El pago todavía debe tener la revisión documental aprobada.',
        PAGO_YA_ACREDITADO: 'El pago ya fue acreditado.',
        PAGO_YA_REVISADO: 'La revisión documental del pago ya fue resuelta.',
        TRANSICION_PAGO_INVALIDA: 'El pago no se encuentra en un estado que permita la operación.',
        MONTO_USD_INVALIDO: 'El importe no puede convertirse a un monto USD válido.',
        COTIZACION_AUSENTE: 'No existe una cotización verificada para la fecha de acreditación.',
        COTIZACION_INVALIDA: 'La cotización de la fecha de acreditación no es válida o no está verificada.',
        CONFLICTO_CONCURRENCIA: 'La operación encontró un cambio concurrente. Consultá el estado antes de reintentar.',
        RESULTADO_DESCONOCIDO: 'No se pudo confirmar el resultado de la operación. Conservamos la misma clave para evitar duplicados.',
        CONSULTA_INVALIDA: 'La consulta de pagos no es válida.',
        NO_AUTENTICADO: 'Tu sesión expiró. Iniciá sesión nuevamente para continuar.',
        SIN_PERMISO: 'No tenés permiso para realizar esta operación.',
    }
    if (code && Object.hasOwn(messages, code)) return messages[code]!

    if (status >= 500) {
        return 'El servidor no pudo confirmar la operación. No se generará una nueva declaración automáticamente.'
    }
    const serverMessage = error.response?.data?.message
    if (typeof serverMessage === 'string' && serverMessage.length > 0 && serverMessage.length <= 300) {
        return serverMessage
    }
    return fallback
}
