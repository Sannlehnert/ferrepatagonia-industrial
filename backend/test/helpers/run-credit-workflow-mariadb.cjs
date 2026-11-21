// Runner aislado de T-S7-09.1: MariaDB 11.4 descartable (tmpfs, auto-remove).
// Valida instalación completa y actualización de una base con datos.
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const mariadb = require('mariadb');
const { creditTables, readSchemaInventory } = require('../../scripts/lib/schema-inventory.cjs');
const { assertSchemaInventory } = require('./schema-inventory.cjs');

const backend = path.resolve(__dirname, '../..');
const token = randomUUID().replaceAll('-', '');
const database = `credit_test_${token}`;
const container = `credit-workflow-test-${token}`;
const password = randomUUID();
const labelKey = 'ferrepatagonia.credit-test';
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
  throw new Error('No hay un motor Docker con daemon disponible para la suite de crédito.');
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

const file = name => path.join(backend, '../database', name);
const creditMigration = 'migrate-s7-09-1-credit-workflow.sql';

async function snapshot(query, tables) {
  return Promise.all(tables.map(async table => ({
    table,
    rows: (await query(`SELECT * FROM ${table}`))
      .map(row => JSON.stringify(row, (_, value) => typeof value === 'bigint' ? value.toString() : value))
      .sort(),
  })));
}

async function checkUpgrade(port) {
  // Base anterior a crédito, con las migraciones FER-20 y FER-17 ya aplicadas.
  const target = `${database}_upgrade`;
  docker('exec', container, 'mariadb', '--protocol=socket', '--skip-ssl', '-uroot', `-p${password}`, '-e', `CREATE DATABASE ${target}`);
  const schema = fs.readFileSync(file('schema.sql'), 'utf8');
  const previous = schema.split(';').filter(statement =>
    !creditTables.some(table => statement.includes(`CREATE TABLE IF NOT EXISTS ${table} (`)),
  ).join(';');
  applySql(file('schema.sql'), { target, contents: previous });
  for (const name of ['migrate-fer-20-account-movements.sql', 'migrate-fer-17-price-verification.sql', 'migrate-s7-04-2-state-consistency.sql', 'seed.sql', 'verify-seed.sql']) {
    applySql(file(name), { target });
  }
  const db = await mariadb.createConnection({ host: '127.0.0.1', port, user: 'root',
    password, database: target, timezone: 'Z', dateStrings: true });
  try {
    const query = sql => db.query(sql);
    await assertSchemaInventory(query, 'before-credit');
    const { tables } = await readSchemaInventory(query);
    const before = await snapshot(query, tables);
    assert.ok(before.some(({ table, rows }) => table === 'PAGO' && rows.length));
    assert.ok(before.some(({ table, rows }) => table === 'FER17_PRECIO_EVENTO' && rows.length));
    for (let i = 0; i < 2; i += 1) {
      applySql(file(creditMigration), { target });
      await assertSchemaInventory(query, 'complete');
      assert.deepEqual(await snapshot(query, tables), before, 'la migración conserva todas las filas previas');
    }
    console.log('Migración aditiva: filas de las 22 tablas previas preservadas en ambas ejecuciones.');
  } finally {
    await db.end();
  }
}

async function main() {
  let started = false;
  let connection;
  let interrupted = false;
  let child;
  const signal = () => { interrupted = true; child?.kill('SIGTERM'); };
  process.on('SIGINT', signal);
  process.on('SIGTERM', signal);

  try {
    docker('run', '--rm', '-d', '--name', container, '--label', `${labelKey}=${token}`,
      '--tmpfs', '/var/lib/mysql:rw', '-p', '127.0.0.1::3306',
      '-e', `MARIADB_ROOT_PASSWORD=${password}`, '-e', `MARIADB_DATABASE=${database}`, image);
    started = true;

    const info = JSON.parse(docker('inspect', container))[0];
    assert.equal(info.Config.Image, image);
    assert.equal(info.Config.Labels[labelKey], token);
    assert.equal(info.State.Running, true);
    assert.ok(info.HostConfig.Tmpfs?.['/var/lib/mysql']);
    assert.ok(info.Mounts.every(mount => mount.type === 'tmpfs' || mount.Type === 'tmpfs'));
    const binding = info.NetworkSettings.Ports['3306/tcp'];
    assert.ok(Array.isArray(binding) && binding.length === 1
      && binding[0].HostIp === '127.0.0.1' && Number(binding[0].HostPort) > 0);
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
    for (const name of ['schema.sql', 'migrate-fer-20-account-movements.sql', 'migrate-fer-17-price-verification.sql', 'migrate-s7-04-2-state-consistency.sql', creditMigration]) {
      applySql(file(name));
    }
    const query = sql => connection.query(sql);
    const inventory = await assertSchemaInventory(query, 'complete');
    await checkUpgrade(port);
    console.log(JSON.stringify({ mode: 'credit-workflow', version: version.version,
      database, host: '127.0.0.1', port, container, ...inventory }));

    const code = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, [
        '--require', './test/helpers/test-env.cjs',
        '--test', '--test-concurrency=1', 'test/credit-workflow.mariadb.test.cjs',
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
        },
      });
      const timeout = setTimeout(() => {
        interrupted = true;
        child.kill('SIGTERM');
      }, 240000);
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('exit', exitCode => { clearTimeout(timeout); child = null; resolve(exitCode); });
    });
    assert.equal(code, 0, `Suite T-S7-09.1 falló (exit ${code})`);
    assert.equal(interrupted, false);
    const { tables } = await readSchemaInventory(query);
    const populated = await snapshot(query, tables);
    for (const table of [...creditTables, 'MOVIMIENTO_CUENTA_CORRIENTE']) {
      assert.ok(populated.some(entry => entry.table === table && entry.rows.length > 0), table);
    }
    applySql(file(creditMigration));
    assert.deepEqual(await snapshot(query, tables), populated);
    console.log('Reaplicación verificada: filas de las 24 tablas preservadas, incluidos solicitudes, eventos y movimientos.');
  } finally {
    process.off('SIGINT', signal);
    process.off('SIGTERM', signal);
    try {
      if (connection) await connection.end();
    } finally {
      if (started) {
        const info = JSON.parse(docker('inspect', container))[0];
        assert.equal(info.Config.Labels[labelKey], token);
        docker('rm', '-f', '-v', container);
        assert.equal(docker('ps', '-aq', '--filter', `label=${labelKey}=${token}`), '');
        console.log('CLEANUP OK T-S7-09.1: contenedor eliminado, datos tmpfs.');
      }
    }
  }
}

main().catch(error => {
  const message = error.stderr?.toString().trim() || error.message;
  console.error(message.replaceAll(password, '[oculto]'));
  process.exitCode = 1;
});
