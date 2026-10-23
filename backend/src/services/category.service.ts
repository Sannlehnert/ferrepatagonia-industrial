import { findActiveCategories } from '../repositories/category.repository';

export async function listActiveCategories() {
  const rows = await findActiveCategories();
  return { categorias: rows.map(row => ({ id: Number(row.id_categoria), nombre: row.nombre })) };
}
