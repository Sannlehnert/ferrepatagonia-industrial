import { dataSource, inTransaction } from '../config/database.config';
import { ClienteSchema, ListaPrecioSchema } from '../entities/active.schemas';

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
