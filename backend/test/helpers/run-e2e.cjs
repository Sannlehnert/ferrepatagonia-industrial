const assert = require('node:assert/strict');
const { execFileSync, fork, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mariadb = require('mariadb');
const { seedFixtures } = require('./e2e-fixtures.cjs');

const root = path.resolve(__dirname, '../../..');
const backend = path.join(root, 'backend');
const frontend = path.join(root, 'frontend');
const token = randomUUID().replaceAll('-', '');
const database = `e2e_test_${token}`;
const container = `ferrepatagonia-e2e-${token}`;
const password = randomUUID();

const services = [];
let connection;
let testProcess;
let containerCreationAttempted = false;
let interrupted = false;
const anonymousVolumes = new Set();

function inspectContainer() {
  const info = JSON.parse(docker('inspect', container))[0];
  for (const mount of info.Mounts || []) {
    if (mount.Type === 'volume') anonymousVolumes.add(mount.Name);
  }
  return info;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function docker(...args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 180_000,
    windowsHide: true,
  }).trim();
}

function startService(file, cwd, env) {
  const child = fork(file, [], {
    cwd,
    env,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    windowsHide: true,
  });

  services.push(child);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      finish(new Error(`Tiempo agotado al iniciar ${path.basename(file)}`));
    }, 60_000);

    function finish(error, port) {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      child.off('error', onError);
      if (error) reject(error);
      else resolve(port);
    }

    function onMessage(message) {
      if (
        message?.type === 'ready' &&
        Number.isInteger(message.port) &&
        message.port > 0 &&
        message.port <= 65535
      ) {
        finish(null, message.port);
      }
    }

    function onExit() {
      finish(new Error(`Se cerró ${path.basename(file)} antes de iniciar`));
    }

    function onError(error) {
      finish(error);
    }

    child.on('message', onMessage);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  await new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 12_000);

    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    if (child.connected) {
      child.send('shutdown', error => {
        if (error) child.kill();
      });
    } else {
      child.kill();
    }
  });
}

function onInterrupt() {
  interrupted = true;
  if (testProcess) testProcess.kill();
}

process.once('SIGINT', onInterrupt);
process.once('SIGTERM', onInterrupt);

function checkInterrupted() {
  if (interrupted) throw new Error('Ejecución interrumpida.');
}

async function main() {
  assert.ok(
    fs.existsSync(path.join(backend, 'dist/app.js')),
    'Primero compilá el backend.',
  );

  containerCreationAttempted = true;

  docker(
    'run', '--rm', '-d',
    '--name', container,
    '-p', '127.0.0.1::3306',
    '-e', `MARIADB_ROOT_PASSWORD=${password}`,
    '-e', `MARIADB_DATABASE=${database}`,
    'mariadb:11.4',
  );

  const info = inspectContainer();
  const dbPort = Number(
    info.NetworkSettings.Ports['3306/tcp'][0].HostPort,
  );

  for (let attempt = 0; attempt < 60; attempt++) {
    checkInterrupted();

    try {
      connection = await mariadb.createConnection({
        host: '127.0.0.1',
        port: dbPort,
        user: 'root',
        password,
        database,
        connectTimeout: 1000,
      });
      break;
    } catch {
      await delay(1000);
    }
  }

  assert.ok(connection, 'MariaDB aislada no está disponible.');

  const schema = fs.readFileSync(
    path.join(root, 'database/schema.sql'),
    'utf8',
  );

  for (const statement of schema.split(';').filter(sql => sql.trim())) {
    await connection.query(statement);
  }

  await seedFixtures(connection);
  await connection.end();
  connection = undefined;

  console.log(`Base E2E preparada: ${database}`);
  checkInterrupted();

  const apiEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DOTENV_CONFIG_PATH: path.join(__dirname, 'nonexistent-e2e.env'),
    E2E_ISOLATED: '1',
    JWT_SECRET: randomUUID(),
    DB_HOST: '127.0.0.1',
    DB_PORT: String(dbPort),
    DB_NAME: database,
    DB_USER: 'root',
    DB_PASSWORD: password,
    PORT: '3000',
  };

  const apiPort = await startService(
    path.join(__dirname, 'e2e-server.cjs'),
    backend,
    apiEnv,
  );

  checkInterrupted();

  const browserEnv = {
    ...process.env,
    NODE_ENV: 'test',
    E2E_ISOLATED: '1',
    E2E_API_URL: `http://127.0.0.1:${apiPort}`,
  };

  const webPort = await startService(
    path.join(frontend, 'e2e/helpers/vite-server.mjs'),
    frontend,
    browserEnv,
  );

  checkInterrupted();

  const baseURL = `http://127.0.0.1:${webPort}`;
  console.log(`Frontend E2E: ${baseURL}`);

  const result = await new Promise((resolve, reject) => {
    testProcess = spawn(process.execPath, [
      path.join(frontend, 'node_modules/@playwright/test/cli.js'),
      'test',
      ...process.argv.slice(2),
    ], {
      cwd: frontend,
      env: { ...browserEnv, E2E_BASE_URL: baseURL },
      stdio: 'inherit',
      windowsHide: true,
    });

    testProcess.once('error', reject);
    testProcess.once('exit', code => resolve(code));
  });

  process.exitCode = result === 0 && !interrupted ? 0 : 1;
}

async function cleanup() {
  let failed = false;

  for (const child of [testProcess, ...services.slice().reverse()]) {
    try {
      await stopChild(child);
    } catch {
      failed = true;
    }
  }

  if (connection) {
    try {
      await connection.end();
    } catch {
      failed = true;
    }
  }

  if (containerCreationAttempted) {
    try {
      const findContainer = () => docker(
        'ps', '-a',
        '--filter', `name=^/${container}$`,
        '--format', '{{.Names}}',
      );

      const existing = findContainer();

      if (existing !== '') {
        assert.equal(existing, container);
        // Volver a inventariar también si run o el primer inspect fallaron.
        // Un fallo de inventario no debe impedir intentar el borrado seguro.
        try {
          inspectContainer();
        } catch {
          failed = true;
          console.error('No se pudieron identificar los volúmenes E2E.');
        }
        docker('rm', '-f', '-v', container);
      }

      assert.equal(findContainer(), '');
      const remainingVolumes = docker('volume', 'ls', '--format', '{{.Name}}')
        .split(/\r?\n/);
      for (const volume of anonymousVolumes) {
        assert.ok(!remainingVolumes.includes(volume), 'Quedó un volumen E2E');
      }
      console.log(
        'Limpieza E2E confirmada: no quedan el contenedor ni sus volúmenes.',
      );
    } catch {
      console.error(`No se pudo confirmar la limpieza de ${container}`);
      failed = true;
    }
  }

  if (failed) process.exitCode = 1;
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(cleanup);