const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFile, execFileSync, spawn, spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const { createServer } = require('node:net');
const { resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const mariadb = require('mariadb');
const { parseMasterCatalog, masterCsv, masterCatalogLockName } =
  require('../dist/scripts/import-master-catalog.js');
const { withTestSignals } = require('./helpers/disposable-test-process.cjs');

const docker = (args, input) =>
  execFileSync('docker', args, { input, encoding: 'utf8', timeout: 60000, stdio: 'pipe' }).trim();
const backend = resolve(__dirname, '..');
const rows = parseMasterCatalog(readFileSync(masterCsv, 'utf8'));
const names = [...new Set(rows.map(row => row.category))];

// The MariaDB 11.4 client enables TLS by default, even for a unix socket. A
// clock-skewed ephemeral certificate would fail the bootstrap with error 2026.
// Resolve the socket the image configures and use it explicitly, without TLS,
// only for this internal bootstrap connection.
const sqlSocket = container => {
  const socket = docker(['exec', container, 'sh', '-c',
    "mariadb --print-defaults | tr ' ' '\\n' | sed -n 's/^--socket=//p' | head -n1"]);
  assert.match(socket, /^\//, 'El cliente de bootstrap debe resolver un socket local');
  docker(['exec', container, 'test', '-S', socket]);
  return socket;
};
const applySql = (container, socket, file, database) => {
  if (database !== undefined) assert.match(database, /^[a-z0-9_]+$/, 'Nombre de base descartable inválido');
  return docker(['exec', '-i', '-e', `MARIADB_LOCAL_SOCKET=${socket}`,
    container, 'sh', '-c',
    'exec mariadb --protocol=socket --socket="$MARIADB_LOCAL_SOCKET" --skip-ssl -uroot -p"$MARIADB_ROOT_PASSWORD" '
      + (database === undefined ? '"$MARIADB_DATABASE"' : `--database=${database}`)],
  readFileSync(resolve(backend, '../database', file)));
};

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
      let startup = '';
      let startupError = '';
      api.stderr.on('data', chunk => { startupError += chunk; });
      api.on('error', error => { startupError += `spawn: ${error.code ?? ''} ${error.message}`; });
      apiClosed = once(api, 'close');
      await Promise.race([
        new Promise(done => {
          api.stdout.on('data', chunk => {
            startup += chunk;
            if (startup.includes(`API disponible en puerto ${env.PORT}`)) done();
          });
        }),
        apiClosed.then(([code]) => {
          throw Error(`La API terminó antes de escuchar: ${code}. ${startupError.trim()}`);
        }, error => {
          throw Error(`La API no pudo iniciarse: ${error.message}`);
        }),
        delay(60000, undefined, { signal, ref: false }).then(() => {
          throw Error(`La API no inició. ${startup.trim()} ${startupError.trim()}`);
        })
      ]);
    };
    const stopApi = async () => {
      if (!api) return;
      api.kill();
      try { await apiClosed; } finally { api = undefined; }
    };
    let env;
    const target = () => `127.0.0.1:${env.DB_PORT}/${database}`;
    const args = destination => [
      '--require', './test/helpers/test-env.cjs', 'dist/scripts/import-master-catalog.js',
      '--confirmar-destino', destination
    ];
    const invoke = (destination = target()) => {
      checkAbort();
      const result = spawnSync(process.execPath, args(destination),
        { cwd: backend, env, encoding: 'utf8', timeout: 60000 });
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
      const socket = sqlSocket(run);
      const apply = file => applySql(run, socket, file);
      for (const file of ['schema.sql', 'migrate-fer-20-account-movements.sql',
        'migrate-fer-17-pricing-evidence.sql']) apply(file);
      env = {
        ...process.env, DOTENV_CONFIG_PATH: resolve(__dirname, 'helpers/nonexistent.env'),
        DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_NAME: database,
        DB_USER: 'root', DB_PASSWORD: password, JWT_SECRET: randomUUID(), PORT: await backendPort(),
        PRODUCT_IMAGE_STORAGE_DIR: '', RECEIPT_STORAGE_DIR: '', IMPORT_STORAGE_DIR: ''
      };
      await startApi();
      assert.match(invoke('destino-incorrecto').stderr, /destino confirmado/);
      for (const name of names) {
        await connection.query('INSERT INTO CATEGORIA (nombre, activo) VALUES (?, 1)', [name]);
      }
      const assertRejectedAudit = async () => {
        const result = invoke();
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Aplicá las migraciones FER-17/);
        assert.deepEqual(await products(), []);
      };
      await assertRejectedAudit();
      await connection.query(`
        CREATE TRIGGER fer17_producto_alta_evento AFTER INSERT ON PRODUCTO
        FOR EACH ROW SET @catalog_test_no_audit = 1`);
      await assertRejectedAudit();
      apply('migrate-fer-17-price-verification.sql');
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

      const lockName = masterCatalogLockName(database);
      const assertLockReleased = async label => {
        const [owner] = await connection.query('SELECT IS_USED_LOCK(?) AS owner', [lockName]);
        assert.equal(owner.owner, null, `${label}: el bloqueo cooperativo no debe persistir`);
      };
      await assertLockReleased('fallo a mitad de lote');

      // El importador serializa con GET_LOCK antes de escribir. Frenamos al
      // primero dentro de la transacción y comprobamos que el segundo espera el
      // bloqueo cooperativo en lugar de competir por el índice único.
      const gate = 'catalog_master_test_start';
      await connection.query(`
        CREATE TRIGGER catalog_test_gate BEFORE INSERT ON PRODUCTO FOR EACH ROW
        BEGIN
          IF NEW.codigo = '${rows[0].sku}' THEN
            IF GET_LOCK('${gate}', 10) <> 1 THEN
              SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No se abrió la barrera de prueba';
            END IF;
            DO RELEASE_LOCK('${gate}');
          END IF;
        END`);
      const [locked] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [gate]);
      assert.equal(Number(locked.acquired), 1);
      const importAsync = () => promisify(execFile)(process.execPath, args(target()), {
        cwd: backend, env, encoding: 'utf8', timeout: 60000, signal
      }).then(result => JSON.parse(result.stdout));
      const firstImport = importAsync();
      let secondImport;
      let barrierError;
      try {
        const startDeadline = performance.now() + 8000;
        while (true) {
          checkAbort();
          const processes = await connection.query('SHOW FULL PROCESSLIST');
          const inserting = processes.some(p => p.db === database && Number(p.Id) !== connection.threadId &&
            /INSERT INTO PRODUCTO|GET_LOCK\('catalog_master_test_start'/.test(p.Info ?? ''));
          if (inserting) break;
          assert.ok(performance.now() < startDeadline, 'El primer importador debe alcanzar el primer INSERT');
          await delay(25, undefined, { signal });
        }
        // El INSERT frenado tiene max_statement_time=5: liberar la barrera en
        // menos de 4 segundos desde que lo observamos bloqueado.
        const releaseDeadline = performance.now() + 4000;
        secondImport = importAsync();
        while (true) {
          checkAbort();
          const processes = await connection.query('SHOW FULL PROCESSLIST');
          const waiting = processes.some(p => p.db === database && Number(p.Id) !== connection.threadId &&
            (p.Info ?? '').includes(`GET_LOCK('${lockName}'`));
          if (waiting) break;
          assert.ok(performance.now() < releaseDeadline, 'El segundo importador debe esperar el bloqueo cooperativo');
          await delay(25, undefined, { signal });
        }
      } catch (error) {
        barrierError = error;
      } finally {
        await connection.query('SELECT RELEASE_LOCK(?)', [gate]);
      }
      const outcomes = await Promise.allSettled([firstImport, secondImport]);
      if (barrierError) throw barrierError;
      const concurrent = outcomes.map(outcome => {
        if (outcome.status === 'rejected') throw outcome.reason;
        return outcome.value;
      }).sort((a, b) => b.insertados.length - a.insertados.length);
      await connection.query('DROP TRIGGER catalog_test_gate');
      assert.deepEqual(concurrent[0], { insertados: rows.map(row => row.sku), conservados: [] });
      assert.deepEqual(concurrent[1], {
        insertados: [], conservados: rows.map(row => ({ sku: row.sku, codigoExistente: row.sku }))
      });
      await assertLockReleased('importación concurrente');
      t.diagnostic('Concurrencia serializada: un proceso insertó 100 SKU y el otro conservó los 100 tras esperar GET_LOCK.');
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
        assert.equal(product.precio, row.referencePrice);
        for (const field of ['descuento_especial_pct', 'imagen']) assert.equal(product[field], null);
        const event = firstEvents[index + 1];
        assert.equal(event.id_producto, product.id_producto);
        assert.equal(event.tipo, 'ALTA');
        assert.equal(event.precio_nuevo, row.referencePrice);
        assert.equal(event.evidencia, null);
        assert.equal(event.id_admin, null);
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

test('valida el trigger FER-17 y bloquea DDL concurrente antes de las altas', async t => {
  await withTestSignals(async signal => {
    const run = `master-catalog-lock-${randomUUID()}`;
    const volume = `${run}-data`;
    const label = `ferrepatagonia.master-catalog=${run}`;
    const database = 'master_catalog_lock_test';
    const password = randomUUID();
    const limitedPassword = randomUUID();
    const limitedUser = 'catalogo_limitado_312';
    let admin;
    let gate;
    let ddl;
    let port;
    let volumeCreated = false;
    const inventory = (type, ...args) => docker([type, 'ls', ...args, '-q', '--filter', `label=${label}`]);
    const checkAbort = () => signal.throwIfAborted();
    const waitFor = async (predicate, message, timeoutMs = 60000) => {
      const deadline = performance.now() + timeoutMs;
      while (true) {
        checkAbort();
        if (await predicate()) return;
        assert.ok(performance.now() < deadline, message);
        await delay(25, undefined, { signal });
      }
    };
    const open = async () => {
      for (let attempt = 0; attempt < 45; attempt++) {
        checkAbort();
        try {
          return await mariadb.createConnection({
            host: '127.0.0.1', port, user: 'root', password, database, connectTimeout: 1000
          });
        } catch (error) {
          if (attempt === 44) throw error;
          await delay(1000, undefined, { signal });
        }
      }
    };
    const migration = readFileSync(
      resolve(backend, '../database/migrate-fer-17-price-verification.sql'), 'utf8');
    const canonicalBody = migration.match(
      /CREATE OR REPLACE TRIGGER fer17_producto_alta_evento\s+AFTER INSERT ON PRODUCTO\s+FOR EACH ROW\s+([\s\S]+?)\/\//
    )?.[1];
    const lowercaseKeywords = sql => sql.replace(
      /\b(BEGIN|DECLARE|DEFAULT|SET|SELECT|FROM|WHERE|AND|LIMIT|INSERT|INTO|VALUES|END|NULL|NEW|OLD)\b/g,
      keyword => keyword.toLowerCase());
    const spaced = sql => sql.replace(/,\s*/g, ' ,   ').replace(/=/g, '  =  ');
    let env;
    const importerArgs = () => ['--require', './test/helpers/test-env.cjs',
      'dist/scripts/import-master-catalog.js', '--confirmar-destino', `127.0.0.1:${port}/${database}`];
    const invoke = ({ user = 'root', pass = password } = {}) => {
      checkAbort();
      const result = spawnSync(process.execPath, importerArgs(),
        { cwd: backend, env: { ...env, DB_USER: user, DB_PASSWORD: pass }, encoding: 'utf8', timeout: 60000 });
      if (result.error) throw result.error;
      return result;
    };
    const load = async options => {
      const result = invoke(options);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const importAsync = () => promisify(execFile)(process.execPath, importerArgs(), {
      cwd: backend, env, encoding: 'utf8', timeout: 60000, signal
    }).then(result => JSON.parse(result.stdout));
    const setTrigger = async (body, definer = false) => {
      await admin.query('DROP TRIGGER IF EXISTS fer17_producto_alta_evento');
      await admin.query(`CREATE ${definer ? 'DEFINER=CURRENT_USER ' : ''}TRIGGER fer17_producto_alta_evento
        AFTER INSERT ON PRODUCTO FOR EACH ROW ${body}`);
    };
    try {
      assert.ok(canonicalBody, 'La migración FER-17 debe definir el trigger de alta');
      docker(['volume', 'create', '--label', label, volume]);
      volumeCreated = true;
      docker(['run', '-d', '--name', run, '--label', label, '-p', '127.0.0.1::3306',
        '-v', `${volume}:/var/lib/mysql`, '-e', `MARIADB_ROOT_PASSWORD=${password}`,
        '-e', `MARIADB_DATABASE=${database}`, 'mariadb:11.4']);
      const binding = docker(['port', run, '3306/tcp']);
      assert.match(binding, /^127\.0\.0\.1:\d+$/);
      port = Number(binding.split(':').at(-1));
      admin = await open();
      const socket = sqlSocket(run);
      for (const file of ['schema.sql', 'migrate-fer-20-account-movements.sql',
        'migrate-fer-17-pricing-evidence.sql', 'migrate-fer-17-price-verification.sql']) {
        applySql(run, socket, file);
      }
      for (const name of names) {
        await admin.query('INSERT INTO CATEGORIA (nombre, activo) VALUES (?, 1)', [name]);
      }
      env = {
        ...process.env, DOTENV_CONFIG_PATH: resolve(__dirname, 'helpers/nonexistent.env'),
        DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_NAME: database,
        DB_USER: 'root', DB_PASSWORD: password, JWT_SECRET: randomUUID(), PORT: '3999',
        PRODUCT_IMAGE_STORAGE_DIR: '', RECEIPT_STORAGE_DIR: '', IMPORT_STORAGE_DIR: ''
      };

      // F-03: el importador queda frenado en la lectura de CATEGORIA, después de
      // validar el trigger y ya con el lock de PRODUCTO. Un DROP TRIGGER encolado
      // desde otra sesión no puede completarse hasta que la transacción termine.
      gate = await mariadb.createConnection({
        host: '127.0.0.1', port, user: 'root', password, database, connectTimeout: 1000
      });
      await gate.query('LOCK TABLES CATEGORIA WRITE');
      const pendingImport = importAsync();
      await waitFor(async () => (await admin.query('SHOW FULL PROCESSLIST')).some(session =>
        session.db === database && /FROM CATEGORIA/.test(session.Info ?? '')),
      'El importador no alcanzó la barrera controlada de CATEGORIA');
      const [visible] = await admin.query('SELECT COUNT(*) AS total FROM PRODUCTO');
      assert.equal(Number(visible.total), 0,
        'Una lectura normal no debe quedar bloqueada por el lock del importador');
      ddl = await mariadb.createConnection({
        host: '127.0.0.1', port, user: 'root', password, database, connectTimeout: 1000
      });
      let ddlSettled = false;
      const ddlQuery = ddl.query('DROP TRIGGER fer17_producto_alta_evento')
        .finally(() => { ddlSettled = true; });
      ddlQuery.catch(() => {});
      await waitFor(async () => (await admin.query('SHOW FULL PROCESSLIST')).some(session =>
        /^DROP TRIGGER fer17_producto_alta_evento/.test(session.Info ?? '') &&
        /metadata lock/i.test(session.State ?? '')),
      'El DROP TRIGGER no quedó esperando el metadata lock de la transacción');
      assert.equal(ddlSettled, false, 'El DDL no debe completarse mientras el importador retiene el lock');
      t.diagnostic('DDL concurrente bloqueado: el importador conserva el metadata lock.');

      await gate.query('UNLOCK TABLES');
      const imported = await pendingImport;
      await Promise.race([
        ddlQuery,
        delay(60000, undefined, { signal, ref: false }).then(() => {
          throw Error('El DDL concurrente no se completó al liberar la transacción');
        })
      ]);
      assert.equal(ddlSettled, true);
      assert.equal(imported.insertados.length, 100);
      assert.deepEqual(imported.conservados, []);
      const products = await admin.query('SELECT * FROM PRODUCTO ORDER BY id_producto');
      const events = await admin.query('SELECT * FROM FER17_PRECIO_EVENTO ORDER BY id_evento');
      assert.equal(products.length, 100);
      assert.equal(events.length, 100);
      assert.deepEqual(events.map(event => event.tipo), Array(100).fill('ALTA'));
      assert.equal((await admin.query(`SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = 'fer17_producto_alta_evento'`)).length, 0);
      t.diagnostic('El DDL se completó recién al liberarse la transacción: 100 altas y 100 eventos ALTA.');

      // F-05: solo se aceptan definiciones equivalentes. Cambiar mayúsculas de
      // palabras clave o el espaciado no altera el resultado; literales o filas
      // distintas sí deben rechazarse.
      const accepted = async label => {
        const result = await load();
        assert.deepEqual(result.insertados, [], `${label}: no debe insertar`);
        assert.equal(result.conservados.length, 100, `${label}: debe conservar los 100 SKU`);
        t.diagnostic(`Trigger aceptado: ${label}.`);
      };
      const rejected = async (label, options, pattern = /Aplicá las migraciones FER-17/) => {
        const result = invoke(options);
        assert.equal(result.status, 1, `${label}: debe rechazarse`);
        assert.match(result.stderr, pattern, `${label}: mensaje de auditoría`);
        t.diagnostic(`Trigger rechazado: ${label}.`);
      };
      await setTrigger(canonicalBody);
      await accepted('definición canónica');
      await setTrigger(lowercaseKeywords(canonicalBody));
      await accepted('palabras clave con otra capitalización');
      await setTrigger(spaced(canonicalBody));
      await accepted('espaciado equivalente');
      await setTrigger(canonicalBody, true);
      await accepted('DEFINER válido');
      await setTrigger(canonicalBody.replace("'ALTA'", "'BAJA'"));
      await rejected('alteración semántica');
      await admin.query('DROP TRIGGER fer17_producto_alta_evento');
      await rejected('trigger ausente');
      await setTrigger(canonicalBody);
      await admin.query(`CREATE USER '${limitedUser}'@'%' IDENTIFIED BY '${limitedPassword}'`);
      await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO '${limitedUser}'@'%'`);
      await rejected('permisos insuficientes', { user: limitedUser, pass: limitedPassword });
      assert.equal((await admin.query('SELECT id_producto FROM PRODUCTO')).length, 100);
      assert.equal((await admin.query('SELECT id_evento FROM FER17_PRECIO_EVENTO')).length, 100);

      // A-03: cada tabla y cada trigger obligatorio de FER-17 es imprescindible.
      // Se retira uno por vez y se comprueba que el importador rechaza sin escribir.
      const productsUnchanged = async label => {
        const [row] = await admin.query('SELECT COUNT(*) AS total FROM PRODUCTO');
        assert.equal(Number(row.total), 100, `${label}: PRODUCTO no debe cambiar`);
      };
      const eventsUnchanged = async label => {
        const [row] = await admin.query('SELECT COUNT(*) AS total FROM FER17_PRECIO_EVENTO');
        assert.equal(Number(row.total), 100, `${label}: FER17_PRECIO_EVENTO no debe cambiar`);
      };
      const restoreFer17 = () => {
        applySql(run, socket, 'migrate-fer-17-pricing-evidence.sql');
        applySql(run, socket, 'migrate-fer-17-price-verification.sql');
      };
      for (const trigger of ['fer17_producto_precio_evento', 'fer17_precio_evento_no_update',
        'fer17_precio_evento_no_delete']) {
        await admin.query(`DROP TRIGGER ${trigger}`);
        await rejected(`trigger ausente ${trigger}`);
        await productsUnchanged(trigger);
        await eventsUnchanged(trigger);
        restoreFer17();
      }
      for (const table of ['FER17_PRECIO_EVENTO', 'PRECIO_USD_EVIDENCIA']) {
        await admin.query(`DROP TABLE ${table}`);
        // Sin PRECIO_USD_EVIDENCIA la guarda DEMO rechaza primero por no poder
        // verificar la ausencia de datos DEMO; ambas rutas abortan sin escribir.
        await rejected(`tabla ausente ${table}`, undefined,
          table === 'PRECIO_USD_EVIDENCIA'
            ? /faltan tablas obligatorias \(PRECIO_USD_EVIDENCIA\)/
            : /Aplicá las migraciones FER-17/);
        await productsUnchanged(table);
        restoreFer17();
      }
      await admin.query('DROP TRIGGER fer17_precio_evento_no_delete');
      await admin.query(`CREATE TRIGGER fer17_precio_evento_no_delete
        BEFORE DELETE ON FER17_PRECIO_EVENTO FOR EACH ROW SET @fer17_alterado = 1`);
      await rejected('definición alterada fer17_precio_evento_no_delete');
      await productsUnchanged('definición alterada');
      restoreFer17();
      await admin.query('DROP TRIGGER fer17_producto_alta_evento');
      await admin.query(`CREATE TRIGGER fer17_producto_alta_evento
        AFTER INSERT ON PRODUCTO FOR EACH ROW SET @fer17_alterado = 1`);
      await rejected('definición alterada fer17_producto_alta_evento');
      await productsUnchanged('definición alterada');
      restoreFer17();
      await admin.query('DROP TABLE FER17_PRECIO_EVENTO');
      await admin.query(`CREATE TABLE FER17_PRECIO_EVENTO (
        id_evento BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        id_producto INT NOT NULL)`);
      await rejected('tabla FER17_PRECIO_EVENTO incompleta', undefined, /Auditoría FER-17 incoherente/);
      await productsUnchanged('tabla incompleta');
      await admin.query('DROP TABLE FER17_PRECIO_EVENTO');
      restoreFer17();
      const [lockOwner] = await admin.query('SELECT IS_USED_LOCK(?) AS owner',
        [masterCatalogLockName(database)]);
      assert.equal(lockOwner.owner, null, 'Los rechazos de FER-17 no deben dejar bloqueos');
      t.diagnostic('FER-17 completo: al faltar cada tabla o trigger individual el importador rechaza sin escribir.');
    } finally {
      try { gate?.destroy(); } catch { /* el cierre libera el LOCK TABLES */ }
      try { ddl?.destroy(); } catch { /* DDL pendiente descartado */ }
      try { if (admin) await admin.end(); } catch { /* conexión ya cerrada */ }
      try {
        if (inventory('container', '-a')) docker(['rm', '-f', '-v', run]);
      } finally {
        if (volumeCreated) docker(['volume', 'rm', volume]);
      }
      assert.equal(inventory('container', '-a'), '');
      assert.equal(inventory('volume'), '');
      t.diagnostic(`Aislamiento ${run}: cero contenedores y volúmenes residuales.`);
    }
  });
});

test('rechaza bases DEMO vacías, parciales y completas antes de escribir', async t => {
  await withTestSignals(async signal => {
    const run = `master-catalog-demo-${randomUUID()}`;
    const volume = `${run}-data`;
    const label = `ferrepatagonia.master-catalog=${run}`;
    const password = randomUUID();
    const demoPassword = randomUUID();
    let admin;
    let port;
    let volumeCreated = false;
    const inventory = (type, ...args) => docker([type, 'ls', ...args, '-q', '--filter', `label=${label}`]);
    const checkAbort = () => signal.throwIfAborted();
    const open = async () => {
      for (let attempt = 0; attempt < 45; attempt++) {
        checkAbort();
        try {
          return await mariadb.createConnection({
            host: '127.0.0.1', port, user: 'root', password,
            database: 'master_catalog_guard_bootstrap', connectTimeout: 1000
          });
        } catch (error) {
          if (attempt === 44) throw error;
          await delay(1000, undefined, { signal });
        }
      }
    };
    let env;
    const invoke = (database, overrides = {}, extraArgs = []) => {
      checkAbort();
      const result = spawnSync(process.execPath, ['--require', './test/helpers/test-env.cjs',
        'dist/scripts/import-master-catalog.js', '--confirmar-destino', `127.0.0.1:${port}/${database}`, ...extraArgs],
      { cwd: backend, env: { ...env, DB_NAME: database, ...overrides }, encoding: 'utf8', timeout: 60000 });
      if (result.error) throw result.error;
      return result;
    };
    const snapshot = async database => {
      const tables = await admin.query(`SELECT TABLE_NAME AS name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`, [database]);
      const counts = {};
      for (const { name } of tables) {
        const [row] = await admin.query(`SELECT COUNT(*) AS total FROM \`${database}\`.\`${name}\``);
        counts[name] = Number(row.total);
      }
      return counts;
    };
    const assertRejected = async (database, pattern, overrides = {}) => {
      const before = await snapshot(database);
      const result = invoke(database, overrides);
      assert.equal(result.status, 1, `${database}: debe rechazarse antes de escribir`);
      assert.match(result.stderr, pattern, `${database}: motivo de la guarda`);
      assert.doesNotMatch(result.stderr, /No se completó la carga/,
        `${database}: debe informar la guarda, no un error genérico`);
      assert.deepEqual(await snapshot(database), before, `${database}: no debe mutar registros`);
      t.diagnostic(`Rechazo sin mutaciones: ${database}.`);
    };
    try {
      docker(['volume', 'create', '--label', label, volume]);
      volumeCreated = true;
      docker(['run', '-d', '--name', run, '--label', label, '-p', '127.0.0.1::3306',
        '-v', `${volume}:/var/lib/mysql`, '-e', `MARIADB_ROOT_PASSWORD=${password}`,
        '-e', 'MARIADB_DATABASE=master_catalog_guard_bootstrap', 'mariadb:11.4']);
      const binding = docker(['port', run, '3306/tcp']);
      assert.match(binding, /^127\.0\.0\.1:\d+$/);
      port = Number(binding.split(':').at(-1));
      admin = await open();
      const socket = sqlSocket(run);
      env = {
        ...process.env, DOTENV_CONFIG_PATH: resolve(__dirname, 'helpers/nonexistent.env'),
        DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_NAME: '', DB_USER: 'root', DB_PASSWORD: password,
        JWT_SECRET: randomUUID(), PORT: '3999',
        PRODUCT_IMAGE_STORAGE_DIR: '', RECEIPT_STORAGE_DIR: '', IMPORT_STORAGE_DIR: ''
      };
      const create = name => admin.query(
        `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      const full = async name => {
        await create(name);
        for (const file of ['schema.sql', 'migrate-fer-20-account-movements.sql',
          'migrate-fer-17-pricing-evidence.sql', 'migrate-fer-17-price-verification.sql']) {
          applySql(run, socket, file, name);
        }
      };
      const categories = async name => {
        for (const category of names) {
          await admin.query(`INSERT INTO \`${name}\`.CATEGORIA (nombre, activo) VALUES (?, 1)`, [category]);
        }
      };
      const client = async name => (await admin.query(`INSERT INTO \`${name}\`.CLIENTE
        (tipo_cliente, nombre_razon_social, es_fiel, activo)
        VALUES ('PARTICULAR', 'Cliente de guarda', 0, 1)`)).insertId;

      // Bases vacías: nombre reservado, inventario incompleto y combinación completa.
      await create('ferre_demo_vacia');
      await create('e2e_test_parcial');
      await create('master_catalog_vacia_312');
      await create('master_catalog_parcial_312');
      applySql(run, socket, 'schema.sql', 'master_catalog_parcial_312');

      await full('ferre_demo_completa');
      await admin.query(`INSERT INTO \`ferre_demo_completa\`.CUENTA_CORRIENTE
        (id_cliente, limite_credito, habilitada, origen_datos) VALUES (?, 0, 0, 'DEMO')`,
      [await client('ferre_demo_completa')]);
      await admin.query('CREATE TABLE `ferre_demo_completa`.DEMO286_IDENTIDAD (id INT NOT NULL PRIMARY KEY)');

      await full('master_catalog_identidad_demo');
      await admin.query('CREATE TABLE `master_catalog_identidad_demo`.DEMO286_IDENTIDAD (id INT NOT NULL PRIMARY KEY)');

      await assertRejected('ferre_demo_vacia', /nombre reservado para DEMO/);
      await assertRejected('e2e_test_parcial', /nombre reservado para DEMO/);
      await assertRejected('master_catalog_vacia_312', /faltan tablas obligatorias/);
      await assertRejected('master_catalog_parcial_312', /Auditoría FER-17 incompleta/);
      await assertRejected('ferre_demo_completa', /nombre reservado para DEMO/);
      await assertRejected('master_catalog_identidad_demo', /existe la tabla DEMO286_IDENTIDAD/);

      // Evidencia DEMO individual en cada tabla auditada.
      const accountDb = 'master_catalog_demo_cuenta';
      await full(accountDb);
      await admin.query(`INSERT INTO \`${accountDb}\`.CUENTA_CORRIENTE
        (id_cliente, limite_credito, habilitada, origen_datos) VALUES (?, 0, 0, 'DEMO')`,
      [await client(accountDb)]);
      await assertRejected(accountDb, /origen_datos = DEMO/);

      const priceDb = 'master_catalog_demo_precio';
      await full(priceDb);
      const priceAdmin = (await admin.query(`INSERT INTO \`${priceDb}\`.USUARIO
        (email, password_hash, rol, activo) VALUES ('demo.precio@example.test', 'x', 'ADMIN', 1)`)).insertId;
      const priceCategory = (await admin.query(`INSERT INTO \`${priceDb}\`.CATEGORIA
        (nombre, activo) VALUES ('Guarda', 1)`)).insertId;
      const priceProduct = (await admin.query(`INSERT INTO \`${priceDb}\`.PRODUCTO
        (id_categoria, codigo, nombre, stock, activo) VALUES (?, 'FP-GUARD-PRECIO', 'Guarda', 1, 0)`,
      [priceCategory])).insertId;
      await admin.query(`INSERT INTO \`${priceDb}\`.PRECIO_USD_EVIDENCIA
        (id_producto, precio_verificado, evidencia, id_admin, verificado_utc, sintetica)
        VALUES (?, 1, 'evidencia sintetica', ?, UTC_TIMESTAMP(3), 1)`, [priceProduct, priceAdmin]);
      await assertRejected(priceDb, /evidencias de precio sintéticas/);

      const orderDb = 'master_catalog_demo_pedido';
      await full(orderDb);
      await admin.query(`INSERT INTO \`${orderDb}\`.PEDIDO
        (id_cliente, estado, modalidad_pago, subtotal, descuento, total)
        VALUES (?, 'DEMO_PRUEBA', 'EFECTIVO', 0, 0, 0)`, [await client(orderDb)]);
      await assertRejected(orderDb, /estado o modalidad de pago DEMO_/);

      const modalityDb = 'master_catalog_demo_modalidad';
      await full(modalityDb);
      await admin.query(`INSERT INTO \`${modalityDb}\`.PEDIDO
        (id_cliente, estado, modalidad_pago, subtotal, descuento, total)
        VALUES (?, 'REGISTRADO', 'DEMO_DIRECTO', 0, 0, 0)`, [await client(modalityDb)]);
      await assertRejected(modalityDb, /estado o modalidad de pago DEMO_/);

      const skuDb = 'master_catalog_demo_sku';
      await full(skuDb);
      const skuCategory = (await admin.query(`INSERT INTO \`${skuDb}\`.CATEGORIA
        (nombre, activo) VALUES ('Guarda', 1)`)).insertId;
      for (let index = 0; index < 101; index++) {
        await admin.query(`INSERT INTO \`${skuDb}\`.PRODUCTO
          (id_categoria, codigo, nombre, stock, activo) VALUES (?, ?, ?, 1, 0)`,
        [skuCategory, `FP-DEMO-GUARD-${index}`, `Guarda ${index}`]);
      }
      await assertRejected(skuDb, /más de 100 SKU/);

      // Usuario de conexión demo286, incluso sobre una base sana.
      const userDb = 'master_catalog_demo_usuario';
      await full(userDb);
      await admin.query(`CREATE USER 'demo286'@'%' IDENTIFIED BY '${demoPassword}'`);
      await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${userDb}\`.* TO 'demo286'@'%'`);
      await assertRejected(userDb, /usuario "demo286"/, { DB_USER: 'demo286', DB_PASSWORD: demoPassword });

      // Control positivo: una base sana se importa y sigue siendo idempotente.
      const cleanDb = 'master_catalog_limpia_312';
      await full(cleanDb);
      await categories(cleanDb);
      const first = invoke(cleanDb);
      assert.equal(first.status, 0, first.stderr);
      assert.equal(JSON.parse(first.stdout).insertados.length, 100);
      const second = invoke(cleanDb);
      assert.equal(second.status, 0, second.stderr);
      assert.deepEqual(JSON.parse(second.stdout), {
        insertados: [], conservados: rows.map(row => ({ sku: row.sku, codigoExistente: row.sku }))
      });
      const [cleanProducts] = await admin.query(`SELECT COUNT(*) AS total FROM \`${cleanDb}\`.PRODUCTO`);
      const [cleanEvents] = await admin.query(`SELECT COUNT(*) AS total FROM \`${cleanDb}\`.FER17_PRECIO_EVENTO`);
      assert.equal(Number(cleanProducts.total), 100);
      assert.equal(Number(cleanEvents.total), 100);
      const [cleanLock] = await admin.query('SELECT IS_USED_LOCK(?) AS owner',
        [masterCatalogLockName(cleanDb)]);
      assert.equal(cleanLock.owner, null, 'La importación exitosa debe liberar el bloqueo');
      await admin.query(`INSERT INTO \`${cleanDb}\`.PRODUCTO
        (id_categoria, codigo, nombre, stock, activo)
        SELECT id_categoria, 'FP-DEMO-GUARD-EXTRA', 'Extra', 1, 0 FROM \`${cleanDb}\`.CATEGORIA LIMIT 1`);
      await assertRejected(cleanDb, /más de 100 SKU/);
      t.diagnostic('Control positivo: 100 altas, segunda ejecución idempotente y rechazo al superar 100 SKU DEMO.');

      const publishDb = 'master_catalog_publicar_313';
      await full(publishDb);
      await categories(publishDb);
      const publishAdminId = Number((await admin.query(`INSERT INTO \`${publishDb}\`.USUARIO
        (email, password_hash, rol, activo) VALUES ('pub313@example.test', 'x', 'ADMIN', 1)`)).insertId);
      const legacyRow = rows[0];
      const [legacyCategory] = await admin.query(
        `SELECT id_categoria FROM \`${publishDb}\`.CATEGORIA WHERE nombre = ?`, [legacyRow.category]);
      await admin.query(`INSERT INTO \`${publishDb}\`.PRODUCTO
        (codigo, nombre, descripcion, stock, id_categoria, precio, descuento_especial_pct, imagen, activo)
        VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 0)`,
      [legacyRow.sku, legacyRow.name, legacyRow.legacyDescription, legacyRow.stock, legacyCategory.id_categoria]);
      assert.equal(invoke(publishDb).status, 0);
      const dbProducts = await admin.query(`SELECT id_producto, codigo FROM \`${publishDb}\`.PRODUCTO`);
      for (const item of dbProducts) {
        await admin.query(`UPDATE \`${publishDb}\`.PRODUCTO SET imagen = ? WHERE id_producto = ?`,
          [`/api/product-images/${randomUUID()}.webp`, item.id_producto]);
      }
      const publishedResult = invoke(publishDb, {}, ['--publicar', '--admin', String(publishAdminId)]);
      assert.equal(publishedResult.status, 0, publishedResult.stderr);
      assert.equal(JSON.parse(publishedResult.stdout).publicados, 100);
      const legacyEvents = await admin.query(`SELECT e.tipo, e.precio_anterior, e.precio_nuevo, e.id_admin
        FROM \`${publishDb}\`.FER17_PRECIO_EVENTO e
        JOIN \`${publishDb}\`.PRODUCTO p ON p.id_producto = e.id_producto
        WHERE p.codigo = ? AND e.tipo = 'CAMBIO_PRECIO' ORDER BY e.id_evento`, [legacyRow.sku]);
      assert.equal(legacyEvents.length, 1);
      assert.equal(legacyEvents[0].precio_anterior, null);
      assert.equal(legacyEvents[0].precio_nuevo, legacyRow.referencePrice);
      assert.equal(Number(legacyEvents[0].id_admin), publishAdminId);
      t.diagnostic('Publicación legacy con precio NULL registra id_admin en CAMBIO_PRECIO.');
    } finally {
      try { if (admin) await admin.end(); } catch { /* conexión ya cerrada */ }
      try {
        if (inventory('container', '-a')) docker(['rm', '-f', '-v', run]);
      } finally {
        if (volumeCreated) docker(['volume', 'rm', volume]);
      }
      assert.equal(inventory('container', '-a'), '');
      assert.equal(inventory('volume'), '');
      t.diagnostic(`Aislamiento ${run}: cero contenedores y volúmenes residuales.`);
    }
  });
});

