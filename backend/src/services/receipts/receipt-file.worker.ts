import { parentPort, workerData } from 'node:worker_threads';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import sharp from 'sharp';
import type { ReceiptMime } from './receipt-types';

export type ReceiptValidationFailure =
  | 'ARCHIVO_DANADO'
  | 'CONTENIDO_NO_PERMITIDO'
  | 'TIPO_INCOMPATIBLE';
export type ReceiptValidationResult =
  | { ok: true }
  | { ok: false; code: ReceiptValidationFailure };

const ok = (): ReceiptValidationResult => ({ ok: true });
const fail = (code: ReceiptValidationFailure): ReceiptValidationResult => ({ ok: false, code });

// Las acciones enlazadas por el usuario (URI/GoTo) no ejecutan código. Las
// acciones activas, formularios, archivos embebidos y multimedia sí se rechazan.
const forbiddenPdfKeys = new Set([
  'AA', 'JS', 'JavaScript', 'EmbeddedFiles', 'EF', 'AF',
  'XFA', 'RichMedia', 'Collection',
]);
const forbiddenPdfNames = new Set([
  'JavaScript', 'Launch', 'GoToR', 'GoToE', 'SubmitForm', 'ImportData',
  'Rendition', 'RichMedia', 'Movie', 'Sound', 'Screen', 'FileAttachment',
  'EmbeddedFile', 'Filespec', '3D',
]);
const unsafeActionTypes = new Set([
  'JavaScript', 'Launch', 'GoToR', 'GoToE', 'SubmitForm', 'ImportData',
  'Rendition', 'RichMedia', 'Movie', 'Sound', 'Screen', 'FileAttachment',
  'EmbeddedFile', '3D',
]);

function entryName(dict: PDFDict, key: string): string | null {
  const entry = dict.entries().find(([name]) => name.decodeText() === key);
  return entry?.[1] instanceof PDFName ? entry[1].decodeText() : null;
}

async function validatePdf(buffer: Buffer): Promise<ReceiptValidationResult> {
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(buffer.toString('latin1', 0, 12))) {
    return fail('TIPO_INCOMPATIBLE');
  }
  const tail = buffer.toString('latin1', Math.max(0, buffer.length - 1024));
  const trailer = /startxref\s+(\d+)\s+%%EOF[ \t\r\n\f]*$/.exec(tail);
  if (!trailer) return fail('ARCHIVO_DANADO');
  const xref = Number(trailer[1]);
  if (!Number.isSafeInteger(xref) || xref < 9 || xref >= buffer.length) {
    return fail('ARCHIVO_DANADO');
  }
  if (!/^(?:xref\s|\d+\s+\d+\s+obj\b)/.test(buffer.toString('latin1', xref, xref + 40))) {
    return fail('ARCHIVO_DANADO');
  }

  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(buffer, {
      throwOnInvalidObject: true, updateMetadata: false,
    });
  } catch {
    return fail('ARCHIVO_DANADO');
  }

  const pending = pdf.context.enumerateIndirectObjects().map(([, value]) => value);
  const inspected = new WeakSet<object>();
  while (pending.length) {
    const object = pending.pop()!;
    if (inspected.has(object)) continue;
    inspected.add(object);
    if (object instanceof PDFName && forbiddenPdfNames.has(object.decodeText())) {
      return fail('CONTENIDO_NO_PERMITIDO');
    }
    if (object instanceof PDFRawStream) pending.push(object.dict);
    if (object instanceof PDFArray) {
      for (const value of object.asArray()) pending.push(value);
    }
    if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        const keyText = key.decodeText();
        if (forbiddenPdfKeys.has(keyText)) return fail('CONTENIDO_NO_PERMITIDO');

        // Una anotación puede enlazar a una URL o a otra página. Solo se
        // admiten acciones no ejecutables; el resto ya está cubierto por los
        // nombres prohibidos, pero se comprueba aquí para no depender de que
        // el tipo de acción aparezca también como objeto independiente.
        if (keyText === 'A') {
          const action = pdf.context.lookup(value);
          if (action instanceof PDFDict) {
            const type = entryName(action, 'S');
            if (type !== null && unsafeActionTypes.has(type)) return fail('CONTENIDO_NO_PERMITIDO');
          }
        }

        // OpenAction puede ser un destino interno benigno (página/vista). Un
        // URI o cualquier acción al abrir el documento se rechaza.
        if (keyText === 'OpenAction') {
          const action = pdf.context.lookup(value);
          if (action instanceof PDFArray) {
            // Destino interno de apertura.
          } else if (action instanceof PDFDict) {
            if (entryName(action, 'S') !== 'GoTo') return fail('CONTENIDO_NO_PERMITIDO');
          } else {
            return fail('ARCHIVO_DANADO');
          }
        }

        pending.push(value);
      }
    }
  }

  const pages = pdf.getPages();
  if (pages.length === 0) return fail('ARCHIVO_DANADO');
  if (pages.length > 100) return fail('CONTENIDO_NO_PERMITIDO');
  return ok();
}

