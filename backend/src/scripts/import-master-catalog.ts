import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Papa from 'papaparse';

export const masterCsv = resolve(__dirname, '../../../docs/309/catalogo-maestro.csv');
const fer17Migration = resolve(__dirname, '../../../database/migrate-fer-17-price-verification.sql');

// Reserved words are case-insensitive, but identifiers, quoted names and literals
// are not always. Only recognized keywords are canonicalized; everything else is
// compared verbatim so a different definition cannot look equivalent.
const sqlKeywords = new Set(`
  AFTER ALGORITHM ALL ALTER AND AS ASC BEFORE BEGIN BETWEEN BIGINT BINARY BLOB BOOL
  BOOLEAN BOTH BY CALL CASCADE CASE CHANGE CHAR CHARACTER CHECK COLLATE COLUMN
  COMMENT COMMIT CONSTRAINT CONTINUE CONVERT CREATE CROSS CURRENT_DATE CURRENT_TIME
  CURRENT_TIMESTAMP CURRENT_USER DATABASE DATABASES DATE DATETIME DECIMAL DECLARE
  DEFAULT DELETE DESC DESCRIBE DISTINCT DIV DO DOUBLE DROP DUAL EACH ELSE ELSEIF END
  ENUM ESCAPED EXISTS EXPLAIN FALSE FETCH FLOAT FOR FORCE FOREIGN FROM FULL FUNCTION
  GRANT GROUP HAVING IF IGNORE IN INDEX INNER INSERT INT INTEGER INTERVAL INTO INVOKER
  IS ITERATE JOIN KEY KEYS LEADING LEAVE LEFT LIKE LIMIT LINES LOAD LOCK LONG LONGBLOB
  LONGTEXT LOOP MATCH MEDIUMINT MEDIUMTEXT MOD MODIFIES NATURAL NEW NOT NULL NUMERIC
  OFFSET OLD ON OPEN OPTION OR ORDER OUT OUTER OVER PARTITION PRECISION PRIMARY
  PROCEDURE PURGE READ READS REAL REFERENCES REGEXP RELEASE RENAME REPEAT REPLACE
  REQUIRES RESIGNAL RESTRICT RETURN RETURNS REVOKE RIGHT RLIKE ROLLBACK ROW ROWS
  SAVEPOINT SCHEMA SELECT SEPARATOR SET SHARE SHOW SIGNAL SMALLINT SPATIAL SQL
  SQLSTATE STARTING STRAIGHT_JOIN TABLE TERMINATED TEXT THEN TINYINT TINYTEXT TO
  TRAILING TRIGGER TRUE UNDO UNION UNIQUE UNLOCK UNSIGNED UPDATE USAGE USE USING
  UTC_DATE UTC_TIME UTC_TIMESTAMP VALUES VARBINARY VARCHAR VARYING VIEW WHEN WHERE
  WHILE WITH WRITE XOR YEAR ZEROFILL NOW COALESCE CONCAT COUNT IFNULL LENGTH LOWER
  MAX MIN NULLIF ROUND SUBSTRING SUM TRIM UPPER ABS CHAR_LENGTH
`.trim().split(/\s+/));

const operatorTokens = ['<=>', '->>', '->', ':=', '<=', '>=', '<>', '!=', '||', '&&', '<<', '>>', '!<', '!>'];

function tokenizeSql(sql: string): string[] {
  const tokens: string[] = [];
  for (let index = 0; index < sql.length;) {
    const char = sql[index];
    if (/\s/.test(char)) { index++; continue; }
    if (char === '#' || (char === '-' && sql[index + 1] === '-' && /[\s]|$/.test(sql[index + 2] ?? ' '))) {
      const end = sql.indexOf('\n', index + 1);
      index = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (char === '/' && sql[index + 1] === '*' && sql[index + 2] !== '!') {
      const end = sql.indexOf('*/', index + 2);
      index = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (sql[cursor] === '\\' && char !== '`') { cursor += 2; continue; }
        if (sql[cursor] === char) {
          if (sql[cursor + 1] === char) { cursor += 2; continue; }
          cursor++; break;
        }
        cursor++;
      }
      tokens.push(sql.slice(index, cursor));
      index = cursor;
      continue;
    }
    if (/[0-9]/.test(char)) {
      let cursor = index + 1;
      while (cursor < sql.length && /[0-9A-Za-z_.]/.test(sql[cursor])) cursor++;
      tokens.push(sql.slice(index, cursor));
      index = cursor;
      continue;
    }
    if (char === '@') {
      let cursor = index + 1;
      while (cursor < sql.length && /[A-Za-z0-9_$@.]/.test(sql[cursor])) cursor++;
      tokens.push(sql.slice(index, cursor));
      index = cursor;
      continue;
    }
    if (/[A-Za-z_$\u0080-\uffff]/.test(char)) {
      let cursor = index + 1;
      while (cursor < sql.length && /[A-Za-z0-9_$\u0080-\uffff]/.test(sql[cursor])) cursor++;
      const word = sql.slice(index, cursor);
      const keyword = word.toUpperCase();
      tokens.push(sqlKeywords.has(keyword) ? keyword : word);
      index = cursor;
      continue;
    }
    const operator = operatorTokens.find(candidate => sql.startsWith(candidate, index));
    if (operator) { tokens.push(operator); index += operator.length; continue; }
    tokens.push(char);
    index++;
  }
  return tokens;
}

export function triggerBodiesEquivalent(left: string, right: string): boolean {
  const expected = tokenizeSql(left);
  const actual = tokenizeSql(right);
  return expected.length === actual.length &&
    expected.every((token, index) => token === actual[index]);
}

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
  const migration = await readFile(fer17Migration, 'utf8');
  const expectedBody = migration.match(
    /CREATE OR REPLACE TRIGGER fer17_producto_alta_evento\s+AFTER INSERT ON PRODUCTO\s+FOR EACH ROW\s+([\s\S]+?)\/\//
  )?.[1];
  if (!expectedBody) throw new CatalogError('No se pudo leer la definición de alta de la migración FER-17.');
  try {
    await initializeDatabase();
    const result = await inTransaction(async manager => {
      // Shared-write metadata lock: it prevents a concurrent DDL from taking
      // effect between the trigger check and the inserts, while remaining
      // compatible with normal reads and writes. Kept until commit or rollback.
      await manager.query('SELECT codigo FROM PRODUCTO LIMIT 0 FOR UPDATE');
      const [trigger] = await manager.query(`
        SELECT ACTION_STATEMENT AS body FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = 'fer17_producto_alta_evento'
          AND BINARY EVENT_OBJECT_TABLE = 'PRODUCTO'
          AND ACTION_TIMING = 'AFTER' AND EVENT_MANIPULATION = 'INSERT'
          AND ACTION_ORIENTATION = 'ROW'`);
      if (!trigger?.body || !triggerBodiesEquivalent(trigger.body, expectedBody)) {
        throw new CatalogError(
          'Auditoría de alta ausente, incompatible o no visible. Aplicá las migraciones FER-17 y verificá el permiso TRIGGER sobre PRODUCTO.'
        );
      }

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
