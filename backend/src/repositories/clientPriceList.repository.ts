import { dataSource, inTransaction } from '../config/database.config';
import { ClienteSchema, ListaPrecioSchema, type ListaPrecio } from '../entities/active.schemas';
import type { PriceListInput } from '../dtos/clients/price-list.dto';

function presentList(list: ListaPrecio) {
  return {
    id: list.id_lista_precio, nombre: list.nombre,
    porcentajeDescuento: list.porcentaje_descuento, activa: Boolean(list.activa),
  };
}

export async function findAdminPriceLists() {
  const lists = await dataSource.getRepository(ListaPrecioSchema).find({
    order: { nombre: 'ASC', id_lista_precio: 'ASC' },
  });
  return lists.map(presentList);
}

export function savePriceList(input: PriceListInput, id?: number) {
  const [whole, fraction = ''] = input.porcentajeDescuento.split('.');
  const values = {
    nombre: input.nombre, porcentaje_descuento: `${Number(whole)}.${fraction.padEnd(2, '0')}`,
    activa: Number(input.activa),
  };
  return inTransaction(async manager => {
    const lists = manager.getRepository(ListaPrecioSchema);
    if (id === undefined) {
      const result = await lists.insert(values);
      return { lista: presentList({ ...values, id_lista_precio: Number(result.identifiers[0].id_lista_precio) }), changed: true };
    }

    const current = await lists.findOne({ where: { id_lista_precio: id }, lock: { mode: 'pessimistic_write' } });
    if (!current) return null;
    const changed = current.nombre !== values.nombre || current.porcentaje_descuento !== values.porcentaje_descuento
      || current.activa !== values.activa;
    if (changed) await lists.update(id, values);
    return { lista: presentList({ ...values, id_lista_precio: id }), changed };
  });
}

type AssignedListRow = {
  idCliente: number;
  idListaPrecio: number;
  nombre: string;
  activa: number;
};

export async function findClientPriceLists() {
  const [lists, assignments] = await Promise.all([
    dataSource.getRepository(ListaPrecioSchema).find({
      select: { id_lista_precio: true, nombre: true, porcentaje_descuento: true },
      where: { activa: 1 },
      order: { nombre: 'ASC', id_lista_precio: 'ASC' },
    }),
    dataSource.getRepository(ClienteSchema).createQueryBuilder('c')
      .innerJoin('c.lista_precio', 'l')
      .select('c.id_cliente', 'idCliente')
      .addSelect('l.id_lista_precio', 'idListaPrecio')
      .addSelect('l.nombre', 'nombre')
      .addSelect('l.activa', 'activa')
      .getRawMany<AssignedListRow>(),
  ]);

  return {
    listas: lists.map(list => ({
      id: list.id_lista_precio,
      nombre: list.nombre,
      porcentajeDescuento: list.porcentaje_descuento,
    })),
    asignaciones: assignments.map(row => ({ ...row, activa: Boolean(row.activa) })),
  };
}

export function setClientPriceList(idCliente: number, idListaPrecio: number | null) {
  return inTransaction(async manager => {
    const clients = manager.getRepository(ClienteSchema);
    const client = await clients.findOne({
      where: { id_cliente: idCliente },
      lock: { mode: 'pessimistic_write' },
    });
    if (!client) return { status: 'client-not-found' } as const;

    const list = idListaPrecio === null ? null : await manager.getRepository(ListaPrecioSchema).findOne({
      where: { id_lista_precio: idListaPrecio },
      lock: { mode: 'pessimistic_read' },
    });
    if (idListaPrecio !== null && !list) return { status: 'list-not-found' } as const;
    if (list && !list.activa) return { status: 'list-inactive' } as const;

    const previousId = client.id_lista_precio;
    if (previousId !== idListaPrecio) {
      await clients.update(idCliente, { id_lista_precio: idListaPrecio });
    }
    return {
      status: 'saved',
      previousId,
      lista: list ? { idListaPrecio: list.id_lista_precio, nombre: list.nombre, activa: true } : null,
    } as const;
  });
}
