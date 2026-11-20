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

export async function findPerfilByUsuarioId(idUsuario: number): Promise<PerfilRow | null> {
  return (await perfilQuery().where('u.id_usuario = :idUsuario', { idUsuario })
    .getRawOne<PerfilRow>()) ?? null;
}

// La transacción bloquea la identidad antes de escribir y vuelve a leer dentro
// del mismo contexto: si la lectura falla, no se confirma una actualización parcial.
export async function updatePerfilByUsuarioId(
  idUsuario: number,
  changes: PerfilUpdate,
): Promise<PerfilRow | null> {
  return inTransaction(async manager => {
    const usuario = await manager.getRepository(UsuarioSchema).findOne({
      select: { id_usuario: true, id_cliente: true, rol: true },
      where: { id_usuario: idUsuario },
      lock: { mode: 'pessimistic_write' },
    });
    if (!usuario || usuario.rol !== 'CLIENTE' || usuario.id_cliente == null) return null;

    const cliente = await manager.getRepository(ClienteSchema).findOne({
      select: { id_cliente: true },
      where: { id_cliente: usuario.id_cliente },
      lock: { mode: 'pessimistic_write' },
    });
    if (!cliente) return null;

    if (Object.keys(changes).length > 0) {
      const defined = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined),
      );
      if (Object.keys(defined).length > 0) {
        await manager.getRepository(ClienteSchema).update(
          { id_cliente: usuario.id_cliente },
          defined,
        );
      }
    }

    return (await perfilQuery(manager).where('u.id_usuario = :idUsuario', { idUsuario })
      .getRawOne<PerfilRow>()) ?? null;
  });
}