test('rechaza servidores con hostname demo286- antes de escribir', async t => {
  await withTestSignals(async signal => {
    const run = `master-catalog-host-${randomUUID()}`;
    const volume = `${run}-data`;
    const label = `ferrepatagonia.master-catalog=${run}`;
    const database = 'master_catalog_host_312';
    const password = randomUUID();
    let admin;
    let port;
    let volumeCreated = false;
    const inventory = (type, ...args) => docker([type, 'ls', ...args, '-q', '--filter', `label=${label}`]);
    try {
      docker(['volume', 'create', '--label', label, volume]);
      volumeCreated = true;
      docker(['run', '-d', '--name', run, '--hostname', 'demo286-auditoria', '--label', label,
        '-p', '127.0.0.1::3306', '-v', `${volume}:/var/lib/mysql`,
        '-e', `MARIADB_ROOT_PASSWORD=${password}`, '-e', `MARIADB_DATABASE=${database}`, 'mariadb:11.4']);
      const binding = docker(['port', run, '3306/tcp']);
      assert.match(binding, /^127\.0\.0\.1:\d+$/);
      port = Number(binding.split(':').at(-1));
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        try {
          admin = await mariadb.createConnection({
            host: '127.0.0.1', port, user: 'root', password, database, connectTimeout: 1000
          });
          break;
        } catch (error) {
          if (attempt === 44) throw error;
          await delay(1000, undefined, { signal });
        }
      }
      const result = spawnSync(process.execPath, ['--require', './test/helpers/test-env.cjs',
        'dist/scripts/import-master-catalog.js', '--confirmar-destino', `127.0.0.1:${port}/${database}`],
      {
        cwd: backend, encoding: 'utf8', timeout: 60000,
        env: {
          ...process.env, DOTENV_CONFIG_PATH: resolve(__dirname, 'helpers/nonexistent.env'),
          DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_NAME: database, DB_USER: 'root',
          DB_PASSWORD: password, JWT_SECRET: randomUUID(), PORT: '3999',
          PRODUCT_IMAGE_STORAGE_DIR: '', RECEIPT_STORAGE_DIR: '', IMPORT_STORAGE_DIR: ''
        }
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 1);
      assert.match(result.stderr, /hostname de demostración/);
      assert.equal((await admin.query(`SELECT TABLE_NAME AS name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?`, [database])).length, 0, 'No debe crear ni modificar nada');
      t.diagnostic('Hostname demo286- rechazado antes de cualquier escritura.');
    } finally {
      try { if (admin) await admin.end(); } catch { /* conexión ya cerrada */ }
      try {
        if (inventory('container', '-a')) docker(['rm', '-f', '-v', run]);
      } finally {
        if (volumeCreated) docker(['volume', 'rm', volume]);
      }
      assert.equal(inventory('container', '-a'), '');
      assert.equal(inventory('volume'), '');
      t.diagnostic(`Aislamiento ${run}: cero contenedores y volúmenes residuales.`);
    }
  });
});