function pngFailure(buffer: Buffer): ReceiptValidationFailure | null {
  if (!buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'TIPO_INCOMPATIBLE';
  }
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (offset === 8 && type !== 'IHDR') return 'ARCHIVO_DANADO';
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) return 'CONTENIDO_NO_PERMITIDO';
    if (offset + length + 12 > buffer.length) return 'ARCHIVO_DANADO';
    offset += length + 12;
    if (type === 'IEND') return length === 0 && offset === buffer.length ? null : 'ARCHIVO_DANADO';
  }
  return 'ARCHIVO_DANADO';
}

function jpegFailure(buffer: Buffer): ReceiptValidationFailure | null {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8) return 'TIPO_INCOMPATIBLE';
  let offset = 2;
  let scanning = false;
  let sawScan = false;
  while (offset < buffer.length) {
    if (scanning) offset = buffer.indexOf(0xff, offset);
    if (offset < 0 || buffer[offset++] !== 0xff) return 'ARCHIVO_DANADO';
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (scanning && (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7))) continue;
    if (marker === 0xd9) {
      return sawScan && offset === buffer.length ? null : 'ARCHIVO_DANADO';
    }
    if (marker === 0x00 || marker === 0xd8 || offset + 2 > buffer.length) return 'ARCHIVO_DANADO';
    const length = buffer.readUInt16BE(offset);
    if (length < 2) return 'ARCHIVO_DANADO';
    scanning = marker === 0xda;
    sawScan ||= scanning;
    offset += length;
  }
  return 'ARCHIVO_DANADO';
}

async function validateImage(
  buffer: Buffer,
  mime: ReceiptMime,
): Promise<ReceiptValidationResult> {
  const png = mime === 'image/png';
  const failure = png ? pngFailure(buffer) : jpegFailure(buffer);
  if (failure) return fail(failure);

  try {
    const image = sharp(buffer, { failOn: 'warning', limitInputPixels: 16_000_000 });
    const info = await image.metadata();
    if (info.format !== (png ? 'png' : 'jpeg')) return fail('TIPO_INCOMPATIBLE');
    if ((info.pages ?? 1) !== 1) return fail('CONTENIDO_NO_PERMITIDO');
    // metadata() alone accepts partially corrupt images. Decode the pixels too.
    await image.raw().toBuffer();
    return ok();
  } catch {
    return fail('ARCHIVO_DANADO');
  }
}

async function main(): Promise<ReceiptValidationResult> {
  const { bytes, mime } = workerData as { bytes: Uint8Array; mime: ReceiptMime };
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return mime === 'application/pdf'
    ? validatePdf(buffer)
    : validateImage(buffer, mime);
}

void main().then(
  result => parentPort!.postMessage(result),
  () => parentPort!.postMessage(fail('ARCHIVO_DANADO')),
);
