import type { EntityManager } from 'typeorm';
import { dataSource, inTransaction } from '../config/database.config';
import { ClienteSchema, UsuarioSchema } from '../entities/active.schemas';

export interface PerfilRow {
  id_usuario: number;
  email: string;
  tipo_cliente: 'PARTICULAR' | 'EMPRESA';
  nombre_razon_social: string;
  doc_cliente: string | null;
  cuit: string | null;
  telefono: string | null;
  direccion: string | null;
  estado_aprobacion_empresa: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | null;
  cuenta_corriente_habilitada: number | null;
}

export interface PerfilUpdate {
  telefono?: string | null;
  direccion?: string | null;
}

export type PerfilUpdateRejection =
  | 'USUARIO_INACTIVO'
  | 'CLIENTE_INACTIVO'
  | 'NO_AUTORIZADO'
  | 'NO_ENCONTRADO';

export type PerfilUpdateResult =
  | { ok: true; perfil: PerfilRow }
  | { ok: false; reason: PerfilUpdateRejection };

function perfilQuery(manager?: EntityManager) {
  return (manager ?? dataSource).getRepository(UsuarioSchema).createQueryBuilder('u')
    .innerJoin('u.cliente', 'c')
    .leftJoin('CUENTA_CORRIENTE', 'cc', 'cc.id_cliente = c.id_cliente')
    .select('u.id_usuario', 'id_usuario')
    .addSelect('u.email', 'email')
    .addSelect('c.tipo_cliente', 'tipo_cliente')
    .addSelect('c.nombre_razon_social', 'nombre_razon_social')
    .addSelect('c.doc_cliente', 'doc_cliente')
    .addSelect('c.cuit', 'cuit')
    .addSelect('c.telefono', 'telefono')
    .addSelect('c.direccion', 'direccion')
    .addSelect('c.estado_aprobacion_empresa', 'estado_aprobacion_empresa')
    .addSelect('cc.habilitada', 'cuenta_corriente_habilitada');
}

const perfilActivo = (query: ReturnType<typeof perfilQuery>, idUsuario: number) => query
  .where('u.id_usuario = :idUsuario', { idUsuario })
  .andWhere('u.activo = 1')
  .andWhere('u.rol = :rol', { rol: 'CLIENTE' })
  .andWhere('u.id_cliente IS NOT NULL')
  .andWhere('c.activo = 1');

export async function findPerfilByUsuarioId(idUsuario: number): Promise<PerfilRow | null> {
  return (await perfilActivo(perfilQuery(), idUsuario).getRawOne<PerfilRow>()) ?? null;
}

// Orden global de locks del proyecto: CLIENTE -> USUARIO. El primer SELECT solo
// localiza el vínculo sin bloquear; la identidad se revalida bajo los dos locks.
export async function updatePerfilByUsuarioId(
  idUsuario: number,
  changes: PerfilUpdate,
): Promise<PerfilUpdateResult> {
  return inTransaction(async manager => {
    const identity = await manager.getRepository(UsuarioSchema).findOne({
      select: { id_cliente: true },
      where: { id_usuario: idUsuario },
    });
    if (!identity || identity.id_cliente == null) return { ok: false, reason: 'NO_ENCONTRADO' };
    const idCliente = identity.id_cliente;

    const cliente = await manager.getRepository(ClienteSchema).findOne({
      select: { id_cliente: true, activo: true },
      where: { id_cliente: idCliente },
      lock: { mode: 'pessimistic_write' },
    });
    if (!cliente) return { ok: false, reason: 'NO_ENCONTRADO' };
    if (cliente.activo !== 1) return { ok: false, reason: 'CLIENTE_INACTIVO' };

    const usuario = await manager.getRepository(UsuarioSchema).findOne({
      select: { id_usuario: true, id_cliente: true, rol: true, activo: true },
      where: { id_usuario: idUsuario },
      lock: { mode: 'pessimistic_write' },
    });
    if (!usuario) return { ok: false, reason: 'NO_ENCONTRADO' };
    if (usuario.activo !== 1) return { ok: false, reason: 'USUARIO_INACTIVO' };
    if (usuario.rol !== 'CLIENTE' || usuario.id_cliente !== idCliente) {
      return { ok: false, reason: 'NO_AUTORIZADO' };
    }

    if (Object.keys(changes).length > 0) {
      const defined = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined),
      );
      if (Object.keys(defined).length > 0) {
        await manager.getRepository(ClienteSchema).update(
          { id_cliente: idCliente },
          defined,
        );
      }
    }

    const perfil = await perfilActivo(perfilQuery(manager), idUsuario).getRawOne<PerfilRow>();
    // Una relectura vacía después de escribir es una inconsistencia, no un
    // rechazo autorizado: debe revertir la transacción, no confirmarla.
    if (!perfil) throw new Error('No se pudo releer el perfil actualizado.');
    return { ok: true, perfil };
  });
}
