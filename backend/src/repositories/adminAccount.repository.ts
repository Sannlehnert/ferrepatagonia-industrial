import { dataSource } from '../config/database.config';
import { ClienteSchema } from '../entities/active.schemas';

export const adminAccountClientExists = (clienteId: number): Promise<boolean> =>
  dataSource.getRepository(ClienteSchema).existsBy({ id_cliente: clienteId });
