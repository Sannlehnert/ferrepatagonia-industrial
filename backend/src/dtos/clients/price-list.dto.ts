import { Rule } from '../rules';
import type { DtoPolicy } from '../validation';

export class PriceListInput {
  @Rule(value => typeof value === 'string' && value.length >= 1 && value.length <= 150
    ? null : 'Ingresá un nombre de hasta 150 caracteres.')
  nombre!: string;

  @Rule(value => typeof value === 'string' && /^[0-9]{1,2}(?:\.[0-9]{1,2})?$/.test(value)
    ? null : 'El porcentaje debe estar entre 0 y 99,99, con hasta dos decimales.')
  porcentajeDescuento!: string;

  @Rule(value => typeof value === 'boolean' ? null : 'Indicá si la lista está activa.')
  activa!: boolean;
}

export const priceListPolicy: DtoPolicy<PriceListInput> = {
  type: PriceListInput,
  fields: ['nombre', 'porcentajeDescuento', 'activa'],
  prepare: input => ({ ...input, nombre: typeof input.nombre === 'string' ? input.nombre.trim() : input.nombre }),
  unknownError: 'La solicitud contiene campos no permitidos.',
  objectError: 'El cuerpo de la solicitud debe ser un objeto JSON.',
};
