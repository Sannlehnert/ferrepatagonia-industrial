import axios from 'axios'
import api from '@/services/api'
import type {
  AccountOrderAttempt,
  AccountOrderEligibility,
  AccountOrderTransport,
  ConfirmedAccountOrder,
  PendingAccountOrder,
} from '@/types/accountOrder'

function isMoney(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d{0,9})\.\d{2}$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function parseEligibility(value: unknown): AccountOrderEligibility {
  if (
    !isRecord(value) ||
    typeof value.elegible !== 'boolean' ||
    value.moneda !== 'USD' ||
    (value.totalUSD !== null && !isMoney(value.totalUSD)) ||
    (value.creditoDisponibleUSD !== null && !isMoney(value.creditoDisponibleUSD)) ||
    (value.codigo !== null && typeof value.codigo !== 'string') ||
    (value.mensaje !== null && typeof value.mensaje !== 'string') ||
    (value.elegible && (
      !isMoney(value.totalUSD) ||
      value.totalUSD === '0.00' ||
      !isMoney(value.creditoDisponibleUSD) ||
      value.codigo !== null ||
      value.mensaje !== null
    ))
  ) {
    throw new Error('La respuesta de elegibilidad no es válida.')
  }
  return {
    elegible: value.elegible,
    moneda: 'USD',
    totalUSD: value.totalUSD,
    creditoDisponibleUSD: value.creditoDisponibleUSD,
    codigo: value.codigo,
    mensaje: value.mensaje,
  }
}

function parseAttempt(value: unknown, status: number): AccountOrderAttempt {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error('La respuesta de confirmación no es válida.')
  }

  const data = value.data
  if (status === 202 && data.estado === 'PENDIENTE' &&
      data.code === 'CONFIRMACION_PENDIENTE' && typeof data.message === 'string') {
    return {
      estado: 'PENDIENTE',
      result: {
        estado: 'PENDIENTE',
        code: 'CONFIRMACION_PENDIENTE',
        message: data.message,
      },
    }
  }

  if (
    (status === 200 || status === 201) &&
    data.estado === 'CONFIRMADO' &&
    typeof data.pedidoId === 'number' &&
    Number.isSafeInteger(data.pedidoId) &&
    data.modalidadPago === 'CUENTA_CORRIENTE' &&
    data.moneda === 'USD' &&
    isMoney(data.totalUSD) &&
    data.totalUSD !== '0.00' &&
    typeof data.cargoId === 'string' &&
    /^\d+$/.test(data.cargoId) &&
    isValidDate(data.venceEl)
  ) {
    return {
      estado: 'CONFIRMADO',
      result: {
        pedidoId: data.pedidoId,
        estado: 'CONFIRMADO',
        modalidadPago: 'CUENTA_CORRIENTE',
        moneda: 'USD',
        totalUSD: data.totalUSD,
        cargoId: data.cargoId,
        venceEl: data.venceEl,
      },
    }
  }

  throw new Error('La respuesta de confirmación no es válida.')
}

export const accountOrderService: AccountOrderTransport = {
  async getEligibility(signal) {
    const { data } = await api.get<{ data: unknown }>(
      '/pedidos/cuenta-corriente/eligibilidad',
      { signal },
    )
    return parseEligibility(data?.data)
  },
  async confirm(key, signal) {
    const response = await api.post<{ data: unknown }>(
      '/pedidos/cuenta-corriente',
      {},
      { signal, headers: { 'Idempotency-Key': key } },
    )
    return parseAttempt(response.data, response.status)
  },
  async recover(key, signal) {
    const response = await api.get<{ data: unknown }>(
      `/pedidos/cuenta-corriente/${encodeURIComponent(key)}`,
      { signal },
    )
    return parseAttempt(response.data, response.status)
  },
}

export function accountOrderErrorMessage(error: unknown): string {
  if (!axios.isAxiosError<{ code?: string; message?: string }>(error)) {
    return 'No se pudo confirmar el resultado. Consultá el estado antes de volver a intentar.'
  }

  const status = error.response?.status
  const code = error.response?.data?.code
  const message = error.response?.data?.message
  if (typeof message === 'string' && message.trim()) return message
  if (status === 401) return 'Tu sesión venció. Iniciá sesión y consultá nuevamente el pedido.'
  if (status === 403) return 'La cuenta no está habilitada para confirmar pedidos a crédito.'
  if (status === 409 && code === 'CREDITO_INSUFICIENTE') {
    return 'El crédito disponible no alcanza para confirmar este pedido.'
  }
  if (status === 422) return 'El servidor no pudo validar las condiciones del pedido.'
  if (status === 503) return 'No se pudo determinar el resultado. Consultá el estado antes de reintentar.'
  return 'No se pudo confirmar el pedido. Consultá el estado antes de reintentar.'
}
