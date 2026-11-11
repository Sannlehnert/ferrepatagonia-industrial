import { dataSource, inTransaction } from '../config/database.config';
import { Categoria, CategoriaSchema } from '../entities/active.schemas';
type CategoryRow = { id_categoria: number; nombre: string };
export async function findActiveCategories(): Promise<CategoryRow[]> {
  return dataSource.getRepository(CategoriaSchema).createQueryBuilder('c')
    .select('c.id_categoria', 'id_categoria').addSelect('c.nombre', 'nombre')
    .where('c.activo = :activo', { activo: 1 })
    .orderBy('c.nombre', 'ASC').addOrderBy('c.id_categoria', 'ASC').getRawMany<CategoryRow>();
}

export function findAdminCategories(): Promise<Categoria[]> {
  return dataSource.getRepository(CategoriaSchema).find({
    select: {
      id_categoria: true,
      nombre: true,
      descripcion: true,
      activo: true,
    },
    order: { nombre: 'ASC', id_categoria: 'ASC' },
  });
}

type CategoryFields = Pick<Categoria, 'nombre' | 'descripcion'>;

export function insertCategory({ nombre, descripcion }: CategoryFields): Promise<Categoria> {
  return inTransaction(async manager => {
    const categories = manager.getRepository(CategoriaSchema);
    const inserted = await categories.insert({ nombre, descripcion, activo: 1 });
    return categories.findOneByOrFail({ id_categoria: inserted.identifiers[0].id_categoria });
  });
}

export function updateCategory(id_categoria: number, { nombre, descripcion }: Partial<CategoryFields>): Promise<Categoria | null> {
  return inTransaction(async manager => {
    const categories = manager.getRepository(CategoriaSchema);
    const result = await categories.update({ id_categoria }, { nombre, descripcion });
    // mysql2 habilita FOUND_ROWS, así que una edición sin cambios también cuenta.
    if (result.affected === 0) return null;
    return categories.findOneByOrFail({ id_categoria });
  });
}

export function deactivateCategory(id_categoria: number): Promise<Categoria | null> {
  return inTransaction(async manager => {
    const categories = manager.getRepository(CategoriaSchema);
    await categories.update({ id_categoria, activo: 1 }, { activo: 0 });
    return categories.findOneBy({ id_categoria, activo: 0 });
  });
}
