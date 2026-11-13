// Public response contract from docs/api/precios.md (FER17-v1).
export type PriceState = 'DEFINIDO' | 'PRECIO_AUSENTE' | 'BASE_CERO' | 'BASE_NO_VERIFICADA' | 'FINAL_CERO' | 'ARS_CERO'
export interface PriceLine {
  compraAcademica?: true
  productoId: number
  moneda: 'USD' | 'ARS'
  precioBaseUSD: string | null
  descuentoAplicado: string
  origenDescuento: 'NINGUNO' | 'LISTA' | 'ESPECIAL_PUBLICO' | 'AMBOS'
  precioUnitarioUSD: string | null
  cantidad: number
  subtotalUSD: string | null
  subtotalARS: string | null
  estadoPrecio: PriceState
  precioComprable: boolean
  evidenciaBaseUSD?: { reference: string; verifiedAt: string; synthetic: boolean }
}
export interface USDPriceResult {
  regla: 'FER17-v1'
  ivaIncluido: true
  moneda: 'USD'
  datosSinteticos: boolean
  productos: PriceLine[]
  totalUSD: string | null
  totalARS: null
  cotizacion: null
}
