const { execFileSync, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mariadb = require('mariadb');
const assert = require('node:assert/strict');
const backend = path.resolve(__dirname, '../..');
const token = randomUUID().replaceAll('-', '');
const database = `price_verification_test_${token}`;
const container = `price-verification-test-${token}`;
const password = randomUUID();
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 180000 }).trim();

async function main() {
  let started = false;
  let connection;
  try {
    docker('run', '--rm', '-d', '--name', container, '-p', '127.0.0.1::3306',
      '-e', `MARIADB_ROOT_PASSWORD=${password}`, '-e', `MARIADB_DATABASE=${database}`, 'mariadb:11.4');
    started = true;
    const info = JSON.parse(docker('inspect', container))[0];
    const port = Number(info.NetworkSettings.Ports['3306/tcp'][0].HostPort);
    for (let i = 0; i < 60; i++) {
      try {
        connection = await mariadb.createConnection({
          host: '127.0.0.1', port, user: 'root', password, database, connectTimeout: 1000,
        });
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    if (!connection) throw Error('MariaDB desechable no disponible');

    const apply = file => execFileSync(
      'docker',
      ['exec', '-i', container, 'mariadb', '-uroot', `-p${password}`, database],
      { input: fs.readFileSync(path.join(backend, '../database', file)), stdio: 'pipe', timeout: 60000 },
    );

    apply('schema.sql');
    apply('migrate-fer-20-account-movements.sql');
    apply('migrate-fer-17-pricing-evidence.sql');
    apply('migrate-fer-17-price-verification.sql');
    apply('migrate-fer-17-price-verification.sql');

    const [tables] = await connection.query(
      "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'",
    );
    assert.equal(Number(tables.n), 22, 'La instalación limpia debe tener 22 tablas base');
    const triggerRows = await connection.query(
      'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY TRIGGER_NAME',
    );
    assert.deepEqual(triggerRows.map(row => row.TRIGGER_NAME), [
      'fer17_producto_alta_evento',
      'fer17_producto_precio_evento',
      'fer260_cuenta_revision',
      'fer260_imputacion_insert',
      'fer260_imputacion_update',
    ], 'La instalación limpia debe tener 3 triggers FER-20 y 2 triggers FER-17');

    console.log(JSON.stringify({
      database, container, port,
      version: (await connection.query('SELECT VERSION() AS version'))[0].version,
      tables: Number(tables.n), triggers: triggerRows.length,
    }));

    const env = {
      ...process.env,
      DOTENV_CONFIG_PATH: path.join(backend, 'test/helpers/nonexistent.env'),
      JWT_SECRET: randomUUID(),
      DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_NAME: database,
      DB_USER: 'root', DB_PASSWORD: password,
      PRICE_VERIFICATION_TEST_DATABASE: database,
      PRICE_VERIFICATION_RUN_ID: token,
    };
    const runSuite = file => spawnSync(
      process.execPath,
      ['--require', './test/helpers/test-env.cjs', '--test', '--test-concurrency=1', file],
      { cwd: backend, stdio: 'inherit', env },
    );
    const mainResult = runSuite('test/price-verification.mariadb.test.cjs');
    if (mainResult.error) throw mainResult.error;
    if (mainResult.status !== 0) throw Error('La suite principal de verificación de precios falló');

    // Requirement: evidence and audit survive a MariaDB restart.
    await connection.end().catch(() => undefined);
    connection = undefined;
    docker('restart', container);
    for (let i = 0; i < 60; i++) {
      try {
        connection = await mariadb.createConnection({
          host: '127.0.0.1', port, user: 'root', password, database, connectTimeout: 1000,
        });
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    if (!connection) throw Error('MariaDB no volvió tras el reinicio');

    const restartResult = runSuite('test/price-verification.restart.test.cjs');
    if (restartResult.error) throw restartResult.error;
    if (restartResult.status !== 0) throw Error('La verificación de persistencia tras reinicio falló');
    console.log('T-S7-05.2: evidencia, auditoría y FER17 conservados tras reiniciar MariaDB.');
  } finally {
    try { if (connection) await connection.end(); }
    finally { if (started) docker('rm', '-f', '-v', container); }
  }
}

main().catch(error => {
  console.error(error.stderr?.toString?.().trim() || error.message);
  process.exitCode = 1;
});
