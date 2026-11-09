const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { docker, newProfile, connectOwned, validateProfile } = require('./cc260-disposable.cjs');
const backend = path.resolve(__dirname, '../..');

async function run(mode = process.argv[2] || 'all') {
  assert.ok([
    'all', 'baseline', 'cleanup-success',
    'cleanup-failure', 'migration', 'orders',
  ].includes(mode));
  const p = newProfile();
  let session, child, interrupted = false;
  const signal = () => { interrupted = true; child?.kill('SIGTERM'); };
  process.on('SIGINT', signal); process.on('SIGTERM', signal);
  try {
    p.id = docker('run', '--rm', '-d', '--name', p.container, '--label', `ferrepatagonia.cc260-test=${p.token}`,
      '--tmpfs', '/var/lib/mysql:rw', '-p', '127.0.0.1::3306', '-e', `MARIADB_ROOT_PASSWORD=${p.password}`,
      '-e', `MARIADB_DATABASE=${p.database}`, 'mariadb:11.4');
    const info = JSON.parse(docker('inspect', p.id))[0];
    p.port = Number(info.NetworkSettings.Ports['3306/tcp'][0].HostPort);
    for (let n = 0; n < 60 && !interrupted; n++) {
      try { session = await connectOwned(p); break; }
      catch (e) { if (n === 59) throw e; await new Promise(r => setTimeout(r, 1000)); }
    }
    assert.ok(session && !interrupted, 'MariaDB descartable no disponible');
    console.log(JSON.stringify({ mode, database:p.database, host:p.host, port:p.port, container:p.container }));
    if (mode === 'cleanup-failure') throw Error('EXPECTED_CLEANUP_FAILURE');
    if (mode === 'cleanup-success') return;
    const apply = file => {
      validateProfile(p, JSON.parse(docker('inspect', p.id))[0]);
      const result = spawnSync('docker', ['exec', '-i', p.id, 'mariadb', '-uroot', `-p${p.password}`, p.database],
        { input: fs.readFileSync(file), encoding: 'utf8', windowsHide: true, timeout: 60000 });
      if (result.status !== 0) throw Error(`SQL ${path.basename(file)}: ${result.stderr}`);
    };
    apply(path.join(backend, '../database/schema.sql'));
    for (let i = 0; i < 2; i++) apply(path.join(backend, '../database/migrate-fer-20-account-movements.sql'));
      if (mode === 'orders') {
        apply(path.join(
          backend,
          '../database/migrate-fer-20-order-confirmation.sql',
        ));
      }
    console.log(JSON.stringify({ mode, database: p.database, host: p.host, port: p.port, container: p.container,
      version: (await session.connection.query('SELECT VERSION() AS v'))[0].v, image: info.Image, migrationApplications: 2 }));
    const files = mode === 'orders'
      ? [
          'test/account-order.persistence.test.cjs',
          'test/account-order-attempt.test.cjs',
          'test/account-order-result.test.cjs',
          'test/account-order-cart.test.cjs',
          'test/account-order-pricing.test.cjs',
          'test/account-order-storage.test.cjs',
          'test/account-order-transaction.test.cjs',
          'test/account-order-service.test.cjs',
          'test/account-order-http.test.cjs',
          'test/account-order-process.test.cjs',
          'test/client-orders.test.cjs',
        ]
      : mode === 'baseline'
        ? ['test/cc260.regression.test.cjs']
        : mode === 'migration'
          ? ['test/cc260.migration.test.cjs']
          : [
              'test/cuentaCorriente.test.cjs',
              'test/cc260.regression.test.cjs',
              'test/cc260.migration.test.cjs',
            ];
    const code = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, ['--require', './test/helpers/test-env.cjs', '--test', '--test-concurrency=1', ...files],
        { cwd: backend, stdio: 'inherit', windowsHide: true, env: { ...process.env, NODE_ENV: 'test', TZ: 'UTC',
          DOTENV_CONFIG_PATH: path.join(backend, 'test/helpers/nonexistent.env'), JWT_SECRET: randomUUID(),
          DB_HOST: p.host, DB_PORT: String(p.port), DB_NAME: p.database, DB_USER: 'root', DB_PASSWORD: p.password,
          CC260_TEST_PROFILE: JSON.stringify(p) } });
      const timeout = setTimeout(() => { interrupted = true; child.kill('SIGTERM'); }, 240000);
      child.on('error', e => { clearTimeout(timeout); reject(e); });
      child.on('exit', code => { clearTimeout(timeout); child = null; resolve(code); });
    });
    assert.equal(code, 0, `Suite #260 falló (exit ${code})`);
    assert.equal(interrupted, false);
  } finally {
    process.off('SIGINT', signal); process.off('SIGTERM', signal);
    try { if (session) await session.connection.end(); }
    finally {
      if (p.id) {
        const info = JSON.parse(docker('inspect', p.id))[0];
        assert.equal(info.Config.Labels['ferrepatagonia.cc260-test'], p.token);
        docker('rm', '-f', '-v', p.id);
        assert.equal(docker('ps', '-aq', '--filter', `label=ferrepatagonia.cc260-test=${p.token}`), '');
        console.log('CLEANUP OK #260: contenedor eliminado, datos tmpfs, sin volumen persistente.');
      }
    }
  }
}
if (require.main === module) run().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { run };
