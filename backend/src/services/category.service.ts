import type { CreateCategory, UpdateCategory } from '../dtos/categories/category.dto';
import { deactivateCategory, findActiveCategories, insertCategory, updateCategory } from '../repositories/category.repository';

export async function listActiveCategories() {
  const rows = await findActiveCategories();
  return { categorias: rows.map(row => ({ id: Number(row.id_categoria), nombre: row.nombre })) };
}

export function createAdminCategory({ nombre, descripcion }: CreateCategory) {
  return insertCategory({ nombre, descripcion: descripcion ?? null });
}

export function updateAdminCategory(id: number, input: UpdateCategory) {
  return updateCategory(id, input);
}

export function deactivateAdminCategory(id: number) {
  return deactivateCategory(id);
}
