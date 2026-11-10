import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import express, { type Request, type Response } from 'express';
import { DatabaseOutcomeUnknownError } from '../config/database-policy';
import { validateOrderIdParam } from '../dtos/orders/account-order.dto';
import { authenticateRequest, authorizeRequest } from '../middlewares/auth.middleware';
import {
  findReceipt, getReceiptDestination, insertReceipt, listReceipts, reviewReceipt, type ReceiptScope,
} from '../repositories/paymentReceipt.repository';
import {
  openReceiptFile, receiptDirectory, removeReceiptFile, validateReceiptContent, writeReceiptFile,
} from '../services/receipts/receipt-storage';
import {
  isReceiptId, isReceiptMime, receiptExtensions, ReceiptError, receiptLimit, receiptNotFound, receiptUnavailable,
} from '../services/receipts/receipt-types';

export const receiptRouter = express.Router();
const raw = express.raw({ type: () => true, limit: receiptLimit, inflate: false });

type Operation = 'upload' | 'list' | 'download' | 'review';
type Target = 'order' | 'account' | 'admin';
let activeUploads = 0;

const invalidRequest = () => new ReceiptError(400, 'SOLICITUD_INVALIDA', 'Los parámetros del comprobante no son válidos.');

async function orderId(value: unknown): Promise<number> {
  const parsed = await validateOrderIdParam(value);
  if (!parsed.valid) throw new ReceiptError(400, parsed.code, parsed.message);
  return parsed.orderId;
}

function pageNumber(value: unknown): number {
  if (value === undefined) return 1;
  if (typeof value !== 'string' || !/^[1-9]\d{0,7}$/.test(value)) throw invalidRequest();
  return Number(value);
}

async function readUpload(req: Request, res: Response): Promise<Buffer> {
  const timer = setTimeout(() => req.destroy(), 15_000);
  try {
    await new Promise<void>((resolve, reject) => raw(req, res, error => error ? reject(error) : resolve()));
    return Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  } catch (error) {
    if ((error as { status?: number }).status === 413) {
      throw new ReceiptError(413, 'ARCHIVO_DEMASIADO_GRANDE', 'El comprobante debe pesar hasta 5 MB.');
    }
    throw invalidRequest();
  } finally {
    clearTimeout(timer);
  }
}

async function upload(
  req: Request, res: Response, scope: ReceiptScope, userId: number, signal: AbortSignal,
) {
  if ('admin' in scope) throw invalidRequest();
  const mime = req.get('Content-Type')?.toLowerCase() ?? '';
  if (!isReceiptMime(mime) || (req.get('Content-Encoding') ?? 'identity').toLowerCase() !== 'identity') {
    throw new ReceiptError(415, 'TIPO_NO_PERMITIDO', 'Seleccioná un archivo PDF, JPG o PNG.');
  }
  const reference = req.query.pedidoId === undefined ? null : await orderId(req.query.pedidoId);
  await getReceiptDestination(scope, userId, reference);
  const root = await receiptDirectory();
  signal.throwIfAborted();
  const bytes = await readUpload(req, res);
  await validateReceiptContent(bytes, mime, signal);
  const id = randomUUID();
  const hash = createHash('sha256').update(bytes).digest();
  await writeReceiptFile(root, id, bytes);

  let storedId: string;
  try {
    signal.throwIfAborted();
    storedId = await insertReceipt(scope, userId, reference, { id, mime, bytes: bytes.length, hash });
  } catch (error) {
    // Ante un COMMIT incierto, el archivo puede corresponder a una fila válida.
    if (!(error instanceof DatabaseOutcomeUnknownError)) await removeReceiptFile(root, id);
    else console.error('receipt.database.outcome.unknown');
    throw error;
  }

  if (storedId !== id) await removeReceiptFile(root, id);
  if (signal.aborted) return;
  const result = await findReceipt(scope, userId, storedId);
  if (!result) throw receiptNotFound();
  if (!signal.aborted) res.status(storedId === id ? 201 : 200).json({ data: result });
}

async function download(req: Request, res: Response, scope: ReceiptScope, userId: number, id: string, signal: AbortSignal) {
  const receipt = await findReceipt(scope, userId, id);
  if (!receipt) throw receiptNotFound();
  const root = await receiptDirectory();
  const handle = await openReceiptFile(root, id, receipt.bytes);
  try {
    signal.throwIfAborted();
    const extension = receiptExtensions[receipt.tipoMime];
    res.set({
      'Content-Type': receipt.tipoMime,
      'Content-Disposition': `attachment; filename="comprobante-${id}.${extension}"`,
      'Content-Length': String(receipt.bytes),
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else await pipeline(handle.createReadStream({ autoClose: false }), res, { signal });
  } finally {
    await handle.close();
  }
}

function handler(target: Target, operation: Operation): express.RequestHandler {
  return async (req, res) => {
    const cancellation = new AbortController();
    const disconnect = () => cancellation.abort();
    res.once('close', disconnect);
    if (res.destroyed) disconnect();

    let uploadSlot = false;
    try {
      if (operation === 'upload') {
        if (activeUploads >= 2) throw receiptUnavailable();
        activeUploads++;
        uploadSlot = true;
      }
      if (!await authenticateRequest(req, res)) return;
      if (!authorizeRequest(req, res, [target === 'admin' ? 'ADMIN' : 'CLIENTE'])) return;
      const userId = req.auth!.id;
      const scope: ReceiptScope = target === 'admin' ? { admin: true }
        : target === 'account' ? { account: true } : { orderId: await orderId(req.params.pedidoId) };

      const allowedQuery = operation === 'list' ? 'pagina'
        : operation === 'upload' && target === 'account' ? 'pedidoId' : undefined;
      if (Object.keys(req.query).some(key => key !== allowedQuery)) throw invalidRequest();
      if (operation === 'upload') {
        await upload(req, res, scope, userId, cancellation.signal);
        return;
      }

      if (req.get('Transfer-Encoding') || Number(req.get('Content-Length') ?? 0) > 0) throw invalidRequest();
      if (operation === 'list') {
        if (!('admin' in scope)) await getReceiptDestination(scope, userId);
        const data = await listReceipts(scope, userId, pageNumber(req.query.pagina));
        if (!cancellation.signal.aborted) res.json({ data });
        return;
      }
      const id = req.params.comprobanteId;
      if (typeof id !== 'string' || !isReceiptId(id)) throw receiptNotFound();
      if (operation === 'download') {
        await download(req, res, scope, userId, id, cancellation.signal);
        return;
      }

      const data = await reviewReceipt(userId, id);
      if (!data) throw receiptNotFound();
      if (!cancellation.signal.aborted) res.json({ data });
    } catch (error) {
      if (cancellation.signal.aborted || res.headersSent) return;
      const failure = error instanceof ReceiptError ? error : receiptUnavailable();
      if (failure.status === 503) res.setHeader('Retry-After', '1');
      res.status(failure.status).json({ code: failure.code, message: failure.message });
    } finally {
      res.removeListener('close', disconnect);
      if (uploadSlot) activeUploads--;
    }
  };
}

for (const [target, path] of [
  ['order', '/pedidos/:pedidoId/comprobantes'],
  ['account', '/cuenta-corriente/comprobantes'],
  ['admin', '/admin/comprobantes'],
] as const) {
  if (target !== 'admin') receiptRouter.post(path, handler(target, 'upload'));
  receiptRouter.get(path, handler(target, 'list'));
  receiptRouter.get(path + '/:comprobanteId', handler(target, 'download'));
}

receiptRouter.patch('/admin/comprobantes/:comprobanteId/revision', handler('admin', 'review'));
