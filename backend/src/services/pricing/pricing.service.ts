import type { AuthContext } from '../../types/auth';
import { bounded, decimal, format, MONEY_MAX, PricingError } from './money';
import { calculateLine } from './pricing.engine';
import { resolveQuote } from './pricing.quote';
import type { CommercialSnapshot, PriceRequest, PriceResult, PricingSource } from './pricing.types';

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
      let listPercent = '0.00';
      if (channel === 'CLIENTE') {
        const client = snapshot.client;
        if (!client || client.active !== true || client.usuarioId !== auth!.id
          || !Number.isInteger(client.clienteId) || client.clienteId < 1) throw new PricingError('NO_AUTORIZADO', 403);
        if (client.assignedListId === null && client.list !== null) throw new PricingError('DATOS_COMERCIALES_INVALIDOS');
        if (client.assignedListId !== null) {
          if (!Number.isInteger(client.assignedListId) || client.assignedListId < 1
            || !client.list || client.list.id !== client.assignedListId) throw new PricingError('DATOS_COMERCIALES_INVALIDOS');
          if (typeof client.list.active !== 'boolean') throw new PricingError('DATOS_COMERCIALES_INVALIDOS');
          if (client.list.active) listPercent = client.list.percent;
          else await (snapshot.recordInactiveList ?? this.source.recordInactiveList.bind(this.source))({ usuarioId: auth!.id, clienteId: client.clienteId,
            listaId: client.list.id, at: at.toISOString() });
        }
      }
      const quote = request.moneda === 'ARS' ? resolveQuote(snapshot.calendar, snapshot.quote, at) : null;
      const products = new Map(snapshot.products.map(product => [product.id, product]));
      if (products.size !== snapshot.products.length) throw new PricingError('DATOS_COMERCIALES_INVALIDOS');
      const lines = request.productos.map(item => {
        const product = products.get(item.productoId);
        if (!product) throw new PricingError('PRODUCTO_INEXISTENTE', 404);
        return calculateLine(product, item, listPercent, quote?.valor ?? null);
      });
      const sum = (field: 'subtotalUSD' | 'subtotalARS') => format(bounded(lines.reduce((total, line) =>
        total + decimal(line[field], 2, MONEY_MAX), 0n)));
      // Never publish a partial payable total when one line has no usable price.
      const allUSD = lines.every(line => line.precioUnitarioUSD !== null && line.precioUnitarioUSD !== '0.00');
      return { regla: 'FER17-v1', ivaIncluido: true, moneda: request.moneda, productos: lines,
        datosSinteticos: lines.some(line => line.evidenciaBaseUSD?.synthetic) || !!quote?.sintetica,
        totalUSD: allUSD ? sum('subtotalUSD') : null,
        totalARS: quote && lines.every(line => line.precioComprable) ? sum('subtotalARS') : null,
        cotizacion: quote };
    };
    const id = channel === 'CLIENTE' ? auth!.id : null;
    const ids = request.productos.map(item => item.productoId);
    return this.source.withSnapshot ? this.source.withSnapshot(id, ids, at, calculate, request.moneda)
      : calculate(await this.source.load(id, ids, at, request.moneda));
  }
}
