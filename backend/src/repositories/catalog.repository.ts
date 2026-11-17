import { pool } from '../config/catalog-snapshot.config';
import type { CatalogOrder } from '../dtos/catalog/catalog-query.dto';
import { CatalogPagination } from '../validators/catalog.validator';
import { nonBlankPriceEvidence, priceEvidenceAdmin, productPriceEvidence, sqlUTC } from './product-price-evidence.sql';

// Solo estas cláusulas internas llegan a ORDER BY; nunca se interpola el query string.
const ORDER_BY: Readonly<Record<CatalogOrder, string>> = Object.freeze({
  predeterminado: 'p.id_producto ASC',
  nombre_asc: 'p.nombre ASC, p.id_producto ASC',
  nombre_desc: 'p.nombre DESC, p.id_producto ASC',
  precio_asc: 'precio_publico_usd IS NULL, precio_publico_usd ASC, p.id_producto ASC',
  precio_desc: 'precio_publico_usd IS NULL, precio_publico_usd DESC, p.id_producto ASC',
});

// FER17-v1 (PUBLICO, USD, cantidad 1). ROUND sobre DECIMAL aplica HALF_UP.
const PUBLIC_PRICE = `CASE WHEN ea.id_usuario IS NOT NULL AND e.sintetica = 0 AND p.precio > 0
    AND COALESCE(p.descuento_especial_pct, 0) BETWEEN 0 AND 99.99
  THEN NULLIF(ROUND(p.precio * (100.00 - COALESCE(p.descuento_especial_pct, 0)) * 0.01, 2), 0)
  END`;

function resolveOrderBy(orden: CatalogOrder | undefined): string {
  return orden !== undefined && Object.hasOwn(ORDER_BY, orden)
    ? ORDER_BY[orden] : ORDER_BY.predeterminado;
}

type CatalogRow = {
  id_producto: number;
  nombre: string;
  codigo: string;
  imagen: string | null;
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

export async function findCatalogPage({ limit, offset, categoria, busqueda, orden }: CatalogPagination) {
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
    const priceOrder = orden === 'precio_asc' || orden === 'precio_desc';
    const priceParameters = priceOrder ? [sqlUTC(new Date()), nonBlankPriceEvidence] : [];
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const [count] = await connection.query<{ total: bigint }[]>({ sql: `
      SELECT COUNT(*) AS total
      FROM PRODUCTO p INNER JOIN CATEGORIA c ON c.id_categoria = p.id_categoria
      WHERE ${where}
    `, timeout: 5000 }, parameters);
    const rows = await connection.query<CatalogRow[]>({ sql: `
      SELECT p.id_producto, p.nombre, p.codigo, p.imagen, c.id_categoria,
             c.nombre AS categoria_nombre, (p.stock > 0) AS disponible
             ${priceOrder ? `, ${PUBLIC_PRICE} AS precio_publico_usd` : ''}
      FROM PRODUCTO p INNER JOIN CATEGORIA c ON c.id_categoria = p.id_categoria
      ${priceOrder ? `LEFT JOIN PRECIO_USD_EVIDENCIA e ON ${productPriceEvidence('?', '?')}
      LEFT JOIN USUARIO ea ON ${priceEvidenceAdmin}` : ''}
      WHERE ${where}
      ORDER BY ${resolveOrderBy(orden)}
      LIMIT ? OFFSET ?
    `, timeout: 5000 }, [...priceParameters, ...parameters, limit, offset]);
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
