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
const paymentMigration = 'migrate-s7-10-2-payment-accreditation.sql';

async function snapshot(query, tables) {
  return Promise.all(tables.map(async table => ({
    table,
    rows: (await query(`SELECT * FROM ${table}`))
      .map(row => JSON.stringify(row, (_, value) => typeof value === 'bigint' ? value.toString() : value))
      .sort(),
  })));
}

async function stripPagoAndReceiptAdditions(db) {
  // Simular estado previo a #290 y #333 en COMPROBANTE_PAGO y PAGO
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
  await db.query('DROP TABLE IF EXISTS PAGO_IDEMPOTENCIA');
  await db.query(`
    ALTER TABLE PAGO
      DROP FOREIGN KEY fk_pago_cotizacion,
      DROP FOREIGN KEY fk_pago_admin_actor,
      DROP FOREIGN KEY fk_pago_admin_cierre,
      DROP CONSTRAINT chk_pago_estado,
      DROP CONSTRAINT chk_pago_monto_usd,
      DROP CONSTRAINT chk_pago_conversion,
      DROP CONSTRAINT chk_pago_documental,
      DROP CONSTRAINT chk_pago_revision,
      DROP CONSTRAINT chk_pago_declaracion,
      DROP CONSTRAINT chk_pago_acreditacion,
      DROP CONSTRAINT chk_pago_claves,
      DROP CONSTRAINT chk_pago_cierre,
      DROP INDEX uq_pago_idempotencia,
      DROP INDEX uq_pago_acreditacion,
      DROP INDEX uq_pago_clave_idempotencia,
      DROP INDEX uq_pago_clave_acreditacion,
      DROP INDEX uq_pago_clave_cierre,
      DROP INDEX uq_pago_comprobante,
      DROP INDEX idx_pago_cuenta_estado,
      DROP INDEX idx_pago_cotizacion,
      DROP INDEX idx_pago_admin_actor,
      DROP INDEX idx_pago_admin_cierre,
      DROP COLUMN monto_usd,
      DROP COLUMN id_cotizacion,
      DROP COLUMN tasa_historica,
      DROP COLUMN id_usuario_declarante,
      DROP COLUMN clave_idempotencia,
      DROP COLUMN huella_declaracion,
      DROP COLUMN id_comprobante,
      DROP COLUMN estado_documental,
      DROP COLUMN id_admin_revision,
      DROP COLUMN revision_utc,
      DROP COLUMN motivo_revision,
      DROP COLUMN id_admin_acreditacion,
      DROP COLUMN clave_acreditacion,
      DROP COLUMN huella_acreditacion,
      DROP COLUMN clave_idempotencia_acreditacion,
      DROP COLUMN clave_idempotencia_cierre,
      DROP COLUMN motivo_cierre,
      DROP COLUMN id_admin_actor,
      DROP COLUMN id_admin_cierre,
      DROP COLUMN fecha_cierre_utc
  `);
}

async function verifyUpgradeOrder(port, suffix, orderFiles) {
  const target = `${database}_${suffix}`;
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
    await stripPagoAndReceiptAdditions(db);

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
      for (const file of orderFiles) {
        applySql(sqlFile(file), { target });
      }
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

    // Verificar compatibilidad de chk_pago_declaracion con alta directa ADMIN (clave_idempotencia + id_usuario_declarante NULL)
    // y con declaracion de cliente (id_usuario_declarante NOT NULL), ademas de PAGO_IDEMPOTENCIA con las 6 operaciones.
    const directKey = randomUUID();
    const directRes = await db.query(`
      INSERT INTO PAGO (id_cuenta_corriente, monto, moneda, metodo_pago, estado, clave_idempotencia, id_admin_actor)
      VALUES (1, 10.00, 'USD', 'TRANSFERENCIA', 'PENDIENTE', ?, 4)
    `, [directKey]);
    const directId = Number(directRes.insertId);
    await db.query(`
      INSERT INTO PAGO_IDEMPOTENCIA (clave_idempotencia, id_pago, operacion, payload_hash, creado_en_utc)
      VALUES (?, ?, 'CREAR', SHA2('test-direct', 256), UTC_TIMESTAMP(3))
    `, [directKey, directId]);

    const declKey = randomUUID();
    const declReceipt = randomUUID();
    const declRes = await db.query(`
      INSERT INTO PAGO (
        id_cuenta_corriente, monto, moneda, metodo_pago, estado,
        id_usuario_declarante, clave_idempotencia, huella_declaracion, id_comprobante, estado_documental
      ) VALUES (1, 15.00, 'USD', 'TRANSFERENCIA', 'PENDIENTE', 3, ?, SHA2('test-decl', 256), ?, 'PENDIENTE')
    `, [declKey, declReceipt]);
    const declId = Number(declRes.insertId);
    await db.query(`
      INSERT INTO PAGO_IDEMPOTENCIA (clave_idempotencia, id_pago, operacion, payload_hash, creado_en_utc)
      VALUES (?, ?, 'DECLARAR', SHA2('test-decl', 256), UTC_TIMESTAMP(3)),
             (?, ?, 'REVISAR_PAGO', SHA2('test-rev', 256), UTC_TIMESTAMP(3))
    `, [declKey, declId, randomUUID(), declId]);

    // Verificar backfill de clave_idempotencia_cierre en estado RECHAZADO -> operacion 'RECHAZAR'
    const closeKey = randomUUID();
    await db.query(`
      UPDATE PAGO
      SET estado = 'RECHAZADO', motivo_cierre = 'Prueba backfill', id_admin_cierre = 4,
          fecha_cierre_utc = UTC_TIMESTAMP(3), clave_idempotencia_cierre = ?
      WHERE id_pago = ?
    `, [closeKey, directId]);
    applySql(sqlFile(stateMigration), { target });
    const [closeBackfill] = await db.query(
      'SELECT operacion FROM PAGO_IDEMPOTENCIA WHERE clave_idempotencia = ?',
      [closeKey],
    );
    assert.equal(closeBackfill.operacion, 'RECHAZAR');

    // Las 2 filas seed + 2 insertadas en la verificacion siguen intactas
    const [pagoCount] = await db.query('SELECT COUNT(*) AS n FROM PAGO');
    assert.equal(Number(pagoCount.n), 4);
  } finally {
    await db.end();
  }
}

async function checkLegacyUpgrade(port) {
  await verifyUpgradeOrder(port, 'upgrade_a', [stateMigration, paymentMigration]);
  await verifyUpgradeOrder(port, 'upgrade_b', [paymentMigration, stateMigration]);
  console.log('Upgrade aditivo #290 + #333 verificado en ambos órdenes (s7-04-2 -> s7-10-2 y s7-10-2 -> s7-04-2): 26 tablas, 13 triggers, backfill APROBADO/RECHAZAR y chk_pago_declaracion unificado.');
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
      paymentMigration,
      stateMigration,
      paymentMigration,
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
    applySql(sqlFile(paymentMigration));
    assert.deepEqual(await snapshot(query, tables), populated);
    console.log('Reaplicación idempotente #290 + #333 verificada: filas de las 26 tablas preservadas intactas.');
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
