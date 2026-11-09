const assert = require('node:assert/strict');
const { fork, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { newProfile } = require('./cc260-disposable.cjs');
const { openDatabase, prepareDatabase, removeDatabase } = require('./admin-account-db.cjs');
const { seedFixtures } = require('./e2e-fixtures.cjs');

const root = path.resolve(__dirname, '../../..');
const backend = path.join(root, 'backend');
const frontend = path.join(root, 'frontend');
const profile = newProfile('E2E');
const args = process.argv.slice(2);
const fer19 = args.includes('--fer19-production') ? 'production' : args.includes('--fer19') ? 'acceptance' : '';
const testArgs = args.filter(arg => arg !== '--fer19' && arg !== '--fer19-production');

const services = [];
let connection;
let testProcess;
let containerCreationAttempted = false;
let interrupted = false;
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

    function finish(error, ready) {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      child.off('error', onError);
      if (error) reject(error);
      else resolve(ready);
    }

    function onMessage(message) {
      if (
        message?.type === 'ready' &&
        Number.isInteger(message.port) &&
        message.port > 0 &&
        message.port <= 65535
      ) {
        finish(null, message);
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

  const session = await openDatabase(profile, 'E2E', checkInterrupted);
  connection = session.connection;
  await prepareDatabase(session, checkInterrupted);
  if (!fer19) await seedFixtures(connection, { includeAccountOrderFixture: false });
  await connection.end();
  connection = undefined;
  console.log(`Base E2E preparada: ${profile.database}`);
  checkInterrupted();

  // Elegir el origen antes de iniciar la API; strictPort falla si se ocupa.
  const candidate = require('node:net').createServer();
  await new Promise((resolve, reject) => {
    candidate.once('error', reject);
    candidate.listen(0, '127.0.0.1', resolve);
  });
  const plannedWebPort = candidate.address().port;
  await new Promise(resolve => candidate.close(resolve));
  const apiEnv = {
    ...process.env,
    NODE_ENV: 'test',
    TZ: 'UTC',
    APP_PUBLIC_ORIGIN: 'http://127.0.0.1:' + plannedWebPort,
    TRUSTED_PROXY_CIDRS: 'none',
    HTTPS_TERMINATION: 'trusted-proxy',
    AUTH_RATE_STORE: 'memory',
    API_PROCESS_COUNT: '1',
    AUTH_LOGIN_LIMIT: '100',
    AUTH_REGISTER_LIMIT: '100',
    AUTH_LOGIN_WINDOW_MS: '60000',
    AUTH_REGISTER_WINDOW_MS: '60000',
    DOTENV_CONFIG_PATH: path.join(__dirname, 'nonexistent-e2e.env'),
    E2E_ISOLATED: '1',
    JWT_SECRET: randomUUID(),
    E2E_FER19: fer19,
    DB_HOST: profile.host,
    DB_PORT: String(profile.port),
    DB_NAME: profile.database,
    DB_USER: 'root',
    DB_PASSWORD: profile.password,
    CCE2E_TEST_PROFILE: JSON.stringify(profile),
    PORT: '3000',
  };

  const { port: apiPort, adminAccounts, fer19Fixture } = await startService(
    path.join(__dirname, 'e2e-server.cjs'),
    backend,
    apiEnv,
  );

  checkInterrupted();

  const browserEnv = {
    ...process.env,
    NODE_ENV: 'test',
    E2E_ISOLATED: '1',
    E2E_WEB_PORT: String(plannedWebPort),
    E2E_API_URL: `http://127.0.0.1:${apiPort}`,
    E2E_ADMIN_ACCOUNTS: JSON.stringify(adminAccounts),
    E2E_FER19: fer19,
  };
  if (fer19 === 'production') browserEnv.E2E_PRODUCTION_BUILD = '1';
  else if (fer19) browserEnv.E2E_PRODUCTION_BUILD = '0';
  if (browserEnv.E2E_PRODUCTION_BUILD === '1') {
    assert.ok(
      fs.existsSync(path.join(frontend, 'dist/index.html')),
      'Primero compilá el frontend para E2E de producción.',
    );
  }

  const { port: webPort } = await startService(
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
      ...testArgs,
    ], {
      cwd: frontend,
      env: {
        ...browserEnv, E2E_BASE_URL: baseURL,
        // Only the Playwright worker needs access to test controls, never Vite.
        ...(fer19 ? {
          FER19_E2E_FIXTURE: JSON.stringify(fer19Fixture),
          FER19_E2E_PROFILE: JSON.stringify(profile),
          FER19_E2E_CURSOR_KEY: apiEnv.JWT_SECRET,
        } : { CCE2E_TEST_PROFILE: JSON.stringify(profile) }),
      },
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
      await removeDatabase(profile, 'E2E');
      console.log('Limpieza E2E confirmada: contenedor eliminado, datos tmpfs.');
    } catch {
      console.error(`No se pudo confirmar la limpieza de ${profile.container}`);
      failed = true;
    }
  }

  if (failed) process.exitCode = 1;
}

main()
  .catch(error => {
    console.error(error.message.replaceAll(profile.password, '[oculta]'));
    process.exitCode = 1;
  })
  .finally(cleanup);
