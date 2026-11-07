const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { docker } = require('./helpers/account-disposable.cjs');

test('dos runners concurrentes: éxito y error limpian sus recursos sin colisiones', { timeout: 120000 }, async () => {
  const run = mode => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'helpers/run-account-mariadb.cjs'), mode],
      { windowsHide: true, env: { ...process.env, DB_HOST: 'production.invalid', DB_NAME: 'shared_development',
        DB_PORT: '3306', DB_PASSWORD: 'DO_NOT_USE', DOTENV_CONFIG_PATH: 'DO_NOT_LOAD' } });
    let output = '';
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    child.on('error', reject);
    child.on('exit', code => resolve({ code, output }));
  });
  const [success, failure] = await Promise.all([run('cleanup-success'), run('cleanup-failure')]);
  assert.equal(success.code, 0, success.output);
  assert.equal(failure.code, 1, failure.output);
  assert.match(failure.output, /DEMO_EXPECTED_FAILURE/);
  const profiles = [success, failure].map(r => {
    assert.match(r.output, /CLEANUP OK/);
    return JSON.parse(r.output.split(/\r?\n/).find(l => l.startsWith('{')));
  });
  assert.notEqual(profiles[0].database, profiles[1].database);
  assert.notEqual(profiles[0].container, profiles[1].container);
  assert.notEqual(profiles[0].port, profiles[1].port);
  for (const p of profiles) assert.equal(docker('ps', '-aq', '--filter', `name=^/${p.container}$`), '');
});
