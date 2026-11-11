const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork, spawn } = require('node:child_process');
const { createServer } = require('node:net');
const { createInterface } = require('node:readline');
const local = require('./demo286-persistent.cjs');
const { credentials } = require('./e2e-fixtures.cjs');

const root = path.resolve(__dirname, '../../..');
const backend = path.join(root, 'backend');
const frontend = path.join(root, 'frontend');
const args = process.argv.slice(2);
const rehearsal = args.includes('--puertos-ensayo');
assert.ok(process.stdin.isTTY && (args.length === 0 || (args.length === 1 && rehearsal)),
  'Ejecutá desde una terminal, sin argumentos salvo --puertos-ensayo.');
const webPort = rehearsal ? 55173 : 5173;
const apiPort = rehearsal ? 53000 : 3000;
const publicOrigin = 'http://localhost:' + webPort;
const children = [];
let prompt;
let stopped = false;
let setup;
let secrets = [];

function stop() {
  stopped = true;
  prompt?.close();
  setup?.kill();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

async function checkPorts() {
  for (const port of [webPort, apiPort]) {
    for (const host of ['127.0.0.1', '::1']) {
      const probe = createServer();
      await new Promise((resolve, reject) => {
        probe.once('error', reject);
        probe.listen({ host, port, exclusive: true }, resolve);
      });
      await new Promise(resolve => probe.close(resolve));
    }
  }
}

function service(file, cwd, env, port) {
  const child = fork(file, [], { cwd, env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true });
  children.push(child);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No inició el servicio ' + port)), 60_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => {
      clearTimeout(timer);
      if (!stopped) {
        process.exitCode = 1;
        stop();
      }
      reject(new Error('Se cerró el servicio ' + port));
    });
    child.on('message', m => {
      if (m?.type === 'ready' && m.port === port) { clearTimeout(timer); resolve(); }
    });
  });
}

async function shutdown() {
  stopped = true;
  for (const child of children.slice().reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    await new Promise(resolve => {
      const timer = setTimeout(() => child.kill(), 10_500);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      if (child.connected) child.send('shutdown', error => { if (error) child.kill(); });
      else child.kill();
    });
  }
}

async function main() {
  assert.ok(fs.existsSync(path.join(backend, 'dist/app.js')) &&
    fs.existsSync(path.join(frontend, 'dist/index.html')), 'Primero compilá backend y frontend.');
  await checkPorts();
  const { profile, fresh } = await local.openPersistent();
  secrets = [profile.password, profile.rootPassword, profile.jwtSecret, profile.accountPassword];
  if (stopped) return;
  const baseEnv = {
    // Never inherit DB, dotenv, storage, auth, or hosted deployment settings.
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|USERPROFILE|LOCALAPPDATA|APPDATA|PLAYWRIGHT_BROWSERS_PATH)$/i.test(key))),
    NODE_ENV: 'test',
    E2E_ISOLATED: '1',
    E2E_DEMO_CATALOG: '1',
    E2E_LOCAL_PERSISTENT: '1',
  };
  await service(path.join(__dirname, 'e2e-server.cjs'), backend, {
    ...baseEnv, TZ: 'UTC', APP_PUBLIC_ORIGIN: publicOrigin, TRUSTED_PROXY_CIDRS: 'none',
    AUTH_RATE_STORE: 'memory', API_PROCESS_COUNT: '1',
    DOTENV_CONFIG_PATH: path.join(local.storage, 'no-cargar-env'),
    JWT_SECRET: profile.jwtSecret,
    RECEIPT_STORAGE_DIR: path.join(local.storage, 'comprobantes'),
    PRODUCT_IMAGE_STORAGE_DIR: path.join(local.storage, 'fotos'),
    DB_HOST: '127.0.0.1', DB_PORT: String(profile.port), DB_NAME: profile.database,
    DB_USER: local.user, DB_PASSWORD: profile.password,
    DEMO286_LOCAL_PROFILE: JSON.stringify(profile), PORT: String(apiPort),
  }, apiPort);
  if (stopped) return;
  await service(path.join(frontend, 'e2e/helpers/vite-server.mjs'), frontend, {
    ...baseEnv, E2E_API_URL: 'http://127.0.0.1:' + apiPort,
    E2E_WEB_PORT: String(webPort), E2E_PRODUCTION_BUILD: '1',
  }, webPort);
  if (stopped) return;
  if (fresh) {
    console.log('Preparando catálogo académico en ' + publicOrigin + ' (una sola vez).');
    const code = await new Promise((resolve, reject) => {
      setup = spawn(process.execPath, [path.join(frontend, 'node_modules/@playwright/test/cli.js'), 'test'], {
        cwd: frontend, stdio: 'inherit', windowsHide: true,
        env: { ...baseEnv, E2E_BASE_URL: publicOrigin, E2E_DEMO_INTERACTIVE: '1',
          DEMO286_LOCAL_PROFILE: JSON.stringify(profile) },
      });
      setup.once('error', reject);
      setup.once('exit', resolve);
    });
    setup = undefined;
    assert.equal(code, 0, 'Preparación incompleta; los datos y el volumen se conservaron.');
    fs.writeFileSync(local.ready, '904 SKU; 132 imágenes verificadas al inicializar.\n', { flag: 'wx' });
  }
  if (stopped) return;
  console.log('Demo: ' + publicOrigin + ' | API: http://localhost:' + apiPort + '/api/health');
  console.log('Particular: ' + credentials.client.email + ' | Empresa aprobada: ' + credentials.account.email + ' | ADMIN: ' + credentials.admin.email);
  console.log('Clave de esas cuentas: campo accountPassword en ' + path.join(local.storage, 'perfil.json'));
  prompt = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => {
    prompt.once('close', resolve);
    prompt.question('Enter detiene la web y la API; conserva base, fotos y comprobantes.\n', () => prompt.close());
  });
}

main().catch(error => {
  let message = error.message;
  for (const secret of secrets) message = message.replaceAll(secret, '[oculto]');
  console.error(message);
  process.exitCode = 1;
}).finally(shutdown);
