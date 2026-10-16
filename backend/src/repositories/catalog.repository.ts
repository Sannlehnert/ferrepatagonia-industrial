import { pool } from '../config/database.config';
import { CatalogPagination } from '../validators/catalog.validator';

type CatalogRow = {
  id_producto: number;
  nombre: string;
  codigo: string;
  id_categoria: number;
  categoria_nombre: string;
  disponible: number;
};

export async function findCatalogPage({ limit, offset }: CatalogPagination) {
  const connection = await pool.getConnection();
  let reusable = true;
  try {
    // Afecta solo a la siguiente transacción, no al aislamiento de la sesión.
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const [count] = await connection.query<{ total: bigint }[]>({ sql: `
      SELECT COUNT(*) AS total
      FROM PRODUCTO p INNER JOIN CATEGORIA c ON c.id_categoria = p.id_categoria
      WHERE p.activo = 1 AND c.activo = 1
    `, timeout: 5000 });
    const rows = await connection.query<CatalogRow[]>({ sql: `
      SELECT p.id_producto, p.nombre, p.codigo, c.id_categoria,
             c.nombre AS categoria_nombre, (p.stock > 0) AS disponible
      FROM PRODUCTO p INNER JOIN CATEGORIA c ON c.id_categoria = p.id_categoria
      WHERE p.activo = 1 AND c.activo = 1
      ORDER BY p.id_producto ASC
      LIMIT ? OFFSET ?
    `, timeout: 5000 }, [limit, offset]);
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
