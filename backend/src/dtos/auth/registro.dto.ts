import { Rule } from '../rules';
import type { RegisterInput } from '../../validators/register.validator';

const text = (field: string, max: number, required = false) => Rule(v => {
  if (v === undefined || v === null) return required ? `${field} es obligatorio.` : null;
  if (typeof v !== 'string' || !v.trim()) return `${field} debe ser un texto no vacío.`;
  if ([...v.trim()].length > max) return `${field} admite hasta ${max} caracteres.`;
  if (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return 'email debe tener un formato válido.';
  return null;
});

export class Registro {
  @Rule(v => v === 'PARTICULAR' || v === 'EMPRESA' ? null : 'tipoCliente debe ser PARTICULAR o EMPRESA.')
  tipoCliente!: 'PARTICULAR' | 'EMPRESA';
  @text('nombreRazonSocial', 200, true) nombreRazonSocial!: string;
  @text('email', 254, true) email!: string;
  @text('docCliente', 30) docCliente?: string | null;
  @text('cuit', 20) cuit?: string | null;
  @text('telefono', 50) telefono?: string | null;
  @text('direccion', 500) direccion?: string | null;
  @Rule(v => typeof v !== 'string' || !v.trim() ? 'password debe ser un texto no vacío.'
    : Buffer.byteLength(v, 'utf8') > 72 ? 'Solicitud inválida.' : null)
  password!: string;
}

export function registerInput(dto: Registro): RegisterInput {
  return { tipoCliente: dto.tipoCliente, nombreRazonSocial: dto.nombreRazonSocial.trim(),
    email: dto.email.trim(), password: dto.password,
    docCliente: dto.docCliente?.trim() ?? null, cuit: dto.cuit?.trim() ?? null,
    telefono: dto.telefono?.trim() ?? null, direccion: dto.direccion?.trim() ?? null };
}
