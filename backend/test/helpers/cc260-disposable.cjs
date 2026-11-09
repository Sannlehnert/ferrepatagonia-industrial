const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const owned = new WeakSet();
const docker = (...args) => execFileSync('docker', args, {
  encoding: 'utf8', stdio: 'pipe', windowsHide: true, timeout: 180000,
}).trim();
const runners = {
  251: { database: 'cc_client_test_', container: 'cc-client-test-', label: 'ferrepatagonia.cc251-test' },
  260: { database: 'cc260_test_', container: 'cc260-test-', label: 'ferrepatagonia.cc260-test' },
};
const image = 'mariadb:11.4';
const containerId = /^[a-f0-9]{64}$/;

function assertProfile(p, runner) {
  assert.ok(p && typeof p === 'object', 'Se requiere un perfil descartable completo');
  assert.match(p.token, /^[a-f0-9]{32}$/);
  assert.equal(p.host, '127.0.0.1', 'Solo loopback');
  assert.equal(p.database, runners[runner].database + p.token);
  assert.equal(p.container, runners[runner].container + p.token);
  assert.match(p.id, containerId);
  assert.ok(Number.isInteger(p.port) && p.port > 0 && p.port <= 65535);
  assert.ok(typeof p.password === 'string' && p.password.trim(), 'Falta la contraseña descartable');
}

function label(p, runner) {
  return `${runners[runner].label}=${p.token}`;
}

function assertContainerOwner(p, id, info, runner) {
  assert.match(id, containerId);
  assert.ok(info?.Id === id && info.Name === `/${p.container}` &&
    info.Config.Labels?.[runners[runner].label] === p.token, 'El contenedor no pertenece al runner');
}

function validateProfile(p, info, runner = 260) {
  assertProfile(p, runner);
  assertContainerOwner(p, p.id, info, runner);
  assert.equal(info.Config.Image, image);
  assert.equal(info.Config.Hostname, p.id.slice(0, 12));
  assert.equal(info.State.Running, true);
  assert.ok(info.Config.Env.includes(`MARIADB_DATABASE=${p.database}`));
  assert.ok(info.Config.Env.includes(`MARIADB_ROOT_PASSWORD=${p.password}`), 'Credenciales Docker distintas del perfil');
  assert.deepEqual(info.NetworkSettings.Ports['3306/tcp'], [{ HostIp: p.host, HostPort: String(p.port) }]);
  const binding = info.HostConfig.PortBindings?.['3306/tcp'];
  assert.ok(binding?.length === 1 && binding[0].HostIp === p.host &&
    ['', '0'].includes(binding[0].HostPort), 'Docker debe asignar el puerto dinámicamente en loopback');
  assert.equal(info.HostConfig.AutoRemove, true);
  assert.ok(info.HostConfig.Tmpfs?.['/var/lib/mysql']);
  assert.ok(info.Mounts.every(m => m.Type === 'tmpfs'), 'Sin volumen ni bind persistente');
}

function newProfile(runner = 260) {
  const token = randomUUID().replaceAll('-', '');
  return { token, host: '127.0.0.1', database: runners[runner].database + token,
    container: runners[runner].container + token, password: randomUUID() };
}

function inspect(id) {
  assert.match(id, containerId);
  return JSON.parse(docker('inspect', '--type', 'container', id))[0];
}

async function connectOwned(p, runner = 260) {
  validateProfile(p, inspect(p.id), runner); // Before opening any database connection.
  const mariadb = require('mariadb');
  const connection = await mariadb.createConnection({ host: p.host, port: p.port, user: 'root',
    password: p.password, database: p.database, connectTimeout: 1000, timezone: 'Z', dateStrings: true });
  const session = Object.freeze({ connection, profile: Object.freeze({ ...p }), runner });
  owned.add(session);
  try { await assertOwned(session); return session; }
  catch (error) {
    try { await connection.end(); }
    catch (closeError) {
      throw new AggregateError([error, closeError], 'Fallaron la prueba de identidad y el cierre de MariaDB');
    }
    throw error;
  }
}

async function assertOwned(session) {
  assert.ok(owned.has(session), 'Seed rechazado: sesión ajena al runner descartable');
  const info = inspect(session.profile.id);
  validateProfile(session.profile, info, session.runner);
  const [row] = await session.connection.query(
    'SELECT DATABASE() AS db, @@port AS port, @@hostname AS hostname, VERSION() AS version',
  );
  assert.equal(row.db, session.profile.database);
  assert.equal(Number(row.port), 3306);
  assert.equal(row.hostname, info.Config.Hostname, 'Identidad real del servidor');
  assert.match(row.version, /^11\.4\.\d+-MariaDB\b/, 'Versión real de MariaDB');
}

function childProfile(runner = 260) {
  const key = `CC${runner}_TEST_PROFILE`;
  assert.ok(process.env[key], 'Ejecutar npm run test:cuenta-corriente con el runner descartable');
  let p;
  try { p = JSON.parse(process.env[key]); }
  catch { throw new Error(`Perfil descartable inválido: ${key}`); }
  assertProfile(p, runner);
  assert.equal(process.env.DB_HOST, p.host);
  assert.equal(process.env.DB_PORT, String(p.port));
  assert.equal(process.env.DB_NAME, p.database);
  assert.equal(process.env.DB_USER, 'root');
  assert.ok(process.env.DB_PASSWORD === p.password, 'DB_PASSWORD no coincide con el perfil descartable');
  return p;
}

module.exports = { docker, image, label, inspect, assertContainerOwner,
  newProfile, validateProfile, connectOwned, assertOwned, childProfile };
