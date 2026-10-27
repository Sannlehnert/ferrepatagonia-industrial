const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');

test('limpia el contenedor si se pierde la confirmación de docker run', () => {
  const runner = require.resolve('./helpers/run-e2e.cjs');

  // En un proceso separado, ejecutar Docker realmente y luego simular
  // que el comando falla antes de devolver su confirmación al ejecutor.
  const script = `
    const childProcess = require('node:child_process');
    const original = childProcess.execFileSync;

    childProcess.execFileSync = function (command, args, options) {
      if (command === 'docker' && args[0] === 'run') {
        const name = args[args.indexOf('--name') + 1];
        console.log('TEST_CONTAINER=' + name);

        original(command, args, options);

        console.log('TEST_CONTAINER_CREATED');
        throw new Error('E2E_TEST_LOST_DOCKER_CONFIRMATION');
      }

      return original(command, args, options);
    };

    require(${JSON.stringify(runner)});
  `;

  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: 240_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const match = stdout.match(
    /^TEST_CONTAINER=(ferrepatagonia-e2e-[a-f0-9]{32})\r?$/m,
  );

  assert.ok(match, 'El proceso debe identificar su contenedor exclusivo');
  const container = match[1];

  const docker = (...args) => execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  }).trim();

  const findContainer = () => docker(
    'ps', '-a',
    '--filter', `name=^/${container}$`,
    '--format', '{{.Names}}',
  );

  try {
    assert.ifError(result.error);
    assert.equal(result.status, 1, 'El fallo debe devolver código 1');
    assert.match(stdout, /TEST_CONTAINER_CREATED/);
    assert.match(stderr, /E2E_TEST_LOST_DOCKER_CONFIRMATION/);
    assert.match(
      stdout,
      /Limpieza E2E confirmada: no queda el contenedor de esta ejecución\./,
    );
    assert.equal(findContainer(), '', 'El ejecutor dejó un contenedor');
  } finally {
    // Respaldo de la prueba: si hay una regresión, falla la comprobación
    // anterior, pero igualmente retiramos su contenedor exclusivo.
    if (findContainer() === container) {
      docker('rm', '-f', container);
    }
  }
});