const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const { createServer } = require('node:net');
const { resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const mariadb = require('mariadb');
const { parseMasterCatalog, masterCsv } = require('../dist/scripts/import-master-catalog.js');
const { withTestSignals } = require('./helpers/disposable-test-process.cjs');

const docker = (args, input) =>
  execFileSync('docker', args, { input, encoding: 'utf8', timeout: 60000, stdio: 'pipe' }).trim();
const backend = resolve(__dirname, '..');
const rows = parseMasterCatalog(readFileSync(masterCsv, 'utf8'));
const names = [...new Set(rows.map(row => row.category))];

async function backendPort() {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((done, fail) => probe.close(error => error ? fail(error) : done()));
  return String(port);
}

test('carga normal: 100/0/0, reinicio de API y MariaDB, conflictos y recuperación', async t => {
  await withTestSignals(async signal => {
    const run = `master-catalog-${randomUUID()}`;
    const volume = `${run}-data`;
    const label = `ferrepatagonia.master-catalog=${run}`;
    const database = 'master_catalog_test';
    const password = randomUUID();
    let connection;
    let api;
    let apiClosed;
    let volumeCreated = false;
    const inventory = (type, ...args) => docker([type, 'ls', ...args, '-q', '--filter', `label=${label}`]);
    const checkAbort = () => signal.throwIfAborted();
    const connect = async () => {
      const binding = docker(['port', run, '3306/tcp']);
      const port = Number(binding.split(':').at(-1));
      assert.match(binding, /^127\.0\.0\.1:\d+$/);
      for (let attempt = 0; attempt < 45; attempt++) {
        checkAbort();
        try {
          connection = await mariadb.createConnection({
            host: '127.0.0.1', port, user: 'root', password, database, connectTimeout: 1000
          });
          return port;
        } catch (error) {
          if (attempt === 44) throw error;
          await delay(1000, undefined, { signal });
        }
      }
    };
    const startApi = async () => {
      api = spawn(process.execPath, ['--require', './test/helpers/test-env.cjs', 'dist/server.js'], {
        cwd: backend, env, stdio: ['ignore', 'pipe', 'pipe']
      });
      apiClosed = once(api, 'close');
      // Attach a rejection handler immediately so a spawn failure can be reported by the race.
      apiClosed.catch(() => {});
      let startup = '';
      await Promise.race([
        new Promise(done => {
          api.stdout.on('data', chunk => {
            startup += chunk;
            if (startup.includes(`API disponible en puerto ${env.PORT}`)) done();
          });
        }),
        apiClosed.then(([code]) => { throw Error(`La API terminó antes de escuchar: ${code}`); }),
        delay(10000, undefined, { signal, ref: false }).then(() => { throw Error('La API no inició'); })
      ]);
    };
    const stopApi = async () => {
      if (!api) return;
      api.kill();
      try { await apiClosed; } finally { api = undefined; }
    };
    let env;
    const invoke = (target = `127.0.0.1:${env.DB_PORT}/${database}`) => {
      checkAbort();
      const result = spawnSync(process.execPath, [
        '--require', './test/helpers/test-env.cjs', 'dist/scripts/import-master-catalog.js',
        '--confirmar-destino', target
      ], { cwd: backend, env, encoding: 'utf8', timeout: 60000 });
      if (result.error) throw result.error;
      return result;
    };
    const load = () => {
      const result = invoke();
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const products = () => connection.query('SELECT * FROM PRODUCTO ORDER BY id_producto');
    const events = () => connection.query('SELECT * FROM FER17_PRECIO_EVENTO ORDER BY id_evento');
    try {
      docker(['volume', 'create', '--label', label, volume]);
      volumeCreated = true;
      docker(['run', '-d', '--name', run, '--label', label, '-p', '127.0.0.1::3306',
        '-v', `${volume}:/var/lib/mysql`, '-e', `MARIADB_ROOT_PASSWORD=${password}`,
        '-e', `MARIADB_DATABASE=${database}`, 'mariadb:11.4']);
      const port = await connect();
      const apply = file => docker(['exec', '-i', run, 'sh', '-c',
        'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE"'],
      readFileSync(resolve(backend, '../database', file)));
      for (const file of ['schema.sql', 'migrate-fer-20-account-movements.sql',
        'migrate-fer-17-pricing-evidence.sql', 'migrate-fer-17-price-verification.sql']) apply(file);
      env = {
        ...process.env, DOTENV_CONFIG_PATH: resolve(__dirname, 'helpers/nonexistent.env'),
        DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_NAME: database,
        DB_USER: 'root', DB_PASSWORD: password, JWT_SECRET: randomUUID(), PORT: await backendPort(),
        PRODUCT_IMAGE_STORAGE_DIR: '', RECEIPT_STORAGE_DIR: '', IMPORT_STORAGE_DIR: ''
      };
      await startApi();
      assert.match(invoke('destino-incorrecto').stderr, /destino confirmado/);
      assert.match(invoke().stderr, /categoría activa/);
      for (const name of names) {
        await connection.query('INSERT INTO CATEGORIA (nombre, activo) VALUES (?, 1)', [name]);
      }
      await connection.query('INSERT INTO CATEGORIA (nombre, activo) VALUES (?, 0)', [names[0]]);
      const duplicate = await invoke();
      assert.equal(duplicate.status, 1);
      assert.match(duplicate.stderr, /sin homónimos/);
      await connection.query('DELETE FROM CATEGORIA WHERE nombre = ? AND activo = 0', [names[0]]);

      const [{ id_categoria: category }] = await connection.query('SELECT id_categoria FROM CATEGORIA WHERE nombre = ?', [names[0]]);
      await connection.query(`INSERT INTO PRODUCTO
        (codigo, nombre, id_categoria, precio, stock, activo)
        VALUES ('CONTROL-AJENO', 'Producto ajeno', ?, 77.55, 9, 1)`, [category]);
      const [unrelated] = await products();
      const [unrelatedEvent] = await events();

      await connection.query(`
        CREATE TRIGGER catalog_test_fail BEFORE INSERT ON PRODUCTO FOR EACH ROW
        BEGIN
          IF NEW.codigo = '${rows[49].sku}' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fallo intencional';
          END IF;
        END`);
      assert.equal(invoke().status, 1);
      assert.deepEqual(await products(), [unrelated]);
      assert.deepEqual(await events(), [unrelatedEvent]);
      await connection.query('DROP TRIGGER catalog_test_fail');

      assert.deepEqual(load(), { insertados: rows.map(row => row.sku), conservados: [] });
      const first = await products();
      const firstEvents = await events();
      assert.equal(first.length, 101);
      assert.equal(firstEvents.length, 101);
      assert.deepEqual(first[0], unrelated);
      assert.deepEqual(firstEvents[0], unrelatedEvent);
      const categories = new Map((await connection.query('SELECT id_categoria, nombre FROM CATEGORIA'))
        .map(row => [row.id_categoria, row.nombre]));
      for (const [index, row] of rows.entries()) {
        const product = first[index + 1];
        assert.equal(product.codigo, row.sku);
        assert.equal(categories.get(product.id_categoria), row.category);
        assert.equal(product.nombre, row.name);
        assert.equal(product.descripcion, row.description);
        assert.equal(product.stock, row.stock);
        assert.equal(product.activo, 0);
        for (const field of ['precio', 'descuento_especial_pct', 'imagen']) assert.equal(product[field], null);
        const event = firstEvents[index + 1];
        assert.equal(event.id_producto, product.id_producto);
        assert.equal(event.tipo, 'ALTA');
        assert.equal(event.precio_nuevo, null);
      }
      assert.equal((await connection.query('SELECT * FROM PRECIO_USD_EVIDENCIA')).length, 0);
      const repeated = {
        insertados: [], conservados: rows.map(row => ({ sku: row.sku, codigoExistente: row.sku }))
      };
      assert.deepEqual(load(), repeated);
      assert.deepEqual(await products(), first);
      assert.deepEqual(await events(), firstEvents);

      await stopApi();
      await connection.end();
      connection = undefined;
      docker(['restart', run]);
      env.DB_PORT = String(await connect());
      await startApi();
      assert.deepEqual(load(), repeated);
      assert.deepEqual(await products(), first);
      assert.deepEqual(await events(), firstEvents);
      t.diagnostic('Altas por ejecución: 100, 0 y 0; mismos productos y eventos después del reinicio.');

      // Simular un catálogo parcial histórico y un SKU equivalente que ya tiene datos comerciales.
      await connection.query("UPDATE PRODUCTO SET codigo = 'CONTROL-ANTES-IMPORTADO' WHERE codigo = ?", [rows[1].sku]);
      const alias = rows[0].sku.toLowerCase();
      await connection.query(`
        UPDATE PRODUCTO SET codigo = ?, precio = 10.25, stock = 123, imagen = 'https://example.test/propia.jpg',
          descuento_especial_pct = 2, activo = 1, nombre = 'Ficha comercial' WHERE codigo = ?`, [alias, rows[0].sku]);
      const beforePartial = await products();
      const beforePartialEvents = await events();
      const recovery = load();
      assert.deepEqual(recovery.insertados, [rows[1].sku]);
      assert.equal(recovery.conservados.length, 99);
      assert.deepEqual(recovery.conservados[0], { sku: rows[0].sku, codigoExistente: alias });
      assert.deepEqual((await products()).slice(0, -1), beforePartial);
      assert.deepEqual((await events()).slice(0, -1), beforePartialEvents);
      assert.equal((await connection.query('SELECT * FROM PRECIO_USD_EVIDENCIA')).length, 0);
      t.diagnostic('Fallo en la fila 50: reversión total. Lote parcial: un alta y 99 SKU conservados.');
    } finally {
      try {
        try { await stopApi(); } finally { if (connection) await connection.end(); }
      } finally {
        try {
          if (inventory('container', '-a')) docker(['rm', '-f', '-v', run]);
        } finally {
          if (volumeCreated) docker(['volume', 'rm', volume]);
        }
        assert.equal(inventory('container', '-a'), '');
        assert.equal(inventory('volume'), '');
        t.diagnostic(`Aislamiento ${run}: cero contenedores y volúmenes residuales.`);
      }
    }
  });
});
