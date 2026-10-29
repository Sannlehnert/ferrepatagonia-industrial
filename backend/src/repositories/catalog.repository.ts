import { pool } from '../config/catalog-snapshot.config';
import { CatalogPagination } from '../validators/catalog.validator';

type CatalogRow = {
  id_producto: number;
  nombre: string;
  codigo: string;
  id_categoria: number;
  categoria_nombre: string;
  disponible: number;
};

export async function findCatalogPage({ limit, offset, categoria, busqueda }: CatalogPagination) {
  const where = 'p.activo = 1 AND c.activo = 1'
    + (categoria === undefined ? '' : ' AND p.id_categoria = ?')
    + (busqueda === undefined ? '' : " AND (p.nombre LIKE ? ESCAPE '!' OR p.codigo LIKE ? ESCAPE '!')");
  const parameters: (string | number)[] = categoria === undefined ? [] : [categoria];
  if (busqueda !== undefined) {
    // Escape explícito: %, _ y el propio ! se buscan literalmente.
    const pattern = `%${busqueda.replace(/[!%_]/g, '!$&')}%`;
    parameters.push(pattern, pattern);
  }
  const connection = await pool.getConnection();
  let reusable = true;
  try {
    // Afecta solo a la siguiente transacción, no al aislamiento de la sesión.
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const [count] = await connection.query<{ total: bigint }[]>({ sql: `
      SELECT COUNT(*) AS total
      FROM PRODUCTO p INNER JOIN CATEGORIA c ON c.id_categoria = p.id_categoria
      WHERE ${where}
    `, timeout: 5000 }, parameters);
    const rows = await connection.query<CatalogRow[]>({ sql: `
      SELECT p.id_producto, p.nombre, p.codigo, c.id_categoria,
             c.nombre AS categoria_nombre, (p.stock > 0) AS disponible
      FROM PRODUCTO p INNER JOIN CATEGORIA c ON c.id_categoria = p.id_categoria
      WHERE ${where}
      ORDER BY p.id_producto ASC
      LIMIT ? OFFSET ?
    `, timeout: 5000 }, [...parameters, limit, offset]);
    await connection.commit();
    return { rows, total: Number(count.total) };
  } catch (error) {
    // Descartar también si falló la configuración previa a START TRANSACTION.
    reusable = false;
    try { await connection.rollback(); } catch { /* La conexión se destruye abajo. */ }
    throw error;
  } finally {
    if (reusable) connection.release();
    else connection.destroy();
  }
}
