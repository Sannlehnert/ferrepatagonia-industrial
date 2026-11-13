import axios from 'axios'
import api from '@/services/api'
import type { PriceLine, USDPriceResult } from '@/types/pricing'

const decimal = /^(0|[1-9]\d{0,9})\.\d{2}$/
const states = ['DEFINIDO', 'PRECIO_AUSENTE', 'BASE_CERO', 'BASE_NO_VERIFICADA', 'FINAL_CERO', 'ARS_CERO']

// Exact strings only. This predicate describes price eligibility, never stock or checkout authorization.
export function precioComprable(line: PriceLine | undefined): boolean {
  return !!line && line.estadoPrecio === 'DEFINIDO' && line.precioComprable === true &&
    typeof line.precioUnitarioUSD === 'string' && decimal.test(line.precioUnitarioUSD) &&
    line.precioUnitarioUSD !== '0.00' && typeof line.precioBaseUSD === 'string' &&
    decimal.test(line.precioBaseUSD) && line.precioBaseUSD !== '0.00' &&
    typeof line.evidenciaBaseUSD?.reference === 'string' && !!line.evidenciaBaseUSD.reference.trim() &&
    typeof line.evidenciaBaseUSD.verifiedAt === 'string' && Number.isFinite(Date.parse(line.evidenciaBaseUSD.verifiedAt)) &&
    (line.evidenciaBaseUSD.synthetic === false ||
      (line.evidenciaBaseUSD.synthetic === true && line.compraAcademica === true))
}

export async function getPrices(ids: readonly number[], personalized: boolean, signal?: AbortSignal): Promise<PriceLine[]> {
  const unique = [...new Set(ids)]
  if (unique.some(id => !Number.isInteger(id) || id < 1 || id > 2147483647)) {
    throw new Error('Identificador de producto inválido.')
  }
  const lines: PriceLine[] = []
  // Each HTTP request respects the backend limit. A caller publishes only the complete result.
  for (let start = 0; start < unique.length; start += 100) {
    const batch = unique.slice(start, start + 100)
    const { data } = await api.post<{ data: USDPriceResult }>(personalized ? '/precios/mios' : '/precios', {
      moneda: 'USD', productos: batch.map(productoId => ({ productoId, cantidad: 1 })),
    }, { signal })
    const result = data.data
    if (!result || result.regla !== 'FER17-v1' || result.ivaIncluido !== true ||
      result.moneda !== 'USD' || !Array.isArray(result.productos) ||
      (result.datosSinteticos !== false && !(personalized && result.datosSinteticos === true &&
        result.productos.some(p => p.evidenciaBaseUSD?.synthetic === true) &&
        result.productos.every(p => p.evidenciaBaseUSD?.synthetic !== true || p.compraAcademica === true))) ||
      result.productos.length !== batch.length || new Set(result.productos.map(p => p.productoId)).size !== batch.length ||
      result.productos.some(p => !batch.includes(p.productoId) || p.cantidad !== 1 || p.moneda !== 'USD' ||
        !states.includes(p.estadoPrecio) || typeof p.precioComprable !== 'boolean' ||
        !/^\d{1,2}\.\d{2}$/.test(p.descuentoAplicado) ||
        !['NINGUNO', 'LISTA', 'ESPECIAL_PUBLICO', 'AMBOS'].includes(p.origenDescuento) ||
        (p.estadoPrecio === 'DEFINIDO' && !precioComprable(p)))) {
      throw new Error('Respuesta de precios no acreditada.')
    }
    lines.push(...result.productos)
  }
  return lines
}

export function priceErrorMessage(error: unknown): string {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined
  if (status === 401) return 'La sesión venció. Iniciá sesión para consultar tus precios.'
  if (status === 403) return 'No tenés permiso para consultar estos precios.'
  if (status === 404) return 'Un producto cambió o ya no está disponible. Actualizá el catálogo.'
  if (status === 422) return 'Los datos comerciales no permiten confirmar los precios.'
  return 'No se pudieron obtener precios verificados. Podés reintentar.'
}
