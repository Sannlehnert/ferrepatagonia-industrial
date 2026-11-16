import { dataSource } from '../config/database.config';
import type { QueryRunner } from 'typeorm';
import { UsuarioSchema } from '../entities/active.schemas';
import type { Role } from '../types/auth';
interface UsuarioSessionRow {
  id_usuario: number; email: string; rol: Role; activo: number;
  nombre_razon_social: string | null; tipo_cliente: 'PARTICULAR' | 'EMPRESA' | null;
  estado_aprobacion_empresa: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | null;
  cuenta_corriente_habilitada?: number | null;
}
function sessionQuery(includeAccount = false) {
  const query = dataSource.getRepository(UsuarioSchema).createQueryBuilder('u').leftJoin('u.cliente', 'c')
    .select('u.id_usuario', 'id_usuario').addSelect('u.email', 'email')
    .addSelect('u.rol', 'rol').addSelect('u.activo', 'activo')
    .addSelect('c.nombre_razon_social', 'nombre_razon_social').addSelect('c.tipo_cliente', 'tipo_cliente')
    .addSelect('c.estado_aprobacion_empresa', 'estado_aprobacion_empresa');
  if (includeAccount) {
    query.leftJoin('CUENTA_CORRIENTE', 'cc', 'cc.id_cliente = c.id_cliente')
      .addSelect('cc.habilitada', 'cuenta_corriente_habilitada');
  }
  return query;
}
export async function findUsuarioById(id: number, runner?: QueryRunner, includeAccount = false): Promise<UsuarioSessionRow | null> {
  const query = sessionQuery(includeAccount).where('u.id_usuario = :id', { id });
  if (runner) query.setQueryRunner(runner);
  return await query.getRawOne<UsuarioSessionRow>() ?? null;
}
export async function findUsuarioByEmail(email: string) {
  return sessionQuery().addSelect('u.password_hash', 'password_hash')
    .where('u.email = :email', { email }).getRawOne<UsuarioSessionRow & { password_hash: string }>();
}
