export const receiptLimit = 5 * 1024 * 1024;
export const receiptExtensions = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
} as const;

export type ReceiptMime = keyof typeof receiptExtensions;
export type ReceiptReviewState = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';
export type ReceiptDecisionState = 'APROBADO' | 'RECHAZADO';

export interface ReceiptReviewInput {
  estado: ReceiptDecisionState;
  motivo: string | null;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isReceiptMime(value: string): value is ReceiptMime {
  return Object.hasOwn(receiptExtensions, value);
}

export function isReceiptId(value: string): boolean {
  return UUID_V4_PATTERN.test(value);
}

export function normalizeReceiptIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return UUID_V4_PATTERN.test(normalized) ? normalized : null;
}

export function parseReceiptReviewBody(body: unknown): ReceiptReviewInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ReceiptError(
      400,
      'SOLICITUD_INVALIDA',
      'El cuerpo de la revisión debe ser un objeto JSON válido.',
    );
  }
  const proto = Object.getPrototypeOf(body);
  if (proto !== Object.prototype && proto !== null) {
    throw new ReceiptError(
      400,
      'SOLICITUD_INVALIDA',
      'El cuerpo de la revisión debe ser un objeto JSON válido.',
    );
  }

  const record = body as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (keys.some(key => typeof key !== 'string' || (key !== 'estado' && key !== 'motivo'))) {
    throw new ReceiptError(
      400,
      'SOLICITUD_INVALIDA',
      'Solo se permiten los campos "estado" y "motivo" en la revisión documental.',
    );
  }

  const rawEstado = record.estado;
  if (rawEstado !== 'APROBADO' && rawEstado !== 'RECHAZADO') {
    throw new ReceiptError(
      400,
      'SOLICITUD_INVALIDA',
      'El estado documental de resolución debe ser APROBADO o RECHAZADO.',
    );
  }

  if (rawEstado === 'APROBADO') {
    if (record.motivo !== undefined && record.motivo !== null) {
      throw new ReceiptError(
        400,
        'SOLICITUD_INVALIDA',
        'La aprobación documental no admite un motivo de rechazo.',
      );
    }
    return { estado: 'APROBADO', motivo: null };
  }

  if (typeof record.motivo !== 'string') {
    throw new ReceiptError(
      400,
      'SOLICITUD_INVALIDA',
      'El rechazo documental exige un motivo de texto entre 1 y 1000 caracteres.',
    );
  }
  const motivo = record.motivo.trim();
  if (motivo.length < 1 || motivo.length > 1000) {
    throw new ReceiptError(
      400,
      'SOLICITUD_INVALIDA',
      'El rechazo documental exige un motivo de texto entre 1 y 1000 caracteres.',
    );
  }

  return { estado: 'RECHAZADO', motivo };
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
