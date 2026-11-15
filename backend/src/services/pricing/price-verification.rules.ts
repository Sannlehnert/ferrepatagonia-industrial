// Pure validation rules for T-S7-05.2. No database or HTTP imports belong here.
import { format, MONEY_MAX } from './money';

export class PriceVerificationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const genericReferences = new Set([
  'ok', 'okay', 'verificado', 'verificada', 'verificar', 'verification',
  'test', 'testing', 'prueba', 'n/a', 'na', 'none', 'null', 'undefined',
  'sin evidencia', 'sin dato', 'sin datos', 'pendiente', 'true', 'false',
  'si', 'no', 'x', '-', '--', 'evidencia', 'documento', 'comprobante',
  'factura', 'referencia', 'sin revisar', 'revisado', 'revisada',
]);

const syntheticMarkers = new Set([
  'sintetico', 'sintetica', 'synthetic', 'demo', 'fixture',
  'ficticio', 'ficticia', 'mock',
]);

const normalizeWords = (value: string): string[] => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter(Boolean);

export function validateEvidenceReference(value: unknown): string {
  if (typeof value !== 'string') {
    throw new PriceVerificationError('EVIDENCIA_INVALIDA', 400, 'La referencia de evidencia debe ser texto.');
  }
  const evidence = value.trim();
  if (evidence.length < 8 || evidence.length > 1000) {
    throw new PriceVerificationError('EVIDENCIA_INVALIDA', 400,
      'La referencia de evidencia debe tener entre 8 y 1000 caracteres.');
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(evidence)) {
    throw new PriceVerificationError('EVIDENCIA_INVALIDA', 400, 'La referencia contiene caracteres no permitidos.');
  }
  if (!/[a-z0-9]/i.test(evidence)) {
    throw new PriceVerificationError('EVIDENCIA_INVALIDA', 400, 'La referencia debe identificar un documento verificable.');
  }
  const words = normalizeWords(evidence);
  if (words.length === 0 || (words.length <= 3 && words.every(word => genericReferences.has(word)))) {
    throw new PriceVerificationError('EVIDENCIA_INVALIDA', 400,
      'La referencia es genérica. Indicá el documento, su origen y un localizador verificable.');
  }
  if (words.some(word => syntheticMarkers.has(word))) {
    throw new PriceVerificationError('EVIDENCIA_SINTETICA', 400,
      'La evidencia sintética o de demostración no puede registrarse como evidencia comercial real.');
  }
  return evidence;
}

export function normalizeExpectedPrice(value: unknown): string {
  if (typeof value !== 'string') {
    throw new PriceVerificationError('IMPORTE_INVALIDO', 400,
      'El importe esperado debe enviarse como cadena decimal exacta, nunca como número de punto flotante.');
  }
  const match = /^(0|[1-9][0-9]{0,9})(?:\.([0-9]{1,2}))?$/.exec(value.trim());
  if (!match) {
    throw new PriceVerificationError('IMPORTE_INVALIDO', 400,
      'El importe esperado debe tener entre 0 y 9999999999.99 con hasta dos decimales.');
  }
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (cents > MONEY_MAX) {
    throw new PriceVerificationError('IMPORTE_INVALIDO', 400,
      'El importe esperado debe tener entre 0 y 9999999999.99 con hasta dos decimales.');
  }
  return format(cents);
}

export function parsePositiveId(value: unknown, field: string): number {
  const parsed = typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
    ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2147483647) {
    throw new PriceVerificationError('SOLICITUD_INVALIDA', 400, `${field} debe ser un entero positivo válido.`);
  }
  return parsed;
}
