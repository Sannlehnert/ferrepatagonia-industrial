import { Rule, integer } from '../rules';

export class Stock {
  @Rule(v => v === undefined ? 'El campo stock es requerido'
    : typeof v !== 'number' ? 'El stock debe ser un valor numérico estricto.'
    : !integer(v, 0) ? 'El stock debe ser un número entero válido entre 0 y 2147483647.' : null)
  stock!: number;
}
