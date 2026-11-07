const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { docker, newProfile, connectOwned } = require('./account-disposable.cjs');
const backend = path.resolve(__dirname, '../..');
const mode = process.argv[2] || 'persistence';
const suites = {
  persistence: ['test/account.seed.mariadb.test.cjs'],
  contract: ['test/account.contract.mariadb.test.cjs'],
  client: ['test/account.client.mariadb.test.cjs'],
  'cleanup-success': [],
  'cleanup-failure': [],
};

async function main() {
  assert.ok(Object.hasOwn(suites, mode), 'Modo esperado: persistence, contract o client');
  for (const file of (mode.startsWith('cleanup-') ? [] : ['../database/migrate-fer-20-account-movements.sql', 'dist/repositories/cuentaCorriente.repository.js',
    ...(mode === 'client' ? ['dist/routes/cuentaCorriente.routes.js'] : [])])) {
    assert.ok(fs.existsSync(path.join(backend, file)), `PENDIENTE POR DEPENDENCIA #260/#251: falta ${file}. Build requerido; no se creó ninguna BD.`);
  }
  const p = newProfile();
  let session, child, interrupted = false;
  const signal = () => { interrupted = true; if (child) child.kill('SIGTERM'); };
  process.on('SIGINT', signal); process.on('SIGTERM', signal);
  try {
    p.id = docker('run', '--rm', '-d', '--name', p.container, '--label', `ferrepatagonia.account-test=${p.token}`,
      '--tmpfs', '/var/lib/mysql:rw', '-p', '127.0.0.1::3306', '-e', `MARIADB_ROOT_PASSWORD=${p.password}`,
      '-e', `MARIADB_DATABASE=${p.database}`, 'mariadb:11.4');
    const info = JSON.parse(docker('inspect', p.id))[0];
    p.port = Number(info.NetworkSettings.Ports['3306/tcp'][0].HostPort);
    for (let n = 0; n < 60 && !interrupted; n++) {
      try { session = await connectOwned(p); break; }
      catch (error) { if (n === 59) throw error; await new Promise(r => setTimeout(r, 1000)); }
    }
    assert.ok(session && !interrupted, 'MariaDB descartable no disponible o ejecución interrumpida');
    console.log(JSON.stringify({ mode, host: p.host, port: p.port, database: p.database, container: p.container }));
    if (mode === 'cleanup-failure') throw Error('DEMO_EXPECTED_FAILURE: prueba de limpieza');
    if (mode === 'cleanup-success') return;
    const db = session.connection;
    await db.query("SET SESSION time_zone = '+00:00'");
    const schema = fs.readFileSync(path.join(backend, '../database/schema.sql'), 'utf8');
    // Exercise the real additive migration on the base schema, then its idempotence.
    for (const sql of schema.split(/CREATE TABLE (?:IF NOT EXISTS )?MOVIMIENTO_CUENTA_CORRIENTE/)[0].split(';').filter(s => s.trim())) await db.query(sql);
    const migration = fs.readFileSync(path.join(backend, '../database/migrate-fer-20-account-movements.sql'), 'utf8')
      .replace(/^SET NAMES\s+\S+;\s*$/gim, '').replace(/^DELIMITER\s+\S+\s*$/gim, '').replace(/END\s*\/\//g, 'END;').trim();
    for (let n = 0; n < 2; n++) await db.query(migration);
    console.log(JSON.stringify({ mode, host: p.host, port: p.port, database: p.database, container: p.container,
      image: info.Image, version: (await db.query('SELECT VERSION() AS v'))[0].v, migrationApplications: 2 }));
    const env = { ...process.env, NODE_ENV: 'test', TZ: 'UTC', DOTENV_CONFIG_PATH: path.join(backend, 'test/helpers/nonexistent.env'),
      JWT_SECRET: randomUUID(), DB_HOST: p.host, DB_PORT: String(p.port), DB_NAME: p.database, DB_USER: 'root', DB_PASSWORD: p.password,
      ACCOUNT_TEST_PROFILE: JSON.stringify(p) };
    const code = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, ['--require', './test/helpers/test-env.cjs', '--test', '--test-concurrency=1', ...suites[mode]],
        { cwd: backend, env, stdio: 'inherit', windowsHide: true });
      const timeout = setTimeout(() => { interrupted = true; child.kill('SIGTERM'); }, 180000);
      child.on('error', e => { clearTimeout(timeout); reject(e); });
      child.on('exit', code => { clearTimeout(timeout); child = null; resolve(code); });
    });
    assert.equal(code, 0, `Suite ${mode} falló (exit ${code}); revisar TAP, no equivale a aceptación aprobada`);
    assert.equal(interrupted, false);
  } finally {
    process.off('SIGINT', signal); process.off('SIGTERM', signal);
    try { if (session) await session.connection.end(); }
    finally {
      if (p.id) {
        // Only remove the exact newly-created ID, with its ownership label.
        const info = JSON.parse(docker('inspect', p.id))[0];
        assert.equal(info.Config.Labels['ferrepatagonia.account-test'], p.token);
        docker('rm', '-f', '-v', p.id);
        assert.equal(docker('ps', '-aq', '--filter', `label=ferrepatagonia.account-test=${p.token}`), '');
        console.log('CLEANUP OK: contenedor propio eliminado; datos tmpfs, sin volúmenes persistentes.');
      }
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
