import { parentPort, workerData } from 'node:worker_threads';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import sharp from 'sharp';
import type { ReceiptMime } from './receipt-types';

const forbiddenPdfKeys = new Set([
  'A', 'AA', 'OpenAction', 'JS', 'JavaScript', 'EmbeddedFiles', 'EF', 'AF',
  'XFA', 'RichMedia', 'Collection',
]);
const forbiddenPdfNames = new Set([
  'Action', 'JavaScript', 'Launch', 'URI', 'GoToR', 'GoToE', 'SubmitForm', 'ImportData',
  'Rendition', 'RichMedia', 'Movie', 'Sound', 'Screen', 'FileAttachment', 'EmbeddedFile', 'Filespec', '3D',
]);

async function validatePdf(buffer: Buffer): Promise<boolean> {
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(buffer.toString('latin1', 0, 12))) return false;
  const tail = buffer.toString('latin1', Math.max(0, buffer.length - 1024));
  const trailer = /startxref\s+(\d+)\s+%%EOF[ \t\r\n\f]*$/.exec(tail);
  if (!trailer) return false;
  const xref = Number(trailer[1]);
  if (!Number.isSafeInteger(xref) || xref < 9 || xref >= buffer.length) return false;
  if (!/^(?:xref\s|\d+\s+\d+\s+obj\b)/.test(buffer.toString('latin1', xref, xref + 40))) return false;

  const pdf = await PDFDocument.load(buffer, {
    throwOnInvalidObject: true, updateMetadata: false,
  });
  const pending = pdf.context.enumerateIndirectObjects().map(([, value]) => value);
  const inspected = new WeakSet<object>();
  while (pending.length) {
    const object = pending.pop()!;
    if (inspected.has(object)) continue;
    inspected.add(object);
    if (object instanceof PDFName && forbiddenPdfNames.has(object.decodeText())) return false;
    if (object instanceof PDFRawStream) pending.push(object.dict);
    if (object instanceof PDFArray) {
      for (const value of object.asArray()) pending.push(value);
    }
    if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        if (forbiddenPdfKeys.has(key.decodeText())) return false;
        pending.push(value);
      }
    }
  }

  const pages = pdf.getPages();
  return pages.length > 0 && pages.length <= 100;
}

function completePng(buffer: Buffer): boolean {
  if (!buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return false;
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (offset === 8 && type !== 'IHDR') return false;
    offset += length + 12;
    if (type === 'IEND') return length === 0 && offset === buffer.length;
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) return false;
  }
  return false;
}

function completeJpeg(buffer: Buffer): boolean {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8) return false;
  let offset = 2;
  let scanning = false;
  let sawScan = false;
  while (offset < buffer.length) {
    if (scanning) offset = buffer.indexOf(0xff, offset);
    if (offset < 0 || buffer[offset++] !== 0xff) return false;
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (scanning && (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7))) continue;
    if (marker === 0xd9) return sawScan && offset === buffer.length;
    if (marker === 0x00 || marker === 0xd8 || offset + 2 > buffer.length) return false;
    const length = buffer.readUInt16BE(offset);
    if (length < 2) return false;
    scanning = marker === 0xda;
    sawScan ||= scanning;
    offset += length;
  }
  return false;
}

async function validateImage(buffer: Buffer, mime: ReceiptMime): Promise<boolean> {
  const png = mime === 'image/png';
  if (png ? !completePng(buffer) : !completeJpeg(buffer)) return false;

  const image = sharp(buffer, { failOn: 'warning', limitInputPixels: 16_000_000 });
  const info = await image.metadata();
  if (info.format !== (png ? 'png' : 'jpeg') || (info.pages ?? 1) !== 1) return false;
  // metadata() alone accepts partially corrupt images. Decode the pixels too.
  await image.raw().toBuffer();
  return true;
}

async function main() {
  const { bytes, mime } = workerData as { bytes: Uint8Array; mime: ReceiptMime };
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return mime === 'application/pdf' ? validatePdf(buffer) : validateImage(buffer, mime);
}

void main().then(result => parentPort!.postMessage(result), () => parentPort!.postMessage(false));
