import axios from 'axios'
import api from '@/services/api'
import type {
  ConfirmedTransferOrder,
  PendingTransferOrder,
  TransferOrderAttempt,
  TransferOrderEligibility,
  TransferOrderTransport,
} from '@/types/transferOrder'

function isMoney(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d{0,9})\.\d{2}$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseEligibility(value: unknown): TransferOrderEligibility {
  if (
    !isRecord(value) ||
    typeof value.elegible !== 'boolean' ||
    value.modalidadPago !== 'TRANSFERENCIA' ||
    value.moneda !== 'USD' ||
    (value.simulado !== undefined && value.simulado !== true) ||
    (value.totalUSD !== null && !isMoney(value.totalUSD)) ||
    (value.codigo !== null && typeof value.codigo !== 'string') ||
    (value.mensaje !== null && typeof value.mensaje !== 'string') ||
    (value.cotizacion !== null && typeof value.cotizacion !== 'string') ||
    (value.elegible && (
      !isMoney(value.totalUSD) ||
      value.totalUSD === '0.00' ||
      value.codigo !== null ||
      value.mensaje !== null ||
      typeof value.cotizacion !== 'string'
    ))
  ) {
    throw new Error('La respuesta de elegibilidad de transferencia no es válida.')
  }

  return {
    elegible: value.elegible,
    modalidadPago: 'TRANSFERENCIA',
    moneda: 'USD',
    totalUSD: value.totalUSD,
    codigo: value.codigo,
    mensaje: value.mensaje,
    cotizacion: value.cotizacion,
    ...(value.simulado === true ? { simulado: true as const } : {}),
  }
}

function parseAttempt(value: unknown, status: number): TransferOrderAttempt {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error('La respuesta de confirmación por transferencia no es válida.')
  }

  const data = value.data
  if (status === 202 && data.estado === 'PENDIENTE' &&
      data.code === 'CONFIRMACION_PENDIENTE' && typeof data.message === 'string') {
    const result: PendingTransferOrder = {
      estado: 'PENDIENTE',
      code: 'CONFIRMACION_PENDIENTE',
      message: data.message,
    }
    return { estado: 'PENDIENTE', result }
  }

  if (
    (status === 200 || status === 201) &&
    data.estado === 'CONFIRMADO' &&
    typeof data.pedidoId === 'number' &&
    Number.isSafeInteger(data.pedidoId) &&
    data.modalidadPago === 'TRANSFERENCIA' &&
    data.moneda === 'USD' &&
    (data.simulado === undefined || data.simulado === true) &&
    isMoney(data.totalUSD) &&
    data.totalUSD !== '0.00'
  ) {
    const result: ConfirmedTransferOrder = {
      pedidoId: data.pedidoId,
      estado: 'CONFIRMADO',
      modalidadPago: 'TRANSFERENCIA',
      moneda: 'USD',
      totalUSD: data.totalUSD,
      ...(data.simulado === true ? { simulado: true as const } : {}),
    }
    return { estado: 'CONFIRMADO', result }
  }

  throw new Error('La respuesta de confirmación por transferencia no es válida.')
}

export const transferOrderService: TransferOrderTransport = {
  async getEligibility(signal) {
    const { data } = await api.get<{ data: unknown }>(
      '/pedidos/transferencia/eligibilidad',
      { signal },
    )
    return parseEligibility(data?.data)
  },
  async confirm(key, quoteToken, signal) {
    const response = await api.post<{ data: unknown }>(
      '/pedidos/transferencia',
      { cotizacion: quoteToken },
      { signal, headers: { 'Idempotency-Key': key } },
    )
    return parseAttempt(response.data, response.status)
  },
  async recover(key, signal) {
    const response = await api.get<{ data: unknown }>(
      `/pedidos/transferencia/${encodeURIComponent(key)}`,
      { signal },
    )
    return parseAttempt(response.data, response.status)
  },
}

export function transferOrderErrorMessage(error: unknown): string {
  if (!axios.isAxiosError<{ code?: string; message?: string }>(error)) {
    return 'No se pudo confirmar el resultado. Consultá el estado antes de volver a intentar.'
  }

  const status = error.response?.status
  const message = error.response?.data?.message
  if (typeof message === 'string' && message.trim()) return message
  if (status === 401) return 'Tu sesión venció. Iniciá sesión y consultá nuevamente el pedido.'
  if (status === 403) return 'La cuenta de cliente no está habilitada para confirmar pedidos.'
  if (status === 422) return 'El servidor no pudo validar las condiciones del pedido.'
  if (status === 503) return 'No se pudo determinar el resultado. Consultá el estado antes de reintentar.'
  return 'No se pudo confirmar el pedido. Consultá el estado antes de reintentar.'
}
