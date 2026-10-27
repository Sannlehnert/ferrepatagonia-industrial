import { ValidateIf } from 'class-validator';
import { Rule, integer, roundSqlDecimal2 } from '../rules';

const required = (o: object, v: unknown) => o instanceof CreateProduct || v !== undefined;
const text = (label: string, max: number) => Rule(v => typeof v !== 'string'
  ? `El ${label} es obligatorio y debe ser texto.`
  : !v.trim() || v.trim().length > max
    ? `El ${label} es obligatorio y no debe superar los ${max} caracteres.` : null);

class ProductFields {
  @ValidateIf(required) @text('nombre del producto', 200) nombre?: string;
  @ValidateIf(required) @text('código SKU', 100) codigo?: string;
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Rule(v => typeof v !== 'string' ? 'La descripción debe ser texto.'
    : Buffer.byteLength(v, 'utf8') > 65535 ? 'La descripción supera la longitud máxima permitida (65535 bytes).' : null)
  descripcion?: string | null;
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Rule(v => typeof v !== 'string' ? 'La URL de la imagen debe ser texto.'
    : v.length > 2048 ? 'La URL de la imagen no debe superar los 2048 caracteres.' : null)
  imagen?: string | null;
  @ValidateIf(required)
  @Rule(v => integer(v, 1) ? null : 'La categoría debe ser un número entero válido mayor a 0.')
  id_categoria?: number;
  @ValidateIf(required)
  @Rule(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && roundSqlDecimal2(v) <= 9999999999.99
    ? null : 'El precio debe ser un valor numérico válido entre 0 y 9999999999.99.')
  precio?: number;
  @ValidateIf(required)
  @Rule(v => integer(v, 0) ? null : 'El stock debe ser un número entero estricto entre 0 y 2147483647.')
  stock?: number;
  @ValidateIf((_o, v) => v !== undefined)
  @Rule(v => typeof v === 'boolean' ? null : 'El campo activo debe ser estrictamente booleano (true/false).')
  activo?: boolean;
}

export class CreateProduct extends ProductFields {
  declare nombre: string;
  declare codigo: string;
  declare id_categoria: number;
  declare precio: number;
  declare stock: number;
}
export class UpdateProduct extends ProductFields {}
export const productFields = ['nombre', 'codigo', 'descripcion', 'imagen', 'id_categoria', 'precio', 'stock', 'activo'] as const;
