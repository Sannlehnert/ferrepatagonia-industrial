import { dataSource } from '../config/database.config';
import { UsuarioSchema } from '../entities/active.schemas';
import type { Role } from '../types/auth';
interface UsuarioSessionRow {
  id_usuario: number; email: string; rol: Role; activo: number;
  nombre_razon_social: string | null; tipo_cliente: 'PARTICULAR' | 'EMPRESA' | null;
}
function sessionQuery() {
  return dataSource.getRepository(UsuarioSchema).createQueryBuilder('u').leftJoin('u.cliente', 'c')
    .select('u.id_usuario', 'id_usuario').addSelect('u.email', 'email')
    .addSelect('u.rol', 'rol').addSelect('u.activo', 'activo')
    .addSelect('c.nombre_razon_social', 'nombre_razon_social').addSelect('c.tipo_cliente', 'tipo_cliente');
}
export async function findUsuarioById(id: number): Promise<UsuarioSessionRow | null> {
  return await sessionQuery().where('u.id_usuario = :id', { id }).getRawOne<UsuarioSessionRow>() ?? null;
}
export async function findUsuarioByEmail(email: string) {
  return sessionQuery().addSelect('u.password_hash', 'password_hash')
    .where('u.email = :email', { email }).getRawOne<UsuarioSessionRow & { password_hash: string }>();
}
