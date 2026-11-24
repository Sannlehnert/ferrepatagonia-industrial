import { Rule } from '../rules';
import type { DtoPolicy } from '../validation';
import {
  normalizeExpectedPrice,
  validateEvidenceReference,
} from '../../services/pricing/price-verification.rules';

const error = 'El cuerpo debe incluir importe, evidencia y confirmación explícita.';

function amountError(value: unknown): string | null {
  if (typeof value !== 'string') return 'El importe debe ser una cadena decimal exacta.';
  try {
    normalizeExpectedPrice(value.trim());
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : 'El importe revisado no es válido.';
  }
}

function evidenceError(value: unknown): string | null {
  if (typeof value !== 'string') return 'La evidencia debe ser texto.';
  try {
    validateEvidenceReference(value);
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : 'La evidencia no es válida.';
  }
}

export class VerifyProductPrice {
  @Rule(amountError)
  importe!: string;

  @Rule(evidenceError)
  evidencia!: string;

  @Rule(value => value === true
    ? null
    : 'La verificación exige confirmación explícita de la revisión manual.')
  confirmar!: true;
}

export const verifyProductPricePolicy: DtoPolicy<VerifyProductPrice> = {
  type: VerifyProductPrice,
  fields: ['importe', 'evidencia', 'confirmar'],
  unknownError: 'La solicitud contiene campos no permitidos.',
  objectError: 'El cuerpo de la verificación debe ser un objeto JSON válido.',
  error,
  prepare: input => ({
    importe: typeof input.importe === 'string' ? input.importe.trim() : input.importe,
    evidencia: typeof input.evidencia === 'string' ? input.evidencia.trim() : input.evidencia,
    confirmar: input.confirmar,
  }),
};
