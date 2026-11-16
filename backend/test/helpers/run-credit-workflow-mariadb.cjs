// Runner aislado de T-S7-09.1: MariaDB 11.4 descartable (tmpfs, auto-remove).
// Aplica schema.sql, FER-20, y la migración de crédito dos veces para verificar
// idempotencia. Nunca usa la base persistente ni puertos fijos.
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const mariadb = require('mariadb');

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

function applySql(file) {
  const result = spawnSync(dockerBin, [
    'exec', '-i', container, 'mariadb', '-uroot', `-p${password}`, database,
  ], {
    input: fs.readFileSync(file),
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

async function main() {
  let started = false;
  let connection;
  let interrupted = false;
  const signal = () => { interrupted = true; };
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

    applySql(path.join(backend, '../database/schema.sql'));
    applySql(path.join(backend, '../database/migrate-fer-20-account-movements.sql'));
    for (let i = 0; i < 2; i++) {
      applySql(path.join(backend, '../database/migrate-fer-20-account-movements.sql'));
      applySql(path.join(backend, '../database/migrate-s7-09-1-credit-workflow.sql'));
    }

    const requiredTables = [
      'CATEGORIA', 'PRODUCTO', 'LISTA_PRECIO', 'COTIZACION', 'CLIENTE', 'USUARIO',
      'PEDIDO', 'DETALLE_PEDIDO', 'CUENTA_CORRIENTE', 'PAGO',
      'MOVIMIENTO_CUENTA_CORRIENTE', 'IMPUTACION_MOVIMIENTO_CUENTA',
      'PRECIO_USD_EVIDENCIA', 'FER17_CALENDARIO', 'FER17_COTIZACION_VERIFICACION',
      'FER17_LISTA_INACTIVA_EVENTO', 'CARRITO', 'ITEM_CARRITO',
      'CONFIRMACION_PEDIDO_CC', 'DETALLE_PEDIDO_CC_PRECIO', 'COMPROBANTE_PAGO',
      'SOLICITUD_CREDITO', 'EVENTO_CREDITO',
    ];
    const tables = await connection.query(`
      SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?
    `, [database]);
    const tableNames = new Set(tables.map(row => row.name));
    for (const table of requiredTables) {
      assert.ok(tableNames.has(table), `Falta la tabla ${table}`);
    }
    const triggers = await connection.query(`
      SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME
    `, [database]);
    const triggerNames = new Set(triggers.map(row => row.TRIGGER_NAME));
    for (const trigger of [
      'fer260_cuenta_revision', 'fer260_imputacion_insert', 'fer260_imputacion_update',
    ]) {
      assert.ok(triggerNames.has(trigger), `Falta el trigger ${trigger}`);
    }

    console.log(JSON.stringify({
      mode: 'credit-workflow', database, host: '127.0.0.1', port,
      container, tables: tableNames.size, triggers: triggerNames.size,
    }));

    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
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
      child.on('exit', exitCode => { clearTimeout(timeout); resolve(exitCode); });
    });
    assert.equal(code, 0, `Suite T-S7-09.1 falló (exit ${code})`);
    assert.equal(interrupted, false);
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
  if (process.env.DEBUG_CREDIT_RUNNER) console.error(error);
  console.error(error instanceof assert.AssertionError ? error.message
    : 'Falló la preparación o limpieza de MariaDB de T-S7-09.1.');
  process.exitCode = 1;
});
