const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { docker, image, inspect } = require('./cc260-disposable.cjs');

// Outside the checkout; in particular receipts must not be in its static tree.
const storage = path.resolve(__dirname, '../../../../.demo286-local');
const profileFile = path.join(storage, 'perfil.json');
const ready = path.join(storage, 'catalogo-cargado');
const label = 'ferrepatagonia.demo286-local';
const user = 'demo286';
const name = p => 'demo286-' + p.token;
const volume = p => name(p) + '-mariadb';
const password = () => randomBytes(24).toString('hex');

function assertProfile(p) {
  assert.match(p.token, /^[a-f0-9]{32}$/);
  assert.equal(p.database, 'ferre_demo_' + p.token);
  assert.match(p.id, /^[a-f0-9]{64}$/);
  assert.ok(Number.isInteger(p.port) && p.port > 0 && p.port <= 65535);
  for (const key of ['password', 'rootPassword', 'accountPassword', 'jwtSecret']) assert.match(p[key], /^[a-f0-9]{48}$/);
}

function verifyContainer(p, running = true) {
  assertProfile(p);
  const info = inspect(p.id);
  assert.equal(info.Name, '/' + name(p));
  assert.equal(info.Config.Hostname, name(p));
  assert.equal(info.Config.Labels?.[label], p.token);
  assert.equal(info.Config.Image, image);
  assert.equal(info.HostConfig.AutoRemove, false);
  assert.equal(info.HostConfig.NetworkMode, 'bridge');
  assert.deepEqual(info.Mounts.map(m => [m.Type, m.Name, m.Destination, m.RW]), [
    ['volume', volume(p), '/var/lib/mysql', true],
  ]);
  const [disk] = JSON.parse(docker('volume', 'inspect', volume(p)));
  assert.equal(disk.Labels?.[label], p.token);
  assert.ok(info.Config.Env.includes('MARIADB_DATABASE=' + p.database));
  assert.ok(info.Config.Env.includes('MARIADB_USER=' + user));
  const binding = info.HostConfig.PortBindings?.['3306/tcp'];
  assert.ok(binding?.length === 1 && binding[0].HostIp === '127.0.0.1' &&
    ['', '0'].includes(binding[0].HostPort), 'MariaDB debe usar un puerto asignado en loopback.');
  if (running) {
    assert.equal(info.State.Running, true);
    assert.deepEqual(info.NetworkSettings.Ports['3306/tcp'], [{ HostIp: '127.0.0.1', HostPort: String(p.port) }]);
  }
  return info;
}

async function verifySql(connection, p, marker = true) {
  const [row] = await connection.query('SELECT DATABASE() AS db, @@hostname AS host, VERSION() AS version');
  assert.equal(row.db, p.database);
  assert.equal(row.host, name(p));
  assert.match(row.version, /^11\.4\.\d+-MariaDB\b/);
  if (marker) {
    const [identity] = await connection.query('SELECT token FROM DEMO286_IDENTIDAD WHERE id = 1');
    assert.equal(identity?.token, p.token, 'Identidad SQL de la demo incorrecta.');
  }
}

async function connectPersistent(p, marker = true) {
  verifyContainer(p);
  const connection = await require('mariadb').createConnection({ host: '127.0.0.1', port: p.port, user,
    password: p.password, database: p.database, connectTimeout: 1200, timezone: 'Z', dateStrings: true });
  try { await verifySql(connection, p, marker); return { connection }; }
  catch (error) { await connection.end(); throw error; }
}

async function openPersistent() {
  if (fs.existsSync(storage)) {
    assert.ok(!fs.lstatSync(storage).isSymbolicLink(), 'El directorio de demo no puede ser un enlace.');
    assert.ok(fs.existsSync(ready), 'Preparación incompleta. Conservá el volumen y los archivos; no se volverá a sembrar.');
    for (const folder of ['fotos', 'comprobantes']) {
      assert.ok(fs.lstatSync(path.join(storage, folder)).isDirectory(), 'Falta el almacenamiento local de ' + folder);
    }
    const p = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
    const info = verifyContainer(p, false);
    if (!info.State.Running) docker('start', p.id);
    p.port = Number(inspect(p.id).NetworkSettings.Ports['3306/tcp']?.[0]?.HostPort);
    await waitForDb(p, true);
    return { profile: p, fresh: false };
  }

  fs.mkdirSync(storage, { mode: 0o700 });
  const p = { token: randomBytes(16).toString('hex'), password: password(), rootPassword: password(),
    accountPassword: password(), jwtSecret: password() };
  p.database = 'ferre_demo_' + p.token;
  fs.writeFileSync(profileFile, JSON.stringify(p) + '\n', { flag: 'wx', mode: 0o600 });
  for (const folder of ['fotos', 'comprobantes']) fs.mkdirSync(path.join(storage, folder), { mode: 0o700 });
  docker('volume', 'create', '--label', label + '=' + p.token, volume(p));
  p.id = docker('run', '-d', '--name', name(p), '--hostname', name(p), '--label', label + '=' + p.token,
    '--network', 'bridge', '--publish', '127.0.0.1::3306', '--mount', 'type=volume,source=' + volume(p) + ',target=/var/lib/mysql',
    '-e', 'MARIADB_DATABASE=' + p.database, '-e', 'MARIADB_USER=' + user, '-e', 'MARIADB_PASSWORD=' + p.password,
    '-e', 'MARIADB_ROOT_PASSWORD=' + p.rootPassword, image);
  p.port = Number(inspect(p.id).NetworkSettings.Ports['3306/tcp']?.[0]?.HostPort);
  verifyContainer(p);
  fs.writeFileSync(profileFile, JSON.stringify(p) + '\n', { mode: 0o600 });
  const { connection } = await waitForDb(p, false);
  try {
    const [initial] = await connection.query('SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE()');
    assert.equal(Number(initial.total), 0, 'Se requiere un esquema académico vacío para inicializar.');
    for (const file of ['schema.sql', 'migrate-fer-20-account-movements.sql']) {
      verifyContainer(p);
      execFileSync('docker', ['exec', '-i', p.id, 'mariadb', '-u' + user, '-p' + p.password, p.database], {
        input: fs.readFileSync(path.resolve(__dirname, '../../../database', file)), stdio: 'pipe', windowsHide: true, timeout: 60000,
      });
    }
    await connection.query('CREATE TABLE DEMO286_IDENTIDAD (id TINYINT PRIMARY KEY, token CHAR(32) NOT NULL)');
    await connection.query('INSERT INTO DEMO286_IDENTIDAD (id, token) VALUES (1, ?)', [p.token]);
    await verifySql(connection, p);
    await require('./e2e-fixtures.cjs').seedFixtures(connection, {
      includeCatalogProducts: false, includeReceiptFixture: 'particular', persistentProfile: p,
    });
  } finally { await connection.end(); }
  return { profile: p, fresh: true };
}

async function waitForDb(p, marker) {
  for (let i = 0; i < 45; i++) {
    try {
      const session = await connectPersistent(p, marker);
      if (!marker) return session;
      await session.connection.end();
      return;
    } catch (e) {
      if (e.code === 'ERR_ASSERTION' || i === 44) throw e;
      await delay(1000);
    }
  }
}

module.exports = { storage, ready, user, openPersistent, connectPersistent, verifySql };
