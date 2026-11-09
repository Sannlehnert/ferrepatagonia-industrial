const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const path = require('node:path');
const { newProfile } = require('./cc260-disposable.cjs');
const { openDatabase, prepareDatabase, removeDatabase } = require('./admin-account-db.cjs');

async function run() {
  const profile = newProfile(258);
  let session, child, interrupted, killTimer;
  const checkInterrupted = () => assert.ok(!interrupted, 'Suite ADMIN interrumpida');
  const interrupt = () => {
    interrupted = true;
    if (!child || killTimer) return;
    child.kill('SIGTERM');
    killTimer = setTimeout(() => child?.kill('SIGKILL'), 5000);
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    session = await openDatabase(profile, 258, checkInterrupted);
    await prepareDatabase(session, checkInterrupted);
    checkInterrupted();
    const backend = path.resolve(__dirname, '../..');
    const env = {
      ...process.env, NODE_ENV: 'test', TZ: 'UTC',
      DOTENV_CONFIG_PATH: path.join(__dirname, 'nonexistent.env'),
      JWT_SECRET: randomUUID(), DB_HOST: profile.host, DB_PORT: String(profile.port),
      DB_NAME: profile.database, DB_USER: 'root', DB_PASSWORD: profile.password,
      CC258_TEST_PROFILE: JSON.stringify(profile),
    };
    child = spawn(process.execPath, ['--require', './test/helpers/test-env.cjs', 'test/adminAccount.mariadb.test.cjs'],
      { cwd: backend, env, stdio: 'inherit', windowsHide: true });
    const timeout = setTimeout(interrupt, 180000);
    try {
      const [code] = await once(child, 'exit');
      checkInterrupted();
      assert.equal(code, 0, 'Falló la suite financiera ADMIN');
    } finally {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      child = undefined;
    }
  } finally {
    try {
      await session?.connection.end();
    } finally {
      try {
        await removeDatabase(profile, 258);
        console.log('Limpieza #258 confirmada: contenedor propio eliminado, datos tmpfs.');
      } finally {
        process.off('SIGINT', interrupt);
        process.off('SIGTERM', interrupt);
      }
    }
  }
}

run().catch(error => {
  // Docker and SQL errors can contain arguments. Keep failure messages independent of connection settings.
  console.error(error instanceof assert.AssertionError ? error.message : 'Falló la preparación o limpieza de MariaDB #258.');
  process.exitCode = 1;
});
