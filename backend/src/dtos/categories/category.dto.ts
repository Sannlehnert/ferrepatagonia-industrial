import { ValidateIf } from 'class-validator';
import { integer, parseInteger, Rule } from '../rules';

class CategoryFields {
  @ValidateIf((dto, value) => dto instanceof CreateCategory || value !== undefined)
  @Rule(value => typeof value === 'string' && value.length > 0 && Array.from(value).length <= 150
    ? null : 'El nombre debe contener entre 1 y 150 caracteres.')
  nombre?: string;

  @ValidateIf((_dto, value) => value !== undefined && value !== null)
  @Rule(value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 65535
    ? null : 'La descripción debe ser texto de hasta 65535 bytes o null.')
  descripcion?: string | null;
}

export class CreateCategory extends CategoryFields {
  declare nombre: string;
}

export class UpdateCategory extends CategoryFields {}

export const categoryFields = ['nombre', 'descripcion'] as const;
export const prepareCategory = (input: Record<string, unknown>) =>
  typeof input.nombre === 'string' ? { ...input, nombre: input.nombre.trim() } : input;

export class CategoryIdParams {
  @Rule(value => integer(value, 1) ? null : 'ID inválido')
  id!: number;
}

export const prepareCategoryId = (input: Record<string, unknown>) =>
  ({ id: parseInteger(input.id, 2147483647) });
