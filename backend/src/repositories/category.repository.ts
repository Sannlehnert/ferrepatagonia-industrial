import { pool } from '../config/database.config';

type CategoryRow = { id_categoria: number; nombre: string };

export async function findActiveCategories(): Promise<CategoryRow[]> {
  // Una sola lectura: pool.query devuelve automáticamente la conexión al pool.
  return pool.query<CategoryRow[]>({ sql: `
    SELECT id_categoria, nombre
    FROM CATEGORIA
    WHERE activo = 1
    ORDER BY nombre ASC, id_categoria ASC
  `, timeout: 5000 });
}
