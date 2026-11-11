import { dataSource, inTransaction } from '../config/database.config';
import { ClienteSchema, UsuarioSchema } from '../entities/active.schemas';
import type { Cliente } from '../entities/active.schemas';
import type { EstadoAprobacionEmpresa } from '../dtos/clients/company-approval.dto';

type ClienteListRow = {
  id_cliente: number;
  nombre_razon_social: string;
  email: string;
  fecha_creacion: Date;
  tipo_cliente: 'PARTICULAR' | 'EMPRESA';
  cuit: string | null;
  doc_cliente: string | null;
  estado_aprobacion_empresa: EstadoAprobacionEmpresa | null;
};

export async function findAllClientes(): Promise<ClienteListRow[]> {
  return dataSource.getRepository(ClienteSchema).createQueryBuilder('c')
    .innerJoin('c.usuario', 'u')
    .select('c.id_cliente', 'id_cliente')
    .addSelect('c.nombre_razon_social', 'nombre_razon_social')
    .addSelect('c.tipo_cliente', 'tipo_cliente')
    .addSelect('c.cuit', 'cuit')
    .addSelect('c.doc_cliente', 'doc_cliente')
    .addSelect('c.estado_aprobacion_empresa', 'estado_aprobacion_empresa')
    .addSelect('u.email', 'email')
    .addSelect('u.fecha_creacion', 'fecha_creacion')
    .where('u.rol = :rol', { rol: 'CLIENTE' })
    .orderBy('u.fecha_creacion', 'DESC')
    .addOrderBy('c.id_cliente', 'DESC')
    .getRawMany<ClienteListRow>();
}

export async function findClienteById(idCliente: number): Promise<Cliente | null> {
  return dataSource.getRepository(ClienteSchema).findOne({
    where: { id_cliente: idCliente },
  });
}

export async function updateEstadoAprobacionEmpresa(
  idCliente: number,
  estado: EstadoAprobacionEmpresa,
): Promise<Cliente | null> {
  return inTransaction(async (manager) => {
    const repo = manager.getRepository(ClienteSchema);
    const cliente = await repo.findOne({
      where: { id_cliente: idCliente },
      lock: { mode: 'pessimistic_write' },
    });

    if (!cliente) {
      return null;
    }

    if (cliente.tipo_cliente !== 'EMPRESA') {
      const err = new Error('Solo las cuentas de tipo empresa admiten aprobación o rechazo.');
      (err as unknown as { statusCode: number; code: string }).statusCode = 400;
      (err as unknown as { statusCode: number; code: string }).code = 'CLIENTE_NO_ES_EMPRESA';
      throw err;
    }

    if (cliente.estado_aprobacion_empresa !== estado) {
      await repo.update(
        { id_cliente: idCliente, tipo_cliente: 'EMPRESA' },
        { estado_aprobacion_empresa: estado },
      );
      cliente.estado_aprobacion_empresa = estado;
    }

    const usuario = await manager.getRepository(UsuarioSchema).findOne({
      where: { id_cliente: idCliente },
    });
    cliente.usuario = usuario ?? undefined;

    return cliente;
  });
}