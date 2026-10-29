import { dataSource } from '../config/database.config';
import { ClienteSchema } from '../entities/active.schemas';
type ClienteListRow = { id_cliente: number; nombre_razon_social: string; email: string; fecha_creacion: Date };
export async function findAllClientes(): Promise<ClienteListRow[]> {
  return dataSource.getRepository(ClienteSchema).createQueryBuilder('c')
    .innerJoin('c.usuario', 'u')
    .select('c.id_cliente', 'id_cliente').addSelect('c.nombre_razon_social', 'nombre_razon_social')
    .addSelect('u.email', 'email').addSelect('u.fecha_creacion', 'fecha_creacion')
    .where('u.rol = :rol', { rol: 'CLIENTE' })
    .orderBy('u.fecha_creacion', 'DESC').addOrderBy('c.id_cliente', 'DESC').getRawMany<ClienteListRow>();
}
