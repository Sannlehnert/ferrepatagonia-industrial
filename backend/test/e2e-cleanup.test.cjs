const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');

for (const failure of ['run-confirmation', 'inspect', 'connection', 'sql', 'end', 'interrupt']) {
  test(`elimina contenedor y volúmenes ante fallo de ${failure}`, () => {
    const runner = require.resolve('./helpers/run-e2e.cjs');
    const script = `
      const cp = require('node:child_process');
      const original = cp.execFileSync;
      let injected = false;
      cp.execFileSync = function(command, args, options) {
        const result = original(command, args, options);
        if (command === 'docker' && args[0] === 'run') {
          const name = args[args.indexOf('--name') + 1];
          const info = JSON.parse(original('docker', ['inspect', name], {encoding:'utf8'}))[0];
          console.log('TEST_RESOURCE=' + JSON.stringify({name,
            volumes: info.Mounts.filter(m => m.Type === 'volume').map(m => m.Name)}));
          if (${JSON.stringify(failure)} === 'run-confirmation') throw Error('TEST_LOST_CONFIRMATION');
          if (${JSON.stringify(failure)} === 'interrupt') process.emit('SIGTERM');
        }
        if (command === 'docker' && args[0] === 'inspect' &&
            ${JSON.stringify(failure)} === 'inspect' && !injected) {
          injected = true;
          throw Error('TEST_INSPECT_FAILURE');
        }
        return result;
      };
      const stage = ${JSON.stringify(failure)};
      const modulePath = require.resolve('mariadb', { paths: [require('node:path').dirname(${JSON.stringify(runner)})] });
      const mariadb = require(modulePath);
      const create = mariadb.createConnection;
      if (stage === 'connection' || stage === 'end') {
        require.cache[modulePath].exports = { ...mariadb, createConnection: async (...args) => {
          if (stage === 'connection') require('node:assert/strict').fail('TEST_CONNECTION_FAILURE');
          const connection = await create(...args);
          const end = connection.end.bind(connection);
          connection.end = async () => { await end(); throw Error('TEST_END_FAILURE'); };
          return connection;
        } };
      }
      if (stage === 'sql') {
        const invoke = cp.execFileSync;
        cp.execFileSync = (command, args, options) => invoke(command, args,
          command === 'docker' && args[0] === 'exec' ? { ...options, input: 'SELEC 1;' } : options);
      }
      require(${JSON.stringify(runner)});
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8', timeout: 240_000, windowsHide: true, maxBuffer: 1024 * 1024,
    });
    const match = (result.stdout || '').match(/^TEST_RESOURCE=(.+)\r?$/m);
    assert.ok(match, 'Debe identificar los recursos reales creados');
    const resource = JSON.parse(match[1]);
    assert.match(resource.name, /^ferrepatagonia-e2e-[a-f0-9]{32}$/);
    const docker = (...args) => execFileSync('docker', args, {
      encoding: 'utf8', timeout: 30_000, windowsHide: true,
    }).trim();
    const find = () => docker('ps', '-a', '--filter',
      `name=^/${resource.name}$`, '--format', '{{.Names}}');
    const volumes = () => docker('volume', 'ls', '--format', '{{.Name}}').split(/\r?\n/);
    try {
      assert.ifError(result.error);
      assert.equal(result.status, 1, 'Conservar el fallo original');
      const expected = {
        inspect: /TEST_INSPECT_FAILURE/, 'run-confirmation': /TEST_LOST_CONFIRMATION/,
        connection: /TEST_CONNECTION_FAILURE/, end: /TEST_END_FAILURE/,
        sql: /Command failed.*mariadb/s, interrupt: /Ejecución interrumpida/,
      };
      assert.match(result.stderr, expected[failure]);
      assert.match(result.stdout, /Limpieza E2E confirmada/);
      assert.deepEqual(resource.volumes, [], 'La base debe usar tmpfs');
      assert.equal(find(), '');
      for (const volume of resource.volumes) {
        assert.ok(!volumes().includes(volume), 'El runner dejó un volumen anónimo');
      }
    } finally {
      if (find() === resource.name) docker('rm', '-f', '-v', resource.name);
      for (const volume of resource.volumes) {
        if (volumes().includes(volume)) docker('volume', 'rm', volume);
      }
    }
  });
}
