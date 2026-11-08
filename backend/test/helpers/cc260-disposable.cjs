const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const owned = new WeakSet();
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 180000 }).trim();

function validateProfile(p, info) {
  assert.match(p.token, /^[a-f0-9]{32}$/);
  assert.equal(p.host, '127.0.0.1', 'Solo loopback');
  assert.equal(p.database, `cc260_test_${p.token}`);
  assert.equal(p.container, `cc260-test-${p.token}`);
  assert.match(p.id, /^[a-f0-9]{64}$/);
  assert.ok(Number.isInteger(p.port) && p.port > 0 && p.port <= 65535);
  assert.equal(info.Id, p.id);
  assert.equal(info.Name, `/${p.container}`);
  assert.equal(info.Config.Image, 'mariadb:11.4');
  assert.equal(info.Config.Labels['ferrepatagonia.cc260-test'], p.token);
  assert.equal(info.State.Running, true);
  assert.ok(info.Config.Env.includes(`MARIADB_DATABASE=${p.database}`));
  assert.ok(info.Config.Env.includes(`MARIADB_ROOT_PASSWORD=${p.password}`));
  assert.deepEqual(info.NetworkSettings.Ports['3306/tcp'], [{ HostIp: p.host, HostPort: String(p.port) }]);
  assert.equal(info.HostConfig.AutoRemove, true);
  assert.ok(info.HostConfig.Tmpfs['/var/lib/mysql']);
  assert.ok(info.Mounts.every(m => m.Type === 'tmpfs'), 'Sin volumen ni bind persistente');
}

function newProfile() {
  const token = randomUUID().replaceAll('-', '');
  return { token, host: '127.0.0.1', database: `cc260_test_${token}`, container: `cc260-test-${token}`, password: randomUUID() };
}

function inspect(p) { return JSON.parse(docker('inspect', p.id))[0]; }
async function connectOwned(p) {
  validateProfile(p, inspect(p)); // Before opening any database connection.
  const mariadb = require('mariadb');
  const connection = await mariadb.createConnection({ host: p.host, port: p.port, user: 'root',
    password: p.password, database: p.database, connectTimeout: 1000, timezone: 'Z', dateStrings: true });
  const session = { connection, profile: Object.freeze({ ...p }) };
  owned.add(session);
  try { await assertOwned(session); return session; }
  catch (error) { await connection.end(); throw error; }
}

async function assertOwned(session) {
  assert.ok(owned.has(session), 'Seed rechazado: sesión ajena al runner descartable');
  const info = inspect(session.profile);
  validateProfile(session.profile, info);
  const [row] = await session.connection.query('SELECT DATABASE() AS db, @@port AS port, @@hostname AS hostname');
  assert.equal(row.db, session.profile.database);
  assert.equal(Number(row.port), 3306);
  assert.equal(row.hostname, info.Config.Hostname, 'Identidad real del servidor');
}

function childProfile() {
  const p = JSON.parse(process.env.CC260_TEST_PROFILE || 'null');
  assert.ok(p, 'Ejecutar npm run test:cuenta-corriente, nunca directamente');
  assert.equal(process.env.DB_HOST, p.host);
  assert.equal(process.env.DB_PORT, String(p.port));
  assert.equal(process.env.DB_NAME, p.database);
  assert.equal(process.env.DB_USER, 'root');
  assert.equal(process.env.DB_PASSWORD, p.password);
  return p;
}

module.exports = { docker, newProfile, validateProfile, connectOwned, assertOwned, childProfile };
