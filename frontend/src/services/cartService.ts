import axios from 'axios'
import api from '@/services/api'
import type { CartSnapshot, CartTransport } from '@/types/cart'

export const cartService: CartTransport = {
  async get(signal) {
    // DTO directo de #245 / PR #66. Sin importes ni totales monetarios.
    const { data } = await api.get<CartSnapshot>('/carrito', { signal })
    if (!Array.isArray(data?.items) || !Number.isSafeInteger(data.id_carrito)) {
      throw new Error('Respuesta de carrito inválida.')
    }
    return data
  },
}

const messages: Record<number, string> = {
  400: 'La solicitud del carrito no es válida.',
  401: 'Iniciá sesión para acceder al carrito.',
  403: 'Tu cuenta no tiene acceso al carrito.',
  404: 'El recurso del carrito no está disponible.',
  409: 'El carrito o la disponibilidad cambiaron.',
  422: 'El carrito no admite la operación solicitada.',
  500: 'El servidor no pudo procesar el carrito.',
}

export function cartErrorMessage(cause: unknown): string {
  const status = axios.isAxiosError(cause) ? cause.response?.status : undefined
  return messages[status ?? 0] ?? 'No se pudo consultar o modificar el carrito. Verificá tu conexión y reintentá la consulta.'
}
