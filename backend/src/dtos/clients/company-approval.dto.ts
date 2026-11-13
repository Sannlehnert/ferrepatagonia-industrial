import { Rule } from '../rules';
import type { DtoPolicy } from '../validation';

export type EstadoAprobacionEmpresa = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';

const VALID_STATUSES = new Set(['PENDIENTE', 'APROBADA', 'RECHAZADA']);

export class CompanyApprovalInput {
  @Rule((value: unknown) =>
    typeof value === 'string' && VALID_STATUSES.has(value.toUpperCase())
      ? null
      : "El estado debe ser 'APROBADA', 'RECHAZADA' o 'PENDIENTE'.",
  )
  estado!: EstadoAprobacionEmpresa;
}

export const companyApprovalPolicy: DtoPolicy<CompanyApprovalInput> = {
  type: CompanyApprovalInput,
  fields: ['estado', 'estadoAprobacionEmpresa'],
  check: (input: Record<string, unknown>) => {
    if (
      'estado' in input &&
      'estadoAprobacionEmpresa' in input &&
      input.estado !== input.estadoAprobacionEmpresa
    ) {
      return "El estado debe ser 'APROBADA', 'RECHAZADA' o 'PENDIENTE'.";
    }
    return null;
  },
  prepare: (input: Record<string, unknown>) => {
    const raw = 'estado' in input ? input.estado : input?.estadoAprobacionEmpresa;
    return {
      estado: typeof raw === 'string' ? raw.trim().toUpperCase() : raw,
    };
  },
  unknownError: 'La solicitud contiene campos no permitidos.',
  objectError: 'El cuerpo de la solicitud debe ser un objeto JSON.',
};