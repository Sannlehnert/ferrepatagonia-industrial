// Runner aislado de T-S7-04.2 (#317 / HU-S7-04 #290): MariaDB 11.4 descartable (tmpfs, auto-remove).
// Valida instalacion completa, upgrade desde esquema previo a #290, doble aplicacion idempotente
// y suite completa de integracion HTTP + SQL + concurrencia TOCTOU + Socket.IO.
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const mariadb = require('mariadb');
const { readSchemaInventory } = require('../../scripts/lib/schema-inventory.cjs');
const { assertSchemaInventory } = require('./schema-inventory.cjs');

const backend = path.resolve(__dirname, '../..');
const token = randomUUID().replaceAll('-', '');
const database = `s704_test_${token}`;
const container = `s704-state-test-${token}`;
const password = randomUUID();
const labelKey = 'ferrepatagonia.s704-test';
const image = 'mariadb:11.4';

function resolveDocker() {
  for (const candidate of ['docker', 'docker.exe']) {
    try {
      execFileSync(candidate, ['version', '--format', '{{.Server.Version}}'], {
        encoding: 'utf8', stdio: 'pipe', timeout: 30000, windowsHide: true,
      });
      return candidate;
    } catch {
      // Probar el siguiente binario.
    }
  }
  throw new Error('No hay un motor Docker con daemon disponible para la suite T-S7-04.2.');
}

const dockerBin = resolveDocker();
const docker = (...args) => execFileSync(dockerBin, args, {
  encoding: 'utf8', stdio: 'pipe', timeout: 180000, windowsHide: true,
}).trim();

