const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { randomUUID } = require('node:crypto');
const owned = require('./account-disposable.cjs');

const backend = path.resolve(__dirname, '../..');
const suites = {
  persistence: 'test/account.seed.mariadb.test.cjs',
  contract: 'test/account.contract.mariadb.test.cjs',
  client: 'test/account.client.mariadb.test.cjs',
};

async function removeOwnContainer(profile, docker = owned.docker) {
  const list = filter => docker('ps', '-aq', '--no-trunc', '--filter', filter);
  const filter = profile.id ? 'id=' + profile.id : 'name=^/' + profile.container + '$';
  let id = list(filter);
  for (let attempt = 0; !profile.id && !id && attempt < 10; attempt++) {
    await delay(200);
    id = list(filter);
  }
  if (!id) return;
  try {
    owned.assertContainerOwner(profile, id, owned.inspect(id));
    docker('rm', '-f', '-v', id);
  } catch (error) {
    if (list('id=' + id)) throw error;
  }
  assert.equal(list('id=' + id), '', 'El contenedor descartable sigue presente');
}

async function run(mode = 'persistence', {
  docker = owned.docker, connect = owned.connectOwned, execute = execFileSync, signal,
} = {}) {
  const cleanup = mode === 'cleanup-success' || mode === 'cleanup-failure';
  assert.ok(cleanup || mode === 'all' || Object.hasOwn(suites, mode), 'Modo #253 inválido');
  const modes = mode === 'all' ? Object.keys(suites) : [mode];
  const profile = owned.newProfile();
  const errors = [];
  let session, child, interrupted, killTimer;
  const interrupt = () => {
    interrupted = true;
    if (child && !killTimer) {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child?.kill('SIGKILL'), 5000);
    }
  };
  const checkInterrupted = () => assert.ok(!interrupted && !signal?.aborted, 'Suite #253 interrumpida');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  signal?.addEventListener('abort', interrupt, { once: true });

  async function runTest(args) {
    checkInterrupted();
    child = spawn(process.execPath, args, {
      cwd: backend, stdio: 'inherit', windowsHide: true,
      env: {
        ...process.env, NODE_ENV: 'test', TZ: 'UTC', DOTENV_CONFIG_PATH: path.join(backend, 'test/helpers/nonexistent.env'),
        JWT_SECRET: randomUUID(), DB_HOST: profile.host, DB_PORT: String(profile.port), DB_NAME: profile.database,
        DB_USER: 'root', DB_PASSWORD: profile.password, CC253_TEST_PROFILE: JSON.stringify(profile),
      },
    });
    const timeout = setTimeout(interrupt, 240000);
    try {
      const [code, signalName] = await once(child, 'exit');
      checkInterrupted();
      assert.equal(code, 0, 'Suite #253 falló (exit ' + (code ?? signalName) + ')');
    } finally {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      killTimer = undefined;
      child = undefined;
    }
  }

  try {
    checkInterrupted();
    profile.id = docker('run', '--rm', '-d', '--name', profile.container, '--label', owned.label(profile),
      '--tmpfs', '/var/lib/mysql:rw', '-p', profile.host + '::3306', '-e', 'MARIADB_ROOT_PASSWORD=' + profile.password,
      '-e', 'MARIADB_DATABASE=' + profile.database, owned.image);
    const info = owned.inspect(profile.id);
    profile.port = Number(info.NetworkSettings.Ports['3306/tcp']?.[0]?.HostPort);
    owned.validateProfile(profile, info);
    for (let attempt = 0; attempt < 60; attempt++) {
      checkInterrupted();
      try {
        session = await connect(profile);
        break;
      } catch (error) {
        if (error.code === 'ERR_ASSERTION' || error instanceof AggregateError || attempt === 59) throw error;
        await delay(1000);
      }
    }
    checkInterrupted();
    console.log(JSON.stringify({
      mode, database: profile.database, container: profile.container, port: profile.port,
      version: (await session.connection.query('SELECT VERSION() AS version'))[0].version,
    }));
    if (mode === 'cleanup-failure') await runTest(['-e', 'throw Error("DEMO_EXPECTED_FAILURE")']);
    if (!cleanup) {
      const apply = async file => {
        checkInterrupted();
        await owned.assertOwned(session);
        try {
          execute('docker', ['exec', '-i', profile.id, 'mariadb', '-uroot', '-p' + profile.password, profile.database], {
            input: fs.readFileSync(path.resolve(backend, '../database', file)), stdio: 'pipe', windowsHide: true, timeout: 60000,
          });
        } catch (error) {
          throw new Error('SQL ' + file + ': ' + (error.stderr?.toString().trim() || error.message));
        }
      };
      await apply('schema.sql');
      await apply('migrate-fer-20-account-movements.sql');
      await apply('migrate-fer-20-account-movements.sql');
      for (const name of modes) {
        console.log('Suite #253: ' + name);
        // Run each node:test file directly so SIGTERM targets the process owning the connections.
        try { await runTest(['--require', './test/helpers/test-env.cjs', suites[name]]); }
        catch (error) { errors.push(error); }
        if (interrupted) break;
      }
    }
  } catch (error) {
    errors.push(error);
  } finally {
    try { await session?.connection.end(); }
    catch (error) { errors.push(error); }
    try {
      await removeOwnContainer(profile, docker);
      console.log('CLEANUP OK #253: ' + profile.container);
    } catch (error) {
      errors.push(error);
    }
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    signal?.removeEventListener('abort', interrupt);
  }
  if (errors.length) {
    throw new AggregateError(errors.map(error => new Error(error.message.replaceAll(profile.password, '[oculta]'))),
      'Ejecución #253 fallida');
  }
}

if (require.main === module) {
  run(process.argv[2]).catch(error => {
    for (const cause of error.errors ?? [error]) console.error(cause.message);
    process.exitCode = 1;
  });
}
module.exports = { run, removeOwnContainer };
