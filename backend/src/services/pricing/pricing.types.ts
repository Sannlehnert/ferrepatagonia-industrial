export interface PriceProduct {
  id: number;
  baseUSD: string | null;
  specialPercent: string | null;
  baseVerified?: boolean;
  evidence?: { reference: string; verifiedAt: string; synthetic: boolean };
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
  synthetic?: boolean;
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
  synthetic?: boolean;
}
export interface CommercialSnapshot {
  client: PricingClient | null;
  products: PriceProduct[];
  calendar: VerifiedCalendar | null;
  quote: VerifiedQuote | null;
  recordInactiveList?: PricingSource['recordInactiveList'];
}
export interface PricingSource {
  // Adapter must read one consistent server snapshot, join USUARIO.id_cliente,
  // enforce user/client activity and product/category visibility. null is public.
  // No prices, discounts, customer IDs or list IDs come from the browser.
  load(usuarioId: number | null, productoIds: readonly number[], at: Date, currency?: 'USD' | 'ARS'): Promise<CommercialSnapshot>;
  withSnapshot?<T>(usuarioId: number | null, productoIds: readonly number[], at: Date,
    work: (snapshot: CommercialSnapshot) => Promise<T>, currency?: 'USD' | 'ARS'): Promise<T>;
  // Administrative audit sink only; identifiers never enter the public DTO.
  recordInactiveList(event: { usuarioId: number; clienteId: number; listaId: number; at: string }): Promise<void>;
}
export type PriceState = 'DEFINIDO' | 'PRECIO_AUSENTE' | 'BASE_CERO' | 'BASE_NO_VERIFICADA' | 'FINAL_CERO' | 'ARS_CERO';
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
  evidenciaBaseUSD?: PriceProduct['evidence'];
}
export interface PriceResult {
  regla: 'FER17-v1';
  ivaIncluido: true;
  moneda: 'USD' | 'ARS';
  datosSinteticos: boolean;
  productos: PriceLine[];
  totalUSD: string | null;
  totalARS: string | null;
  cotizacion: { id: string; valor: string; fechaReferencia: string; fechaCarga: string;
    verificadaEn: string; evidencia: string; calendarioVersion: string; calendarioEvidencia: string;
    calendarioVerificadoEn: string; sintetica: boolean } | null;
}
