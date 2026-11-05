import { integer, parseInteger, Rule } from '../rules';
import type { DtoPolicy } from '../validation';

export class ClientIdParams {
  @Rule(value => integer(value, 1) ? null : 'ID de cliente inválido.')
  id!: number;
}

export class PriceListAssignment {
  @Rule(value => value === null || integer(value, 1) ? null : 'Indicá una lista válida o null para retirar la asignación.')
  idListaPrecio!: number | null;
}

export const clientIdPolicy: DtoPolicy<ClientIdParams> = {
  type: ClientIdParams,
  fields: ['id'],
  prepare: input => ({ id: parseInteger(input.id, 2147483647) }),
  unknownError: 'ID de cliente inválido.',
  objectError: 'ID de cliente inválido.',
};

export const priceListAssignmentPolicy: DtoPolicy<PriceListAssignment> = {
  type: PriceListAssignment,
  fields: ['idListaPrecio'],
  unknownError: 'La solicitud contiene campos no permitidos.',
  objectError: 'El cuerpo de la solicitud debe ser un objeto JSON.',
};
