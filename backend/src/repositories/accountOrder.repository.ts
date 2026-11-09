import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import {
  bounded,
  decimal,
  format,
  MONEY_MAX,
} from '../services/pricing/money';
import type {
  AccountOrderQuote,
} from '../services/orders/account-order.pricing';
import { AccountOrderError } from '../services/orders/account-order.errors';

function invalidAmount(): never {
  throw new AccountOrderError(
    'IMPORTE_PEDIDO_INVALIDO',
    422,
    'Los importes del pedido no son consistentes.',
  );
}

function prepare(quote: AccountOrderQuote) {
  if (quote.regla !== 'FER17-v1' ||
    quote.moneda !== 'USD' ||
    quote.ivaIncluido !== true ||
    quote.lines.length === 0) {
    invalidAmount();
  }

  const products = new Set<number>();

  const lines = quote.lines.map(line => {
    if (products.has(line.productoId) ||
      !Number.isInteger(line.cantidad) ||
      line.cantidad < 1 ||
      line.cantidad > 2147483647 ||
      !line.precioComprable ||
      !line.evidenciaBaseUSD ||
      line.evidenciaBaseUSD.synthetic ||
      line.precioBaseUSD === null ||
      line.precioUnitarioUSD === null ||
      line.subtotalUSD === null) {
      invalidAmount();
    }

    products.add(line.productoId);

    const base = decimal(line.precioBaseUSD, 2, MONEY_MAX);
    const unit = decimal(line.precioUnitarioUSD, 2, MONEY_MAX);
    const net = decimal(line.subtotalUSD, 2, MONEY_MAX);
    const gross = bounded(base * BigInt(line.cantidad));

    if (base === 0n || unit === 0n ||
      net !== unit * BigInt(line.cantidad) ||
      net > gross) {
      invalidAmount();
    }

    return { line, gross, net, discount: gross - net };
  });

  const gross = bounded(lines.reduce((sum, item) => sum + item.gross, 0n));
  const net = bounded(lines.reduce((sum, item) => sum + item.net, 0n));

  if (net === 0n || net !== decimal(quote.totalUSD, 2, MONEY_MAX)) {
    invalidAmount();
  }

  return { lines, gross, net };
}

export async function persistAccountOrder(
  manager: EntityManager,
  clientId: number,
  quote: AccountOrderQuote,
): Promise<number> {
  if (!manager.queryRunner?.isTransactionActive) {
    throw new Error('Guardar el pedido requiere una transacción activa.');
  }

  const prepared = prepare(quote);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ clientId, quote }))
    .digest('hex');

  const order = await manager.query(`
    INSERT INTO PEDIDO (
      id_cliente, estado, modalidad_pago,
      subtotal, descuento, total,
      moneda_total, evidencia_total_usd
    ) VALUES (?, 'CONFIRMADO', 'CUENTA_CORRIENTE', ?, ?, ?, 'USD', ?)
  `, [
    clientId,
    format(prepared.gross),
    format(prepared.gross - prepared.net),
    format(prepared.net),
    `FER17-v1:SHA256:${fingerprint}`,
  ]);

  const orderId = Number(order.insertId);

  for (const item of prepared.lines) {
    const detail = await manager.query(`
      INSERT INTO DETALLE_PEDIDO (
        id_pedido, id_producto, cantidad,
        precio_unitario, descuento, subtotal
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [
      orderId,
      item.line.productoId,
      item.line.cantidad,
      item.line.precioBaseUSD,
      format(item.discount),
      format(item.net),
    ]);

    await manager.query(`
      INSERT INTO DETALLE_PEDIDO_CC_PRECIO (
        id_detalle_pedido, regla, snapshot_json
      ) VALUES (?, 'FER17-v1', ?)
    `, [
      Number(detail.insertId),
      JSON.stringify({
        regla: quote.regla,
        moneda: quote.moneda,
        ivaIncluido: quote.ivaIncluido,
        aplicadoEn: quote.aplicadoEn,
        producto: item.line,
      }),
    ]);
  }

  return orderId;
}