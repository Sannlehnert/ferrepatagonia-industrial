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

export type CatalogProductDetailRow = {
  id_producto: number;
  nombre: string;
  codigo: string;
  descripcion: string | null;
  imagen: string | null;
  stock: number;
  id_categoria: number;
  categoria_nombre: string;
};

export async function findCatalogProductById(id: number): Promise<CatalogProductDetailRow | null> {
  const connection = await pool.getConnection();
  let reusable = true;
  try {
    const rows = await connection.query<CatalogProductDetailRow[]>({ sql: `
      SELECT p.id_producto, p.nombre, p.codigo, p.descripcion, p.imagen, p.stock,
             c.id_categoria, c.nombre AS categoria_nombre
      FROM PRODUCTO p INNER JOIN CATEGORIA c ON c.id_categoria = p.id_categoria
      WHERE p.id_producto = ? AND p.activo = 1 AND c.activo = 1
      LIMIT 1
    `, timeout: 5000 }, [id]);
    return rows[0] ?? null;
  } catch (error) {
    reusable = false;
    throw error;
  } finally {
    if (reusable) connection.release();
    else connection.destroy();
  }
}

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
