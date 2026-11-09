import type { EntityManager } from 'typeorm';
import { ClienteSchema, CuentaCorrienteSchema, UsuarioSchema } from '../entities/active.schemas';

export const adminAccountClientExists = (manager: EntityManager, clienteId: number): Promise<boolean> =>
  manager.getRepository(ClienteSchema).existsBy({ id_cliente: clienteId });

export const findAccountReader = (manager: EntityManager, userId: number) =>
  manager.getRepository(UsuarioSchema).findOne({
    select: { activo: true, rol: true },
    where: { id_usuario: userId },
  });

interface ListFilters {
  clienteId?: number;
  habilitada?: boolean;
  excludeDemo: boolean;
}

export async function listAccountKeys(manager: EntityManager, filters: ListFilters, after: number, limit: number) {
  const query = manager.getRepository(CuentaCorrienteSchema).createQueryBuilder('account')
    .select(['account.id_cuenta_corriente', 'account.id_cliente'])
    .where('account.id_cliente > :after', { after })
    .orderBy('account.id_cliente', 'ASC')
    .limit(limit);
  if (filters.clienteId !== undefined) {
    query.andWhere('account.id_cliente = :client', { client: filters.clienteId });
  }
  if (filters.habilitada !== undefined) {
    query.andWhere('account.habilitada = :enabled', { enabled: Number(filters.habilitada) });
  }
  if (filters.excludeDemo) query.andWhere("account.origen_datos = 'REAL'");
  return query.getMany();
}
