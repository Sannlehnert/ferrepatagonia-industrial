import { findCatalogPage } from '../repositories/catalog.repository';
import { CatalogPagination } from '../validators/catalog.validator';

export async function listCatalog(pagination: CatalogPagination) {
  const { rows, total } = await findCatalogPage(pagination);
  const { page, limit } = pagination;
  const totalPages = Math.ceil(total / limit);
  return {
    productos: rows.map(row => ({
      id: Number(row.id_producto),
      nombre: row.nombre,
      codigo: row.codigo,
      categoria: { id: Number(row.id_categoria), nombre: row.categoria_nombre },
      // Contrato provisional autorizado para #189. FER-15 define el precio público.
      precio: null,
      estadoPrecio: 'PENDIENTE_DEFINICION' as const,
      disponible: Boolean(row.disponible),
    })),
    pagination: { page, limit, total, totalPages, hasNext: page < totalPages,
      hasPrevious: page > 1 && page - 1 <= totalPages },
  };
}
