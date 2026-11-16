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
  'test', 'testing', 'prueba', 'n a', 'na', 'none', 'null', 'undefined',
  'sin evidencia', 'sin dato', 'sin datos', 'pendiente', 'true', 'false',
  'si', 'no', 'x', '-', '--', 'evidencia', 'documento', 'comprobante',
  'factura', 'referencia', 'sin revisar', 'revisado', 'revisada',
]);

const syntheticMarkers = new Set([
  'sintetico', 'sintetica', 'sinteticos', 'sinteticas', 'synthetic', 'demo', 'fixture',
  'ficticio', 'ficticia', 'ficticios', 'ficticias', 'mock', 'testonly',
]);

const normalizeWords = (value: string): string[] => value
  .normalize('NFKD')
  .replace(/\p{M}/gu, '')
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
  if (words.length === 0 || genericReferences.has(words.join(' '))
    || (words.length <= 3 && words.every(word => genericReferences.has(word)))) {
    throw new PriceVerificationError('EVIDENCIA_INVALIDA', 400,
      'La referencia es genérica. Indicá el documento, su origen y un localizador verificable.');
  }
  if (words.some((word, index) => syntheticMarkers.has(word)
    || (word === 'test' && words[index + 1] === 'only'))) {
    throw new PriceVerificationError('EVIDENCIA_SINTETICA', 400,
      'La evidencia sintética o de demostración no puede registrarse como evidencia comercial real.');
  }
  return evidence;
}

export function normalizePriceAmount(value: unknown): string {
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

export function normalizeExpectedPrice(value: unknown): string {
  const price = normalizePriceAmount(value);
  if (price === '0.00') {
    throw new PriceVerificationError('IMPORTE_INVALIDO', 400, 'El importe verificable debe ser mayor que cero.');
  }
  return price;
}

export function parsePositiveId(value: unknown, field: string): number {
  const invalid = () => new PriceVerificationError('SOLICITUD_INVALIDA', 400,
    `${field} debe ser un entero positivo válido.`);
  if (typeof value === 'string') {
    if (!/^[1-9]/.test(value) || /\D/.test(value) || value.length > 10
      || (value.length === 10 && value > '2147483647')) throw invalid();
    return Number(value);
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483647) throw invalid();
  return value;
}
