import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { createConnection, type Connection, type RowDataPacket } from 'mysql2/promise';

export const masterCsv = resolve(__dirname, '../../../docs/309/catalogo-maestro.csv');
const fer17Migration = resolve(__dirname, '../../../database/migrate-fer-17-price-verification.sql');

// Reserved words are case-insensitive, but quoted names and literals are not
// always. Every token carries its kind so a keyword can never be confused with
// an identifier that happens to spell the same word.
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
const identifierStart = /[A-Za-z_$\u0080-\uffff]/;
const identifierPart = /[A-Za-z0-9_$\u0080-\uffff]/;
const simpleIdentifier = /^[A-Za-z_$\u0080-\uffff][A-Za-z0-9_$\u0080-\uffff]*$/;

// Token kinds: K keyword, I identifier, Q quoted identifier with exotic content,
// S string literal, N number, V user variable, X executable comment, O operator.
function tokenizeSql(sql: string): string[] {
  const tokens: string[] = [];
  for (let index = 0; index < sql.length;) {
    const char = sql[index];
    if (/\s/.test(char)) { index++; continue; }
    // MariaDB only treats "--" as a comment when it is followed by whitespace, a
    // control character or the end of the statement. "1--1" is arithmetic.
    if (char === '#' || (char === '-' && sql[index + 1] === '-' &&
        (index + 2 >= sql.length || /[\s\u0000-\u001f]/.test(sql[index + 2])))) {
      const end = sql.indexOf('\n', index + 1);
      index = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (char === '/' && sql[index + 1] === '*' &&
        (sql[index + 2] === '!' || (sql[index + 2] === 'M' && sql[index + 3] === '!'))) {
      // Executable comments are code, not decoration. Keep the complete text so
      // an altered version can never compare as equivalent to the canonical one.
      const start = index;
      const end = sql.indexOf('*/', index + 2);
      index = end === -1 ? sql.length : end + 2;
      tokens.push(`X${sql.slice(start, index)}`);
      continue;
    }
    if (char === '/' && sql[index + 1] === '*') {
      const end = sql.indexOf('*/', index + 2);
      index = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      const start = index;
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (sql[cursor] === '\\' && char !== '`') { cursor += 2; continue; }
        if (sql[cursor] === char) {
          if (sql[cursor + 1] === char) { cursor += 2; continue; }
          cursor++; break;
        }
        cursor++;
      }
      const raw = sql.slice(start, cursor);
      if (char === '`') {
        // `simple` and simple name the same identifier. Anything else stays
        // verbatim so quoting cannot hide a different object name.
        const terminated = raw.length > 1 && raw.endsWith('`');
        const inner = terminated ? raw.slice(1, -1) : raw.slice(1);
        tokens.push(simpleIdentifier.test(inner) ? `I${inner.toLowerCase()}` : `Q${raw}`);
      } else {
        tokens.push(`S${raw}`);
      }
      index = cursor;
      continue;
    }
    if (/[0-9]/.test(char)) {
      let cursor = index + 1;
      while (cursor < sql.length && /[0-9A-Za-z_.]/.test(sql[cursor])) cursor++;
      tokens.push(`N${sql.slice(index, cursor)}`);
      index = cursor;
      continue;
    }
    if (char === '@') {
      let cursor = index + 1;
      while (cursor < sql.length && /[A-Za-z0-9_$@.]/.test(sql[cursor])) cursor++;
      tokens.push(`V${sql.slice(index, cursor).toLowerCase()}`);
      index = cursor;
      continue;
    }
    if (identifierStart.test(char)) {
      let cursor = index + 1;
      while (cursor < sql.length && identifierPart.test(sql[cursor])) cursor++;
      const word = sql.slice(index, cursor);
      const keyword = word.toUpperCase();
      tokens.push(sqlKeywords.has(keyword) ? `K${keyword}` : `I${word.toLowerCase()}`);
      index = cursor;
      continue;
    }
    const operator = operatorTokens.find(candidate => sql.startsWith(candidate, index));
    if (operator) { tokens.push(`O${operator}`); index += operator.length; continue; }
    tokens.push(`O${char}`);
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

export interface TriggerDefinition {
  name: string;
  timing: 'BEFORE' | 'AFTER';
  event: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  body: string;
}

const requiredTriggerNames = [
  'fer17_producto_alta_evento',
  'fer17_producto_precio_evento',
  'fer17_precio_evento_no_update',
  'fer17_precio_evento_no_delete',
] as const;

// FER-17 is only complete when all four triggers and both audit tables are
// present. Read the canonical definitions from the versioned migration.
export function expectedFer17Triggers(migration: string): TriggerDefinition[] {
  const pattern = /CREATE\s+OR\s+REPLACE\s+TRIGGER\s+([A-Za-z0-9_]+)\s+(BEFORE|AFTER)\s+(INSERT|UPDATE|DELETE)\s+ON\s+([A-Za-z0-9_]+)\s+FOR\s+EACH\s+ROW\s+([\s\S]+?)\/\//g;
  const found = new Map<string, TriggerDefinition>();
  for (const match of migration.matchAll(pattern)) {
    found.set(match[1].toLowerCase(), {
      name: match[1],
      timing: match[2].toUpperCase() as TriggerDefinition['timing'],
      event: match[3].toUpperCase() as TriggerDefinition['event'],
      table: match[4].toUpperCase(),
      body: match[5],
    });
  }
  const missing = requiredTriggerNames.filter(name => !found.has(name));
  if (missing.length) {
    throw new CatalogError(`La migración FER-17 no define los triggers obligatorios: ${missing.join(', ')}.`);
  }
  return requiredTriggerNames.map(name => found.get(name) as TriggerDefinition);
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

type SqlRow = Record<string, unknown>;
type SqlQuery = (sql: string, parameters?: unknown[]) => Promise<SqlRow[]>;

const DEMO_DATABASE_PREFIXES = ['ferre_demo_', 'e2e_test_'];
const DEMO_HOST_PREFIX = 'demo286-';
const DEMO_USER = 'demo286';
const DEMO_IDENTITY_TABLE = 'DEMO286_IDENTIDAD';
const DEMO_SKU_LIMIT = 100;

const demoEvidence = [
  {
    table: 'CUENTA_CORRIENTE',
    columns: ['origen_datos'],
    predicate: "origen_datos = 'DEMO'",
    description: 'cuentas corrientes con origen_datos = DEMO',
  },
  {
    table: 'PRECIO_USD_EVIDENCIA',
    columns: ['sintetica'],
    predicate: 'sintetica = 1',
    description: 'evidencias de precio sintéticas (sintetica = 1)',
  },
  {
    table: 'PEDIDO',
    columns: ['estado', 'modalidad_pago'],
    predicate: "LEFT(estado, 5) = 'DEMO_' OR LEFT(modalidad_pago, 5) = 'DEMO_'",
    description: 'pedidos con estado o modalidad de pago DEMO_*',
  },
] as const;

export function demoServerReasons(input: {
  database: string; hostname: string; users: readonly string[];
}): string[] {
  const database = input.database.trim().toLowerCase();
  const hostname = input.hostname.trim().toLowerCase();
  const users = new Set(input.users.map(user => user.trim().toLowerCase()));
  const reasons: string[] = [];
  if (DEMO_DATABASE_PREFIXES.some(prefix => database.startsWith(prefix))) {
    reasons.push(`la base "${input.database}" usa un nombre reservado para DEMO o pruebas.`);
  }
  if (hostname.startsWith(DEMO_HOST_PREFIX)) {
    reasons.push(`el servidor "${input.hostname}" usa un hostname de demostración.`);
  }
  if (users.has(DEMO_USER)) {
    reasons.push(`la conexión usa el usuario "${DEMO_USER}".`);
  }
  return reasons;
}

async function readServerIdentity(query: SqlQuery) {
  const [row] = await query(
    'SELECT DATABASE() AS base, @@hostname AS host, USER() AS user, CURRENT_USER() AS currentUser'
  );
  if (!row) throw new CatalogError('No se pudo identificar el servidor MariaDB de destino. No se modificó ningún registro.');
  const database = typeof row.base === 'string' ? row.base : '';
  if (!database) throw new CatalogError('La conexión no tiene una base seleccionada. No se modificó ningún registro.');
  const hostname = typeof row.host === 'string' ? row.host : '';
  const users = [row.user, row.currentUser]
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.split('@')[0]);
  return { database, hostname, users };
}

// Read-only guard. It runs before the import lock and again inside the write
// transaction. A missing table or column is never read as "no DEMO data":
// anything that prevents verification aborts the import.
async function assertNoDemoData(query: SqlQuery, configuredUser: string): Promise<void> {
  const identity = await readServerIdentity(query);
  const reasons = demoServerReasons({
    database: identity.database,
    hostname: identity.hostname,
    users: [...identity.users, configuredUser],
  });
  if (reasons.length) {
    throw new CatalogError(`Guarda DEMO: ${reasons.join(' ')} No se modificó ningún registro.`);
  }

  const objects = await query(
    'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
  );
  const tables = new Set(objects.map(row => String(row.name).toUpperCase()));
  if (tables.has(DEMO_IDENTITY_TABLE)) {
    throw new CatalogError(
      `Guarda DEMO: existe la tabla ${DEMO_IDENTITY_TABLE}. No se modificó ningún registro.`
    );
  }

  const requiredColumns = [
    { table: 'PRODUCTO', columns: ['codigo'] },
    ...demoEvidence.map(evidence => ({ table: evidence.table, columns: evidence.columns })),
  ];
  const missingTables = [...new Set(requiredColumns
    .filter(item => !tables.has(item.table))
    .map(item => item.table))];
  if (missingTables.length) {
    throw new CatalogError(
      `Guarda DEMO: no se puede verificar la ausencia de datos DEMO porque faltan tablas obligatorias (${missingTables.join(', ')}). Aplicá el esquema vigente y las migraciones de la documentación. No se modificó ningún registro.`
    );
  }

  const columns = await query(`
    SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('PRODUCTO', 'CUENTA_CORRIENTE', 'PRECIO_USD_EVIDENCIA', 'PEDIDO')`);
  const available = new Set(columns.map(row =>
    `${String(row.tableName).toUpperCase()}.${String(row.columnName).toUpperCase()}`));
  const missingColumns = requiredColumns
    .flatMap(item => item.columns
      .filter(column => !available.has(`${item.table}.${column}`.toUpperCase()))
      .map(column => `${item.table}.${column}`));
  if (missingColumns.length) {
    throw new CatalogError(
      `Guarda DEMO: no se puede verificar la ausencia de datos DEMO porque faltan columnas obligatorias (${missingColumns.join(', ')}). Aplicá el esquema vigente y las migraciones de la documentación. No se modificó ningún registro.`
    );
  }

  for (const evidence of demoEvidence) {
    const [found] = await query(
      `SELECT 1 AS encontrado FROM ${evidence.table} WHERE ${evidence.predicate} LIMIT 1`
    );
    if (found) {
      throw new CatalogError(
        `Guarda DEMO: la base contiene ${evidence.description}. No se modificó ningún registro.`
      );
    }
  }

  const [count] = await query(
    "SELECT COUNT(*) AS total FROM PRODUCTO WHERE codigo LIKE 'FP-DEMO-%'"
  );
  const demoSkus = Number(count?.total);
  if (!Number.isFinite(demoSkus) || demoSkus > DEMO_SKU_LIMIT) {
    throw new CatalogError(
      `Guarda DEMO: la base tiene más de ${DEMO_SKU_LIMIT} SKU con prefijo FP-DEMO-. No se modificó ningún registro.`
    );
  }
}

const DEFAULT_LOCK_TIMEOUT_SECONDS = 30;

export function masterCatalogLockName(database: string): string {
  // Stable 58-character name, below the 64-character MariaDB limit.
  const digest = createHash('sha256').update(database).digest('hex').slice(0, 40);
  return `ferre.s7.catalogo.${digest}`;
}

function lockTimeoutSeconds(): number {
  const raw = process.env.MASTER_CATALOG_LOCK_TIMEOUT_SECONDS?.trim();
  if (!raw) return DEFAULT_LOCK_TIMEOUT_SECONDS;
  if (!/^[1-9][0-9]{0,2}$/.test(raw) || Number(raw) > 300) {
    throw new CatalogError('MASTER_CATALOG_LOCK_TIMEOUT_SECONDS debe ser un entero entre 1 y 300.');
  }
  return Number(raw);
}

interface ImportLock {
  name: string;
  connection: Connection;
}

// Cooperative serialization between importers. The lock lives on its own
// session, is acquired before the transaction starts and is released only after
// the transaction finished, so the critical section includes COMMIT.
async function acquireImportLock(
  database: string,
  connectionOptions: { host: string; port: number; user: string; password: string },
): Promise<ImportLock> {
  const name = masterCatalogLockName(database);
  const timeout = lockTimeoutSeconds();
  const connection = await createConnection({
    host: connectionOptions.host,
    port: connectionOptions.port,
    user: connectionOptions.user,
    password: connectionOptions.password,
    database,
    connectTimeout: 3000,
    charset: 'utf8mb4',
  });
  try {
    const [identity] = await connection.query<RowDataPacket[]>('SELECT DATABASE() AS base');
    if (!identity[0] || identity[0].base !== database) {
      throw new CatalogError('La conexión del bloqueo no apunta a la base confirmada. No se modificó ningún registro.');
    }
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT GET_LOCK(?, ?) AS acquired', [name, timeout]
    );
    const acquired = rows[0]?.acquired;
    if (acquired === null || acquired === undefined) {
      throw new CatalogError(
        `MariaDB no pudo otorgar el bloqueo cooperativo "${name}" (GET_LOCK devolvió NULL). No se modificó ningún registro.`
      );
    }
    if (Number(acquired) !== 1) {
      throw new CatalogError(
        `Otro importador está operando sobre la base "${database}" y no liberó el bloqueo en ${timeout}s. No se modificó ningún registro.`
      );
    }
    return { name, connection };
  } catch (error) {
    await connection.end().catch(() => connection.destroy());
    throw error;
  }
}

async function releaseImportLock(lock: ImportLock): Promise<void> {
  try {
    const [rows] = await lock.connection.query<RowDataPacket[]>(
      'SELECT RELEASE_LOCK(?) AS released', [lock.name]
    );
    if (Number(rows[0]?.released) !== 1) {
      // Closing the session would free it too; never hide the warning.
      console.warn(`ADVERTENCIA: el bloqueo cooperativo "${lock.name}" ya no estaba tomado por esta conexión.`);
    }
  } catch (error) {
    console.warn(`ADVERTENCIA: no se pudo liberar el bloqueo cooperativo (${(error as { code?: string }).code ?? 'error'}); se libera al cerrar la conexión.`);
  } finally {
    await lock.connection.end().catch(() => lock.connection.destroy());
  }
}

const fer17TableColumns: Record<string, readonly string[]> = {
  FER17_PRECIO_EVENTO: [
    'id_evento', 'id_producto', 'tipo', 'precio_anterior', 'precio_nuevo', 'evidencia',
    'evidencia_anterior', 'id_admin', 'ocurrido_utc', 'resultado', 'motivo',
  ],
  PRECIO_USD_EVIDENCIA: [
    'id_producto', 'precio_verificado', 'evidencia', 'id_admin', 'verificado_utc',
    'valida', 'sintetica',
  ],
};

async function assertFer17Tables(manager: { query: SqlQuery }): Promise<void> {
  const rows = await manager.query(`
    SELECT TABLE_NAME AS name FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
      AND TABLE_NAME IN ('FER17_PRECIO_EVENTO', 'PRECIO_USD_EVIDENCIA')`);
  const present = new Set(rows.map(row => String(row.name).toUpperCase()));
  const missing = Object.keys(fer17TableColumns).filter(name => !present.has(name));
  if (missing.length) {
    throw new CatalogError(
      `Auditoría FER-17 incompleta: faltan las tablas ${missing.join(', ')}. Aplicá las migraciones FER-17 y verificá el permiso TRIGGER. No se modificó ningún registro.`
    );
  }

  const columns = await manager.query(`
    SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('FER17_PRECIO_EVENTO', 'PRECIO_USD_EVIDENCIA')`);
  const available = new Set(columns.map(row =>
    `${String(row.tableName).toUpperCase()}.${String(row.columnName).toUpperCase()}`));
  const missingColumns = Object.entries(fer17TableColumns).flatMap(([table, required]) =>
    required
      .filter(column => !available.has(`${table}.${column.toUpperCase()}`))
      .map(column => `${table}.${column}`));
  if (missingColumns.length) {
    throw new CatalogError(
      `Auditoría FER-17 incoherente: faltan las columnas ${missingColumns.join(', ')}. Aplicá las migraciones FER-17. No se modificó ningún registro.`
    );
  }
}

async function assertFer17Triggers(
  manager: { query: SqlQuery },
  expected: TriggerDefinition[],
): Promise<void> {
  const rows = await manager.query(`
    SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS tableName, ACTION_TIMING AS timing,
           EVENT_MANIPULATION AS event, ACTION_ORIENTATION AS orientation,
           ACTION_STATEMENT AS body
    FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA = DATABASE()
      AND TRIGGER_NAME IN ('fer17_producto_alta_evento', 'fer17_producto_precio_evento',
                           'fer17_precio_evento_no_update', 'fer17_precio_evento_no_delete')`);
  const actual = new Map(rows.map(row => [String(row.name).toLowerCase(), row]));

  const problems: string[] = [];
  for (const trigger of expected) {
    const row = actual.get(trigger.name.toLowerCase());
    if (!row) { problems.push(`falta ${trigger.name}`); continue; }
    if (String(row.orientation ?? '').toUpperCase() !== 'ROW' ||
        String(row.timing ?? '').toUpperCase() !== trigger.timing ||
        String(row.event ?? '').toUpperCase() !== trigger.event ||
        String(row.tableName ?? '').toUpperCase() !== trigger.table) {
      problems.push(`${trigger.name} no es ${trigger.timing} ${trigger.event} sobre ${trigger.table}`);
      continue;
    }
    if (typeof row.body !== 'string' || !triggerBodiesEquivalent(row.body, trigger.body)) {
      problems.push(`${trigger.name} tiene una definición distinta`);
    }
  }
  if (problems.length) {
    throw new CatalogError(
      `Auditoría FER-17 incompleta o alterada: ${problems.join('; ')}. Aplicá las migraciones FER-17 y verificá el permiso TRIGGER. No se modificó ningún registro.`
    );
  }
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
  const { dataSource, initializeDatabase, destroyDatabase, inTransaction } =
    await import('../config/database.config.js');
  const expectedTriggers = expectedFer17Triggers(await readFile(fer17Migration, 'utf8'));
  const query: SqlQuery = async (sql, parameters) =>
    await dataSource.query(sql, parameters) as SqlRow[];

  let lock: ImportLock | undefined;
  try {
    await initializeDatabase();
    // Fail before taking any lock or opening a write transaction.
    await assertNoDemoData(query, env.db.user);
    lock = await acquireImportLock(env.db.database, env.db);
    const result = await inTransaction(async manager => {
      const transactionQuery: SqlQuery = async (sql, parameters) =>
        await manager.query(sql, parameters) as SqlRow[];
      // A-06: the transaction must write to the destination confirmed by the
      // operator, even if the pool was reconfigured or redirected.
      const [target] = await transactionQuery('SELECT DATABASE() AS base');
      if (!target || target.base !== env.db.database) {
        throw new CatalogError(
          `La transacción no está conectada a la base confirmada. No se modificó ningún registro.`
        );
      }
      await assertNoDemoData(transactionQuery, env.db.user);

      await assertFer17Tables({ query: transactionQuery });
      // Shared-write metadata locks: they prevent concurrent DDL from changing
      // any audited definition between the checks and the inserts, while
      // remaining compatible with normal reads and writes. Kept until commit.
      await manager.query('SELECT codigo FROM PRODUCTO LIMIT 0 FOR UPDATE');
      await manager.query('SELECT id_evento FROM FER17_PRECIO_EVENTO LIMIT 0 FOR UPDATE');
      await manager.query('SELECT id_producto FROM PRECIO_USD_EVIDENCIA LIMIT 0 FOR UPDATE');
      await assertFer17Triggers({ query: transactionQuery }, expectedTriggers);

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
    try { if (lock) await releaseImportLock(lock); }
    finally { await destroyDatabase(); }
  }
}

if (require.main === module) {
  process.env.DOTENV_CONFIG_QUIET = 'true';
  process.env.DOTENV_CONFIG_DEBUG = 'false';
  main().catch((error: unknown) => {
    const code = (error as { code?: string })?.code;
    console.error(error instanceof CatalogError ? error.message :
      code === 'DATABASE_OUTCOME_UNKNOWN'
        ? 'Resultado no confirmado. Volvé a ejecutar contra el mismo destino para reconciliar por SKU.'
        : 'No se completó la carga. Revisá la configuración y el estado de MariaDB antes de reintentar.');
    process.exitCode = 1;
  });
}
