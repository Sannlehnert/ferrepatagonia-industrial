import { dataSource } from '../config/database.config';
import { CategoriaSchema } from '../entities/active.schemas';
type CategoryRow = { id_categoria: number; nombre: string };
export async function findActiveCategories(): Promise<CategoryRow[]> {
  return dataSource.getRepository(CategoriaSchema).createQueryBuilder('c')
    .select('c.id_categoria', 'id_categoria').addSelect('c.nombre', 'nombre')
    .where('c.activo = :activo', { activo: 1 })
    .orderBy('c.nombre', 'ASC').addOrderBy('c.id_categoria', 'ASC').getRawMany<CategoryRow>();
}
