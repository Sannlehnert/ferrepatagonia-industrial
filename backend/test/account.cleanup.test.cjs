const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const { docker, connectOwned, newProfile } = require('./helpers/account-disposable.cjs');
const { run, removeOwnContainer } = require('./helpers/run-account-mariadb.cjs');

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

async function expectCleanFailure(mode, reason, faults) {
  let name;
  const trace = (...args) => {
    if (args[0] === 'run') name = args[args.indexOf('--name') + 1];
    return faults.docker ? faults.docker(...args) : docker(...args);
  };
  await assert.rejects(run(mode, { ...faults, docker: trace }),
    error => error instanceof AggregateError && error.errors.some(cause => reason.test(cause.message)));
  assert.match(name, /^account-test-[a-f0-9]{32}$/);
  assert.equal(docker('ps', '-aq', '--filter', 'name=^/' + name + '$'), '');
}

test('recupera por nombre y propiedad tras perder la respuesta de docker run', async () => {
  await expectCleanFailure('cleanup-success', /DEMO_LOST_RUN_RESPONSE/, {
    docker: (...args) => {
      const result = docker(...args);
      if (args[0] === 'run') throw Error('DEMO_LOST_RUN_RESPONSE');
      return result;
    },
  });
});

for (const [file, call] of [['schema.sql', 1], ['migrate-fer-20-account-movements.sql', 2]]) {
  test('limpia ante error SQL durante ' + file, async () => {
    let calls = 0;
    await expectCleanFailure('persistence', new RegExp('SQL ' + file), {
      execute: (bin, args, options) => execFileSync(bin, args,
        ++calls === call ? { ...options, input: 'SELECT * FROM DEMO_TABLA_INEXISTENTE;' } : options),
    });
  });
}

test('limpia aunque falle connection.end', async () => {
  await expectCleanFailure('cleanup-success', /DEMO_CLOSE_FAILURE/, {
    connect: async profile => {
      const session = await connectOwned(profile);
      const end = session.connection.end.bind(session.connection);
      session.connection.end = async () => {
        await end();
        throw Error('DEMO_CLOSE_FAILURE');
      };
      return session;
    },
  });
});

test('interrupción controlada conserva limpieza', async () => {
  const controller = new AbortController();
  await expectCleanFailure('cleanup-success', /interrumpida/, {
    signal: controller.signal,
    connect: async profile => {
      const session = await connectOwned(profile);
      controller.abort();
      return session;
    },
  });
});

test('un perfil distinto no puede eliminar el contenedor descartable real', async () => {
  await run('cleanup-success', {
    connect: async profile => {
      const session = await connectOwned(profile);
      try {
        await assert.rejects(removeOwnContainer({ ...newProfile(), id: profile.id }), /no pertenece/);
        assert.equal(docker('ps', '-aq', '--no-trunc', '--filter', 'id=' + profile.id), profile.id);
        return session;
      } catch (error) {
        await session.connection.end();
        throw error;
      }
    },
  });
});