function applySql(file, { target = database, contents = fs.readFileSync(file) } = {}) {
  const result = spawnSync(dockerBin, [
    'exec', '-i', container, 'mariadb', '--protocol=socket', '--skip-ssl', '-uroot', `-p${password}`, target,
  ], {
    input: contents,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Falló ${path.basename(file)}: ${result.stderr || result.stdout}`);
  }
}

const sqlFile = name => path.join(backend, '../database', name);
const stateMigration = 'migrate-s7-04-2-state-consistency.sql';

async function snapshot(query, tables) {
  return Promise.all(tables.map(async table => ({
    table,
    rows: (await query(`SELECT * FROM ${table}`))
      .map(row => JSON.stringify(row, (_, value) => typeof value === 'bigint' ? value.toString() : value))
      .sort(),
  })));
}

async function checkLegacyUpgrade(port) {
  const target = `${database}_upgrade`;
  docker('exec', container, 'mariadb', '--protocol=socket', '--skip-ssl', '-uroot', `-p${password}`, '-e', `CREATE DATABASE ${target}`);
  for (const name of [
    'schema.sql',
    'migrate-fer-20-account-movements.sql',
    'migrate-fer-17-price-verification.sql',
    'migrate-s7-09-1-credit-workflow.sql',
    'migrate-s7-06-1-transfer-order-confirmation.sql',
    'seed.sql',
    'verify-seed.sql',
  ]) {
    applySql(sqlFile(name), { target });
  }

  const db = await mariadb.createConnection({
    host: '127.0.0.1', port, user: 'root', password, database: target, timezone: 'Z', dateStrings: true,
  });
  try {
    // Simular estado previo a #290 en COMPROBANTE_PAGO (sin columnas #290) y PAGO (sin columnas #290)
    await db.query(`
      ALTER TABLE COMPROBANTE_PAGO
        ADD KEY fk_comprobante_admin (id_admin_revision),
        DROP CONSTRAINT chk_comprobante_revision,
        DROP CONSTRAINT chk_comprobante_estado_revision,
        DROP CONSTRAINT chk_comprobante_clave_revision,
        DROP INDEX uq_comprobante_clave_revision,
        DROP COLUMN estado_revision,
        DROP COLUMN motivo_rechazo,
        DROP COLUMN clave_idempotencia_revision
    `);
    await db.query('ALTER TABLE COMPROBANTE_PAGO ADD CONSTRAINT chk_comprobante_revision CHECK ((id_admin_revision IS NULL) = (revision_utc IS NULL))');
    await db.query(`
      ALTER TABLE PAGO
        DROP FOREIGN KEY fk_pago_cotizacion,
        DROP FOREIGN KEY fk_pago_admin_actor,
        DROP FOREIGN KEY fk_pago_admin_cierre,
        DROP CONSTRAINT chk_pago_estado,
        DROP CONSTRAINT chk_pago_conversion,
        DROP CONSTRAINT chk_pago_claves,
        DROP CONSTRAINT chk_pago_cierre,
        DROP INDEX uq_pago_clave_idempotencia,
        DROP INDEX uq_pago_clave_acreditacion,
        DROP INDEX uq_pago_clave_cierre,
        DROP INDEX idx_pago_cotizacion,
        DROP INDEX idx_pago_admin_actor,
        DROP INDEX idx_pago_admin_cierre,
        DROP COLUMN monto_usd,
        DROP COLUMN id_cotizacion,
        DROP COLUMN tasa_historica,
        DROP COLUMN clave_idempotencia,
        DROP COLUMN clave_idempotencia_acreditacion,
        DROP COLUMN clave_idempotencia_cierre,
        DROP COLUMN motivo_cierre,
        DROP COLUMN id_admin_actor,
        DROP COLUMN id_admin_cierre,
        DROP COLUMN fecha_cierre_utc
    `);
    await db.query('DROP TABLE IF EXISTS PAGO_IDEMPOTENCIA');

    // Insertar comprobante ya revisado bajo esquema #275 para verificar backfill seguro a APROBADO
    const legacyId = randomUUID();
    await db.query(`
      INSERT INTO COMPROBANTE_PAGO (
        id_comprobante, id_cliente, id_usuario_carga, id_pedido, id_cuenta_corriente,
        tipo_mime, bytes, sha256, fecha_utc, id_admin_revision, revision_utc
      ) VALUES (?, 1, 1, 1, NULL, 'application/pdf', 128, UNHEX(REPEAT('ab', 32)), '2026-10-01 12:00:00.000', 4, '2026-10-01 13:00:00.000')
    `, [legacyId]);

    const query = sql => db.query(sql);
    for (let run = 0; run < 2; run++) {
      applySql(sqlFile(stateMigration), { target });
      const inv = await assertSchemaInventory(query, 'complete');
      assert.equal(inv.tables, 26);
      assert.equal(inv.triggers, 13);
      assert.equal(inv.views, 1);
    }

    const [migrated] = await db.query(
      'SELECT estado_revision, id_admin_revision, motivo_rechazo, clave_idempotencia_revision FROM COMPROBANTE_PAGO WHERE id_comprobante = ?',
      [legacyId],
    );
    assert.equal(migrated.estado_revision, 'APROBADO');
    assert.equal(Number(migrated.id_admin_revision), 4);
    assert.equal(migrated.motivo_rechazo, null);
    assert.equal(migrated.clave_idempotencia_revision, null);

    // Las filas del seed siguen intactas
    const [pagoCount] = await db.query('SELECT COUNT(*) AS n FROM PAGO');
    assert.equal(Number(pagoCount.n), 2);
    console.log('Upgrade aditivo #290 verificado: 26 tablas, 13 triggers (3 FER-20 + 4 FER-17 + 6 S7-04), backfill legado APROBADO y seed intacto.');
  } finally {
    await db.end();
  }
}

async function main() {
  let started = false;
  let connection;
  let storage;
  let interrupted = false;
  let child;
  const signal = () => { interrupted = true; child?.kill('SIGTERM'); };
  process.on('SIGINT', signal);
  process.on('SIGTERM', signal);

  try {
    storage = fs.mkdtempSync(path.join(os.tmpdir(), 'ferre-s704-receipts-'));
    docker('run', '--rm', '-d', '--name', container, '--label', `${labelKey}=${token}`,
      '--tmpfs', '/var/lib/mysql:rw', '-p', '127.0.0.1::3306',
      '-e', `MARIADB_ROOT_PASSWORD=${password}`, '-e', `MARIADB_DATABASE=${database}`, image);
    started = true;

    const info = JSON.parse(docker('inspect', container))[0];
    assert.equal(info.Config.Image, image);
    assert.equal(info.Config.Labels[labelKey], token);
    assert.equal(info.State.Running, true);
    assert.ok(info.HostConfig.Tmpfs?.['/var/lib/mysql']);
    const binding = info.NetworkSettings.Ports['3306/tcp'];
    assert.ok(Array.isArray(binding) && binding.length === 1 && binding[0].HostIp === '127.0.0.1');
    const port = Number(binding[0].HostPort);

    for (let attempt = 0; attempt < 60 && !interrupted; attempt++) {
      try {
        connection = await mariadb.createConnection({
          host: '127.0.0.1', port, user: 'root', password, database,
          connectTimeout: 1000, timezone: 'Z', dateStrings: true,
        });
        break;
      } catch (error) {
        if (attempt === 59) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    assert.ok(connection && !interrupted, 'MariaDB descartable no disponible');

    const [version] = await connection.query('SELECT VERSION() AS version');
    assert.match(version.version, /^11\.4\..*MariaDB/i);
    for (const name of [
      'schema.sql',
      'migrate-fer-20-account-movements.sql',
      'migrate-fer-17-price-verification.sql',
      'migrate-s7-09-1-credit-workflow.sql',
      'migrate-s7-06-1-transfer-order-confirmation.sql',
      stateMigration,
      stateMigration,
    ]) {
      applySql(sqlFile(name));
    }

    const query = sql => connection.query(sql);
    const inventory = await assertSchemaInventory(query, 'complete');
    await checkLegacyUpgrade(port);
    console.log(JSON.stringify({
      mode: 'state-consistency',
      version: version.version,
      database,
      host: '127.0.0.1',
      port,
      container,
      ...inventory,
    }));

    const code = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, [
        '--require', './test/helpers/test-env.cjs',
        '--test', '--test-concurrency=1', 'test/state-consistency.mariadb.test.cjs',
      ], {
        cwd: backend,
        stdio: 'inherit',
        windowsHide: true,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          TZ: 'UTC',
          DOTENV_CONFIG_PATH: path.join(backend, 'test/helpers/nonexistent.env'),
          JWT_SECRET: randomUUID(),
          APP_PUBLIC_ORIGIN: 'http://browser.test',
          DB_HOST: '127.0.0.1',
          DB_PORT: String(port),
          DB_NAME: database,
          DB_USER: 'root',
          DB_PASSWORD: password,
          RECEIPT_STORAGE_DIR: storage,
        },
      });
      const timeout = setTimeout(() => { interrupted = true; child.kill('SIGTERM'); }, 240000);
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('exit', exitCode => { clearTimeout(timeout); child = null; resolve(exitCode); });
    });
    assert.equal(code, 0, `Suite T-S7-04.2 falló (exit ${code})`);
    assert.equal(interrupted, false);

    // Reaplicacion idempotente con datos reales poblados en las 26 tablas
    const { tables } = await readSchemaInventory(query);
    const populated = await snapshot(query, tables);
    for (const table of ['COMPROBANTE_PAGO', 'PAGO', 'PAGO_IDEMPOTENCIA', 'MOVIMIENTO_CUENTA_CORRIENTE', 'IMPUTACION_MOVIMIENTO_CUENTA', 'PEDIDO']) {
      assert.ok(populated.some(entry => entry.table === table && entry.rows.length > 0), table);
    }
    applySql(sqlFile(stateMigration));
    assert.deepEqual(await snapshot(query, tables), populated);
    console.log('Reaplicación idempotente #290 verificada: filas de las 26 tablas preservadas intactas.');
  } finally {
    process.off('SIGINT', signal);
    process.off('SIGTERM', signal);
    try {
      if (connection) await connection.end();
    } finally {
      if (storage) fs.rmSync(storage, { recursive: true, force: true });
      if (started) {
        const info = JSON.parse(docker('inspect', container))[0];
        assert.equal(info.Config.Labels[labelKey], token);
        docker('rm', '-f', '-v', container);
        assert.equal(docker('ps', '-aq', '--filter', `label=${labelKey}=${token}`), '');
        console.log('CLEANUP OK T-S7-04.2: contenedor eliminado, datos tmpfs, almacenamiento temporal eliminado.');
      }
    }
  }
}

main().catch(error => {
  const message = error.stderr?.toString().trim() || error.message;
  console.error(message.replaceAll(password, '[oculto]'));
  process.exitCode = 1;
});
