import { Rule } from '../rules';
import type { DtoPolicy } from '../validation';

const optionalText = (field: string, max: number) => Rule((value: unknown) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return `${field} debe ser texto o null.`;
  const trimmed = value.trim();
  if (!trimmed) return `${field} debe ser un texto no vacío o null.`;
  if ([...trimmed].length > max) return `${field} admite hasta ${max} caracteres.`;
  return null;
});

// Solo datos de contacto: identidad, credenciales y estados comerciales son
// responsabilidad del servidor y no forman parte de este DTO.
export class UpdatePerfil {
  @optionalText('El teléfono', 50)
  telefono?: string | null;

  @optionalText('La dirección', 500)
  direccion?: string | null;
}

export const updatePerfilFields = ['telefono', 'direccion'] as const;

export const updatePerfilPolicy: DtoPolicy<UpdatePerfil> = {
  type: UpdatePerfil,
  fields: updatePerfilFields,
  unknownError: 'El body contiene campos no permitidos.',
  objectError: 'El cuerpo de la solicitud es requerido y debe ser un objeto válido.',
  check: input => updatePerfilFields.some(field => input[field] !== undefined)
    ? null
    : 'Debe proporcionar al menos un campo válido para actualizar.',
  prepare: input => Object.fromEntries(updatePerfilFields
    .filter(field => input[field] !== undefined)
    .map(field => [field, typeof input[field] === 'string'
      ? (input[field] as string).trim()
      : input[field]])),
};
