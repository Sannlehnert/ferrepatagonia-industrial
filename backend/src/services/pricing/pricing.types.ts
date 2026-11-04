export interface PriceProduct {
  id: number;
  baseUSD: string | null;
  specialPercent: string | null;
}
export interface PriceItem { productoId: number; cantidad: number }
export interface PriceRequest { moneda: 'USD' | 'ARS'; productos: PriceItem[] }
export interface PriceList { id: number; active: boolean; percent: string }
export interface PricingClient {
  usuarioId: number;
  clienteId: number;
  active: boolean;
  assignedListId: number | null;
  list: PriceList | null;
}
export interface VerifiedCalendar {
  version: string;
  verifiedBy: string;
  evidence: string;
  verifiedAt: string;
  // Explicit coverage: absent dates are unknown, never assumed business days.
  days: Readonly<Record<string, boolean>>;
}
export interface VerifiedQuote {
  id: string;
  rate: string;
  referenceDate: string;
  loadedAt: string;
  actor: string;
  valid: boolean;
  verifiedAt: string;
  evidence: string;
}
export interface CommercialSnapshot {
  client: PricingClient | null;
  products: PriceProduct[];
  calendar: VerifiedCalendar | null;
  quote: VerifiedQuote | null;
}
export interface PricingSource {
  // Adapter must read one consistent server snapshot, join USUARIO.id_cliente,
  // enforce user/client activity and product/category visibility. null is public.
  // No prices, discounts, customer IDs or list IDs come from the browser.
  load(usuarioId: number | null, productoIds: readonly number[], at: Date): Promise<CommercialSnapshot>;
  // Administrative audit sink only; identifiers never enter the public DTO.
  recordInactiveList(event: { usuarioId: number; clienteId: number; listaId: number; at: string }): Promise<void>;
}
export type PriceState = 'DEFINIDO' | 'PRECIO_AUSENTE' | 'BASE_CERO' | 'FINAL_CERO' | 'ARS_CERO';
export interface PriceLine {
  productoId: number;
  moneda: 'USD' | 'ARS';
  precioBaseUSD: string | null;
  descuentoAplicado: string;
  origenDescuento: 'NINGUNO' | 'LISTA' | 'ESPECIAL_PUBLICO' | 'AMBOS';
  precioUnitarioUSD: string | null;
  cantidad: number;
  subtotalUSD: string | null;
  subtotalARS: string | null;
  estadoPrecio: PriceState;
  precioComprable: boolean;
}
export interface PriceResult {
  regla: 'FER17-v1';
  ivaIncluido: true;
  moneda: 'USD' | 'ARS';
  productos: PriceLine[];
  totalUSD: string | null;
  totalARS: string | null;
  cotizacion: { id: string; valor: string; fechaReferencia: string; fechaCarga: string;
    verificadaEn: string; evidencia: string; calendarioVersion: string } | null;
}
