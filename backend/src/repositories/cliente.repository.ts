import { dataSource, inTransaction } from '../config/database.config';
import type { EntityManager } from 'typeorm';
import { ClienteSchema, UsuarioSchema } from '../entities/active.schemas';
import type { Cliente } from '../entities/active.schemas';
import type { EstadoAprobacionEmpresa } from '../dtos/clients/company-approval.dto';

export type ClienteListRow = {
  id_cliente: number;
  nombre_razon_social: string;
  email: string;
  fecha_creacion: Date;
  tipo_cliente: 'PARTICULAR' | 'EMPRESA';
  cuit: string | null;
  doc_cliente: string | null;
  estado_aprobacion_empresa: EstadoAprobacionEmpresa | null;
};

export type ClienteListFilters = {
  page: number;
  limit: number;
  busqueda?: string;
  tipo?: 'PARTICULAR' | 'EMPRESA';
  estadoEmpresa?: EstadoAprobacionEmpresa;
};

export type ClienteListPage = {
  data: ClienteListRow[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const clientListQuery = (manager?: EntityManager) =>
  (manager ?? dataSource).getRepository(ClienteSchema).createQueryBuilder('c')
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
    .addOrderBy('c.id_cliente', 'DESC');

export async function findAllClientes(): Promise<ClienteListRow[]> {
  return clientListQuery().getRawMany<ClienteListRow>();
}

export async function findClientesPage(filters: ClienteListFilters): Promise<ClienteListPage> {
  return inTransaction(async manager => {
    const query = clientListQuery(manager);

    if (filters.busqueda !== undefined) {
      const escaped = filters.busqueda.replace(/[!%_]/g, '!$&');
      const pattern = `%${escaped}%`;
      const explicitId = /^#\d+$/.test(filters.busqueda) && Number(filters.busqueda.slice(1)) <= 2147483647
        ? Number(filters.busqueda.slice(1))
        : null;
      const idCandidate = filters.busqueda.replace(/^#/, '');
      const searchId = explicitId ?? (/^\d+$/.test(idCandidate) && Number(idCandidate) <= 2147483647
        ? Number(idCandidate)
        : null);
      if (explicitId !== null) {
        query.andWhere('c.id_cliente = :searchId', { searchId: explicitId });
      } else {
        const idClause = searchId === null ? '' : ' OR c.id_cliente = :searchId';
        query.andWhere(
          `(LOWER(c.nombre_razon_social) LIKE LOWER(:pattern) ESCAPE '!'
            OR LOWER(u.email) LIKE LOWER(:pattern) ESCAPE '!'
            OR LOWER(c.cuit) LIKE LOWER(:pattern) ESCAPE '!'
            OR LOWER(c.doc_cliente) LIKE LOWER(:pattern) ESCAPE '!'
            ${idClause})`,
          { pattern, ...(searchId === null ? {} : { searchId }) },
        );
      }
    }

    if (filters.tipo !== undefined) {
      query.andWhere('c.tipo_cliente = :tipo', { tipo: filters.tipo });
    }

    if (filters.estadoEmpresa !== undefined) {
      // El estado solo existe en empresas; no dependemos de que el caller
      // haya elegido también el tipo para evitar resultados engañosos.
      query.andWhere('c.tipo_cliente = :tipoEmpresa', { tipoEmpresa: 'EMPRESA' });
      query.andWhere('c.estado_aprobacion_empresa = :estadoEmpresa', {
        estadoEmpresa: filters.estadoEmpresa,
      });
    }

    const total = await query.getCount();
    const totalPages = Math.ceil(total / filters.limit);
    const page = Math.min(filters.page, Math.max(1, totalPages));
    const rows = total === 0 ? [] : await query
      .offset((page - 1) * filters.limit)
      .limit(filters.limit)
      .getRawMany<ClienteListRow>();

    return { data: rows, page, limit: filters.limit, total, totalPages };
  }, { isolation: 'REPEATABLE READ' });
}

export async function findClienteById(idCliente: number): Promise<Cliente | null> {
  return dataSource.getRepository(ClienteSchema).findOne({
    where: { id_cliente: idCliente },
  });
}

export async function updateEstadoAprobacionEmpresa(
  idCliente: number,
  estado: EstadoAprobacionEmpresa,
  estadoEsperado?: EstadoAprobacionEmpresa,
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

    // La precondición opcional conserva los consumidores existentes.
    // Compara estados bajo bloqueo de fila; no detecta un ciclo ABA.
    if (estadoEsperado !== undefined && cliente.estado_aprobacion_empresa !== estadoEsperado) {
      const err = new Error('El registro de la empresa cambió. Verificá su estado antes de volver a modificarlo.');
      (err as unknown as { statusCode: number; code: string }).statusCode = 409;
      (err as unknown as { statusCode: number; code: string }).code = 'ESTADO_EMPRESA_MODIFICADO';
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