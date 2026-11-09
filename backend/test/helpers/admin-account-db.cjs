const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const {
  docker, image, label, inspect, assertContainerOwner, validateProfile, connectOwned, assertOwned,
} = require('./cc260-disposable.cjs');

async function openDatabase(profile, runner, checkInterrupted) {
  checkInterrupted();
  profile.id = docker('run', '--rm', '-d', '--name', profile.container, '--label', label(profile, runner),
    '--tmpfs', '/var/lib/mysql:rw', '-p', `${profile.host}::3306`,
    '-e', `MARIADB_ROOT_PASSWORD=${profile.password}`, '-e', `MARIADB_DATABASE=${profile.database}`, image);
  const info = inspect(profile.id);
  profile.port = Number(info.NetworkSettings.Ports['3306/tcp']?.[0]?.HostPort);
  validateProfile(profile, info, runner);
  for (let attempt = 0; attempt < 60; attempt++) {
    checkInterrupted();
    try {
      return await connectOwned(profile, runner);
    } catch (error) {
      if (error.code === 'ERR_ASSERTION' || error instanceof AggregateError || attempt === 59) throw error;
      await delay(1000);
    }
  }
}

async function prepareDatabase(session, checkInterrupted) {
  const { id, password, database } = session.profile;
  for (const name of ['schema.sql', 'migrate-fer-20-account-movements.sql']) {
    checkInterrupted();
    await assertOwned(session);
    execFileSync('docker', ['exec', '-i', id, 'mariadb', '-uroot', `-p${password}`, database], {
      input: fs.readFileSync(path.resolve(__dirname, '../../../database', name)),
      stdio: 'pipe', windowsHide: true, timeout: 60000,
    });
  }
}

async function removeDatabase(profile, runner) {
  const byName = () => docker('ps', '-aq', '--no-trunc', '--filter', `name=^/${profile.container}$`);
  let id = byName();
  for (let i = 0; !profile.id && !id && i < 10; i++) {
    await delay(200);
    id = byName();
  }
  if (!id) return;
  if (profile.id) assert.equal(id, profile.id);
  try {
    assertContainerOwner(profile, id, inspect(id), runner);
    docker('rm', '-f', '-v', id);
  } catch (error) {
    if (byName()) throw error;
  }
  assert.equal(byName(), '', 'Docker dejó el contenedor descartable');
}

module.exports = { openDatabase, prepareDatabase, removeDatabase };
