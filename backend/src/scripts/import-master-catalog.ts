import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Papa from 'papaparse';

export const masterCsv = resolve(__dirname, '../../../docs/309/catalogo-maestro.csv');

const fields = [
  'numero', 'sku', 'categoria', 'nombre_propuesto', 'descripcion_propuesta',
  'variante_original', 'descripcion_original', 'presentacion', 'stock_presentacion'
] as const;

class CatalogError extends Error {}

export function parseMasterCatalog(csv: string) {
  const { data: [header = [], ...rows], errors } = Papa.parse<string[]>(csv, {
    delimiter: ',', skipEmptyLines: true
  });
  if (errors.length || new Set(header).size !== header.length ||
      fields.some(field => !header.includes(field)) || rows.length !== 100) {
    throw new CatalogError('CSV inválido: se requieren las columnas del catálogo y 100 filas válidas.');
  }

  const seen = new Set<string>();
  return rows.map((row, index) => {
    const get = (field: typeof fields[number]) => row[header.indexOf(field)] ?? '';
    const sku = get('sku');
    const category = get('categoria');
    const name = get('nombre_propuesto');
    const stock = get('stock_presentacion');
    const description = [
      get('descripcion_propuesta'),
      `Variante original: ${get('variante_original')}`,
      `Ficha original: ${get('descripcion_original')}`,
      `Presentación: ${get('presentacion')}`
    ].join('\n');
    if (row.length !== header.length || get('numero') !== String(index + 1) ||
        fields.some(field => !get(field).trim() || get(field) !== get(field).trim()) ||
        !/^FP-DEMO-[A-Z0-9-]{1,92}$/.test(sku) || seen.has(sku) ||
        category.length > 150 || name.length > 200 || Buffer.byteLength(description) > 65535 ||
        !/^(0|[1-9][0-9]*)$/.test(stock) || Number(stock) > 2147483647) {
      throw new CatalogError(`Fila de catálogo inválida o SKU repetido (registro ${index + 1}).`);
    }
    seen.add(sku);
    return { sku, category, name, description, stock: Number(stock) };
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--confirmar-destino') {
    throw new CatalogError('Uso: npm run catalogo:importar-maestro -- --confirmar-destino HOST:PUERTO/BASE');
  }
  const rows = parseMasterCatalog(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(masterCsv)));
  const { env } = await import('../config/env.config.js');
  if (args[1] !== `${env.db.host}:${env.db.port}/${env.db.database}`) {
    throw new CatalogError('El destino confirmado no coincide con la configuración del backend.');
  }
  const { initializeDatabase, destroyDatabase, inTransaction } = await import('../config/database.config.js');
  try {
    await initializeDatabase();
    const result = await inTransaction(async manager => {
      const uniqueSku = await manager.query(`
        SELECT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PRODUCTO' AND NON_UNIQUE = 0
        GROUP BY INDEX_NAME HAVING COUNT(*) = 1
          AND MAX(COLUMN_NAME = 'codigo' AND SUB_PART IS NULL) = 1`);
      if (!uniqueSku.length) throw new CatalogError('PRODUCTO debe tener una restricción única completa por SKU.');

      const categories = new Map<string, number>();
      for (const name of new Set(rows.map(row => row.category))) {
        const matches: Array<{ id_categoria: number; activo: number }> = await manager.query(
          'SELECT id_categoria, activo FROM CATEGORIA WHERE nombre = ? LOCK IN SHARE MODE', [name]
        );
        if (matches.length !== 1 || Number(matches[0].activo) !== 1) {
          throw new CatalogError(`Se requiere una sola categoría activa y sin homónimos: ${name}.`);
        }
        categories.set(name, matches[0].id_categoria);
      }

      const inserted: string[] = [];
      const preserved: Array<{ sku: string; codigoExistente: string }> = [];
      const findSku = async (sku: string): Promise<Array<{ codigo: string }>> =>
        manager.query('SELECT codigo FROM PRODUCTO WHERE codigo = ?', [sku]);

      for (const row of rows) {
        let [existing] = await findSku(row.sku);
        if (!existing) {
          try {
            await manager.query(`
              INSERT INTO PRODUCTO
                (codigo, nombre, descripcion, stock, id_categoria, precio, descuento_especial_pct, imagen, activo)
              VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 0)`,
            [row.sku, row.name, row.description, row.stock, categories.get(row.category)]);
            inserted.push(row.sku);
          } catch (error) {
            // A concurrent insert can win after the lookup. Only skip a confirmed SKU match.
            if ((error as { code?: string }).code !== 'ER_DUP_ENTRY') throw error;
            [existing] = await findSku(row.sku);
            if (!existing) throw error;
          }
        }
        if (existing) preserved.push({ sku: row.sku, codigoExistente: existing.codigo });
      }
      return { insertados: inserted, conservados: preserved };
    }, { isolation: 'READ COMMITTED' });
    console.log(JSON.stringify(result));
  } finally {
    await destroyDatabase();
  }
}

if (require.main === module) {
  process.env.DOTENV_CONFIG_QUIET = 'true';
  main().catch((error: unknown) => {
    const code = (error as { code?: string })?.code;
    console.error(error instanceof CatalogError ? error.message :
      code === 'DATABASE_OUTCOME_UNKNOWN'
        ? 'Resultado no confirmado. Volvé a ejecutar contra el mismo destino para reconciliar por SKU.'
        : 'No se completó la carga. Revisá la configuración y el estado de MariaDB antes de reintentar.');
    process.exitCode = 1;
  });
}
