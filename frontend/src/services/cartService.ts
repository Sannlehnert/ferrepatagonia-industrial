import axios from 'axios'
import api from '@/services/api'
import type { CartSnapshot, CartTransport } from '@/types/cart'

export const cartService: CartTransport = {
  async get(signal) {
    const read = () => api.get<CartSnapshot>('/carrito', { signal })
    const { data } = await read().catch(async error => {
      if (!axios.isAxiosError<{ code?: string }>(error) ||
          error.response?.status !== 409 || error.response.data?.code !== 'CONFLICTO_CARRITO') throw error
      // Las pestañas pueden reconciliar el mismo aviso al mismo tiempo.
      await new Promise(resolve => setTimeout(resolve, 150))
      signal.throwIfAborted()
      return read()
    })
    if (!Array.isArray(data?.items) || !Number.isSafeInteger(data.id_carrito) ||
        data.moneda !== 'USD' || data.regla !== 'FER17-v1' || data.ivaIncluido !== true ||
        (data.totalUSD !== null && typeof data.totalUSD !== 'string')) {
      throw new Error('Respuesta de carrito inválida.')
    }
    return data
  },
  async mutate(command, signal) {
    const items = '/carrito/items'
    const line = `${items}/${command.productoId}`
    const { status } = command.type === 'add'
      ? await api.post(items, { productoId: command.productoId, cantidad: command.cantidad }, { signal })
      : command.type === 'update'
        ? await api.patch(line, { cantidad: command.cantidad }, { signal })
        : await api.delete(line, { signal })
    if (status !== 204) throw new Error('La respuesta no confirmó la operación del carrito.')
  },
}

const messages: Record<number, string> = {
  400: 'La solicitud del carrito no es válida.',
  401: 'Iniciá sesión para acceder al carrito.',
  403: 'Tu cuenta no tiene acceso al carrito.',
  404: 'El producto o la línea del carrito no existe.',
  409: 'Hubo un conflicto en el carrito. Revisá su estado antes de volver a operar.',
  422: 'El carrito no admite la operación solicitada.',
  500: 'El servidor no pudo procesar el carrito.',
}

const rejectionMessages: Record<string, string> = {
  CANTIDAD_INVALIDA: 'La cantidad solicitada no es válida.',
  STOCK_INSUFICIENTE: 'El stock disponible es insuficiente.',
  PRODUCTO_INACTIVO: 'El producto está inactivo.',
  PRECIO_AUSENTE: 'El producto no tiene precio.',
  BASE_CERO: 'El precio base del producto es cero.',
  BASE_NO_VERIFICADA: 'El precio base en USD no está verificado.',
  FINAL_CERO: 'El precio final del producto es cero.',
  IMPORTE_FUERA_DE_RANGO: 'El importe supera el rango permitido.',
  DATOS_COMERCIALES_INVALIDOS: 'Los datos comerciales del producto no son válidos.',
}

export function cartErrorMessage(cause: unknown): string {
  const response = axios.isAxiosError<{ code?: string }>(cause) ? cause.response : undefined
  const status = response?.status
  const code = response?.data?.code
  if (status === 500 && code === 'DATABASE_OUTCOME_UNKNOWN') {
    return 'No se pudo confirmar el resultado de la operación. Revisá el estado del carrito.'
  }
  if (status === 422 && typeof code === 'string' && Object.hasOwn(rejectionMessages, code)) {
    return rejectionMessages[code]!
  }
  return messages[status ?? 0] ?? 'No se pudo consultar o modificar el carrito. Verificá tu conexión y reintentá la consulta.'
}
