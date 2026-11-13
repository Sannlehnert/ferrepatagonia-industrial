import type { AuthContext } from '../../types/auth';
import { bounded, decimal, format, MONEY_MAX, PricingError } from './money';
import { calculateLine } from './pricing.engine';
import { resolveQuote } from './pricing.quote';
import type { CommercialSnapshot, PriceItem, PriceLine, PriceRequest, PriceResult, PricingSource } from './pricing.types';

export function parsePriceRequest(input: unknown): PriceRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PricingError('SOLICITUD_INVALIDA', 400);
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => !['moneda', 'productos'].includes(key))
    || !['USD', 'ARS'].includes(body.moneda as string) || !Array.isArray(body.productos)
    || body.productos.length < 1 || body.productos.length > 100) throw new PricingError('SOLICITUD_INVALIDA', 400);
  const ids = new Set<number>();
  for (const item of body.productos) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some(key => !['productoId', 'cantidad'].includes(key))
      || !Number.isInteger(item.productoId) || item.productoId < 1 || item.productoId > 2147483647
      || !Number.isInteger(item.cantidad) || item.cantidad < 1 || item.cantidad > 2147483647
      || ids.has(item.productoId)) throw new PricingError('SOLICITUD_INVALIDA', 400);
    ids.add(item.productoId);
  }
  return body as unknown as PriceRequest;
}

export const sumAmounts = (amounts: readonly string[]): string =>
  format(bounded(amounts.reduce((total, amount) => total + decimal(amount, 2, MONEY_MAX), 0n)));

export class PricingService {
  constructor(private readonly source: PricingSource, private readonly clock = () => new Date()) {}

  async resolve(input: unknown, channel: 'PUBLICO' | 'CLIENTE', auth?: AuthContext): Promise<PriceResult> {
    if (channel === 'CLIENTE') {
      if (!auth) throw new PricingError('NO_AUTENTICADO', 401);
      if (auth.rol !== 'CLIENTE') throw new PricingError('NO_AUTORIZADO', 403);
      if (!Number.isInteger(auth.id) || auth.id < 1 || auth.id > 2147483647) throw new PricingError('NO_AUTENTICADO', 401);
    }
    const request = parsePriceRequest(input);
    const at = this.clock();
    const calculate = async (snapshot: CommercialSnapshot): Promise<PriceResult> => {
      const listPercent = channel === 'CLIENTE' ? await this.clientDiscount(snapshot, auth!, at) : '0.00';
      const quote = request.moneda === 'ARS' ? resolveQuote(snapshot.calendar, snapshot.quote, at) : null;
      const products = new Map(snapshot.products.map(product => [product.id, product]));
      if (products.size !== snapshot.products.length) throw new PricingError('DATOS_COMERCIALES_INVALIDOS');
      const lines = request.productos.map(item => {
        const product = products.get(item.productoId);
        if (!product) throw new PricingError('PRODUCTO_INEXISTENTE', 404);
        return calculateLine(product, item, listPercent, quote?.valor ?? null);
      });

      // Never publish a partial payable total when one line has no usable price.
      const allUSD = lines.every(line => line.precioUnitarioUSD !== null && line.precioUnitarioUSD !== '0.00');
      return { regla: 'FER17-v1', ivaIncluido: true, moneda: request.moneda, productos: lines,
        datosSinteticos: lines.some(line => line.evidenciaBaseUSD?.synthetic) || !!quote?.sintetica,
        totalUSD: allUSD ? sumAmounts(lines.map(line => line.subtotalUSD!)) : null,
        totalARS: quote && lines.every(line => line.precioComprable) ? sumAmounts(lines.map(line => line.subtotalARS!)) : null,
        cotizacion: quote };
    };
    const id = channel === 'CLIENTE' ? auth!.id : null;
    return this.withSnapshot(id, request.productos, at, calculate, request.moneda);
  }

  // Cart reads keep incompatible lines visible, including a line whose amount exceeds FER-17 limits.
  async quoteCartLines(items: PriceItem[], auth: AuthContext, at: Date): Promise<Map<number, PriceLine | string>> {
    return this.withSnapshot(auth.id, items, at, async snapshot => {
      const listPercent = await this.clientDiscount(snapshot, auth, at);
      const products = new Map(snapshot.products.map(product => [product.id, product]));
      const lines = new Map<number, PriceLine | string>();
      for (const item of items) {
        const product = products.get(item.productoId);
        if (!product) throw new PricingError('PRODUCTO_INEXISTENTE', 404);
        try {
          lines.set(item.productoId, calculateLine(product, item, listPercent));
        } catch (error) {
          if (!(error instanceof PricingError) || error.status !== 422) throw error;
          lines.set(item.productoId, error.code);
        }
      }
      return lines;
    }, 'USD');
  }

  private async withSnapshot<T>(id: number | null, items: PriceItem[], at: Date,
    work: (snapshot: CommercialSnapshot) => Promise<T>, currency: 'USD' | 'ARS'): Promise<T> {
    const ids = items.map(item => item.productoId);
    return this.source.withSnapshot ? this.source.withSnapshot(id, ids, at, work, currency)
      : work(await this.source.load(id, ids, at, currency));
  }

  private async clientDiscount(snapshot: CommercialSnapshot, auth: AuthContext, at: Date): Promise<string> {
    let listPercent = '0.00';
    const client = snapshot.client;
    if (!client || client.active !== true || client.usuarioId !== auth.id
      || !Number.isInteger(client.clienteId) || client.clienteId < 1) throw new PricingError('NO_AUTORIZADO', 403);
    if (client.assignedListId === null && client.list !== null) throw new PricingError('DATOS_COMERCIALES_INVALIDOS');
    if (client.assignedListId !== null) {
      if (!Number.isInteger(client.assignedListId) || client.assignedListId < 1
        || !client.list || client.list.id !== client.assignedListId) throw new PricingError('DATOS_COMERCIALES_INVALIDOS');
      if (typeof client.list.active !== 'boolean') throw new PricingError('DATOS_COMERCIALES_INVALIDOS');
      if (client.list.active) listPercent = client.list.percent;
      else await (snapshot.recordInactiveList ?? this.source.recordInactiveList.bind(this.source))({ usuarioId: auth.id, clienteId: client.clienteId,
        listaId: client.list.id, at: at.toISOString() });
    }
    return listPercent;
  }
}
