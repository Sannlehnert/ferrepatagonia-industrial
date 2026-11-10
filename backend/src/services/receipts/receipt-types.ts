export const receiptLimit = 5 * 1024 * 1024;
export const receiptExtensions = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
} as const;

export type ReceiptMime = keyof typeof receiptExtensions;

export function isReceiptMime(value: string): value is ReceiptMime {
  return Object.hasOwn(receiptExtensions, value);
}

export function isReceiptId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

export class ReceiptError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export const receiptUnavailable = () => new ReceiptError(
  503, 'COMPROBANTES_NO_DISPONIBLES', 'No se pudo procesar el comprobante. Reintentá en unos instantes.',
);

export const receiptNotFound = () => new ReceiptError(
  404, 'COMPROBANTE_NO_ENCONTRADO', 'No se encontró el comprobante solicitado.',
);
