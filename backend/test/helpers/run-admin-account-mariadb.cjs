const { execFileSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mariadb = require('mariadb');
const { seedFixtures } = require('./e2e-fixtures.cjs');
const backend = path.resolve(__dirname, '../..');
const token = randomUUID().replaceAll('-', ''), database = `e2e_test_${token}`;
const container = `admin-account-test-${token}`, password = randomUUID();
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 180000 }).trim();
let id, connection, child, interrupted = false;
const interrupt = () => { interrupted = true; child?.kill('SIGTERM'); };
function inspect() {
  const info = JSON.parse(docker('inspect', id))[0];
  assert.equal(info.Id, id); assert.equal(info.Name, `/${container}`);
  assert.equal(info.Config.Labels['ferrepatagonia.admin-account-test'], token);
  assert.equal(info.Config.Image, 'mariadb:11.4');
  assert.ok(info.Config.Env.includes(`MARIADB_DATABASE=${database}`));
  assert.ok(info.HostConfig.Tmpfs['/var/lib/mysql']);
  assert.ok(info.Mounts.every(m => m.Type === 'tmpfs'));
  assert.equal(info.NetworkSettings.Ports['3306/tcp'][0].HostIp, '127.0.0.1');
  return info;
}
async function main() {
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
    id = docker('run', '--rm', '-d', '--name', container, '--label', `ferrepatagonia.admin-account-test=${token}`,
      '--tmpfs', '/var/lib/mysql:rw', '-p', '127.0.0.1::3306', '-e', `MARIADB_ROOT_PASSWORD=${password}`,
      '-e', `MARIADB_DATABASE=${database}`, 'mariadb:11.4');
    const info = inspect(), port = Number(info.NetworkSettings.Ports['3306/tcp'][0].HostPort);
    for (let n = 0; n < 60 && !interrupted; n++) {
      try { connection = await mariadb.createConnection({ host: '127.0.0.1', port, user: 'root', password, database, connectTimeout: 1000 }); break; }
      catch (error) { if (n === 59) throw error; await new Promise(r => setTimeout(r, 1000)); }
    }
    assert.ok(connection && !interrupted);
    assert.equal((await connection.query('SELECT DATABASE() AS db'))[0].db, database);
    console.log(JSON.stringify({ host: '127.0.0.1', port, database, version: (await connection.query('SELECT VERSION() AS v'))[0].v, image: info.Image }));
    for (const sql of fs.readFileSync(path.join(backend, '../database/schema.sql'), 'utf8').split(';').filter(v => v.trim())) await connection.query(sql);
    await seedFixtures(connection);
    const code = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, ['--require', './test/helpers/test-env.cjs', '--test', 'test/adminAccount.mariadb.test.cjs'], {
        cwd: backend, stdio: 'inherit', windowsHide: true, env: { ...process.env, NODE_ENV: 'test',
          DOTENV_CONFIG_PATH: path.join(__dirname, 'nonexistent-account.env'), JWT_SECRET: randomUUID(),
          DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_NAME: database, DB_USER: 'root', DB_PASSWORD: password,
          ADMIN_ACCOUNT_TEST_DATABASE: database },
      });
      const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
      child.on('error', e => { clearTimeout(timer); reject(e); });
      child.on('exit', code => { clearTimeout(timer); child = null; resolve(code); });
    });
    assert.equal(code, 0); assert.equal(interrupted, false);
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    try { if (connection) await connection.end(); }
    finally { if (id) { inspect(); docker('rm', '-f', '-v', id);
      assert.equal(docker('ps', '-aq', '--filter', `label=ferrepatagonia.admin-account-test=${token}`), '');
      console.log('CLEANUP OK: MariaDB propia descartada, tmpfs, sin volúmenes persistentes.'); } }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
