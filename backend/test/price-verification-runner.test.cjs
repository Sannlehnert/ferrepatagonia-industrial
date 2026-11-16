const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MariaDbContainerError,
  connectToMariaDb,
  publishedPort,
  restartMariaDb,
  updateDatabasePort,
} = require('./helpers/run-price-verification-mariadb.cjs');

const inspect = ({
  port, status = 'running', running = true, exitCode = 0, restartCount = 0, stateError = '',
}) => JSON.stringify([{
  State: { Status: status, Running: running, ExitCode: exitCode, Error: stateError },
  RestartCount: restartCount,
  NetworkSettings: {
    Ports: port ? { '3306/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }] } : {},
  },
}]);

const noWait = async () => undefined;

test('T-S7-05.2: el reinicio reinspecciona el puerto publicado sin recrear contenedor ni base', async () => {
  const calls = [];
  const connections = [];
  const changes = [];
  const docker = (...args) => {
    calls.push(args);
    if (args[0] === 'restart') return '';
    if (args[0] === 'inspect') return inspect({ port: 51002 });
    throw Error(`docker ${args[0]} inesperado`);
  };

  const result = await restartMariaDb({
    docker,
    container: 'price-verification-test-regression',
    database: 'price_verification_test_regression',
    password: 'clave-regresion',
    previousPort: 51001,
    onPortChange: (previous, current) => changes.push([previous, current]),
    connect: async options => {
      connections.push(options);
      return { query: async () => [{ version: '11.4' }] };
    },
    retryDelayMs: 0,
    waitForRetry: noWait,
  });

  assert.deepEqual(calls.map(call => call[0]), ['restart', 'inspect'],
    'Solo debe reiniciar e inspeccionar el contenedor existente');
  assert.equal(calls.some(call => call[0] === 'run' || call[0] === 'rm'), false,
    'No debe recrear ni eliminar el contenedor durante el ensayo');
  assert.deepEqual(changes, [[51001, 51002]], 'Debe informar el cambio de puerto publicado');
  assert.equal(connections.length, 1);
  assert.equal(connections[0].port, 51002, 'Debe reconectar con el puerto obtenido tras el reinicio');
  assert.equal(connections[0].database, 'price_verification_test_regression');
  assert.equal(result.port, 51002);
});

test('T-S7-05.2: reintenta con el puerto vigente si cambia entre intentos', async () => {
  let inspections = 0;
  const connections = [];
  const changes = [];
  const docker = (...args) => {
    if (args[0] !== 'inspect') throw Error(`docker ${args[0]} inesperado`);
    inspections++;
    return inspect({ port: inspections === 1 ? 52001 : 52002 });
  };

  const result = await connectToMariaDb({
    docker,
    container: 'price-verification-test-regression',
    database: 'price_verification_test_regression',
    password: 'clave-regresion',
    previousPort: 52001,
    onPortChange: (previous, current) => changes.push([previous, current]),
    connect: async options => {
      connections.push(options.port);
      if (connections.length === 1) {
        const error = Error('connect ECONNREFUSED 127.0.0.1:52001');
        error.code = 'ECONNREFUSED';
        throw error;
      }
      return { query: async () => [{ version: '11.4' }] };
    },
    retryDelayMs: 0,
    waitForRetry: noWait,
  });

  assert.deepEqual(connections, [52001, 52002]);
  assert.deepEqual(changes, [[52001, 52002]]);
  assert.equal(result.port, 52002);
});

test('T-S7-05.2: agotar reintentos con MariaDB en ejecución distingue un puerto incorrecto', async () => {
  const docker = () => inspect({ port: 53001 });
  await assert.rejects(connectToMariaDb({
    docker,
    container: 'price-verification-test-regression',
    database: 'price_verification_test_regression',
    password: 'clave-secreta-53001',
    connect: async () => {
      const error = Error('connect ECONNREFUSED 127.0.0.1:53001 password=clave-secreta-53001');
      error.code = 'ECONNREFUSED';
      throw error;
    },
    attempts: 3,
    retryDelayMs: 0,
    waitForRetry: noWait,
  }), error => {
    assert.ok(error instanceof MariaDbContainerError);
    assert.equal(error.code, 'MARIADB_PORT_MISMATCH');
    assert.match(error.message, /está en ejecución/);
    assert.match(error.message, /53001/);
    assert.equal(error.diagnostics.publishedPort, 53001);
    assert.equal(error.diagnostics.connectionErrors.length, 3);
    assert.equal(error.diagnostics.connectionErrors.every(item => item.code === 'ECONNREFUSED'), true);
    assert.doesNotMatch(JSON.stringify(error.diagnostics), /clave-secreta-53001/,
      'El diagnóstico no debe exponer la contraseña');
    assert.doesNotMatch(error.message, /clave-secreta-53001/,
      'El mensaje de error no debe exponer la contraseña');
    assert.match(JSON.stringify(error.diagnostics), /\[oculto\]/);
    return true;
  });
});

test('T-S7-05.2: agotar reintentos con el contenedor detenido distingue MariaDB caída', async () => {
  const connections = [];
  const docker = () => inspect({ port: 54001, status: 'exited', running: false, exitCode: 137 });

  await assert.rejects(connectToMariaDb({
    docker,
    container: 'price-verification-test-regression',
    database: 'price_verification_test_regression',
    password: 'clave-regresion',
    connect: async options => {
      connections.push(options.port);
      const error = Error('connect ECONNREFUSED 127.0.0.1:54001');
      error.code = 'ECONNREFUSED';
      throw error;
    },
    attempts: 2,
    retryDelayMs: 0,
    waitForRetry: noWait,
  }), error => {
    assert.ok(error instanceof MariaDbContainerError);
    assert.equal(error.code, 'MARIADB_NOT_RUNNING');
    assert.match(error.message, /no está en ejecución/);
    assert.match(error.message, /exited/);
    assert.match(error.message, /137/);
    assert.equal(error.diagnostics.running, false);
    assert.equal(error.diagnostics.exitCode, 137);
    return true;
  });
  assert.deepEqual(connections, [54001, 54001], 'No debe clasificar como puerto incorrecto una caída real');
});

test('T-S7-05.2: errores de conexión no atribuibles al puerto se reportan aparte', async () => {
  const docker = () => inspect({ port: 55001 });
  await assert.rejects(connectToMariaDb({
    docker,
    container: 'price-verification-test-regression',
    database: 'price_verification_test_regression',
    password: 'clave-regresion',
    connect: async () => {
      const error = Error("Access denied for user 'root'@'127.0.0.1'");
      error.code = 'ER_ACCESS_DENIED_ERROR';
      error.errno = 1045;
      throw error;
    },
    attempts: 2,
    retryDelayMs: 0,
    waitForRetry: noWait,
  }), error => {
    assert.equal(error.code, 'MARIADB_CONNECTION_FAILED');
    assert.match(error.message, /error distinto de puerto/);
    assert.equal(error.diagnostics.connectionErrors.at(-1).code, 'ER_ACCESS_DENIED_ERROR');
    assert.equal(error.diagnostics.connectionErrors.at(-1).errno, 1045);
    return true;
  });
});

test('T-S7-05.2: un fallo de inspección se informa como diagnóstico sanitizado', async () => {
  await assert.rejects(connectToMariaDb({
    docker: () => { throw Error('No such container: price-regression'); },
    container: 'price-regression',
    database: 'price_verification_test_regression',
    password: 'clave-regresion',
    attempts: 2,
    retryDelayMs: 0,
    waitForRetry: noWait,
  }), error => {
    assert.equal(error.code, 'MARIADB_INSPECT_FAILED');
    assert.match(error.message, /no se pudo inspeccionar/);
    assert.match(error.diagnostics.inspectError, /No such container/);
    return true;
  });
});

test('T-S7-05.2: DB_PORT se actualiza con el puerto efectivo y rechaza valores inválidos', () => {
  const env = { DB_HOST: '127.0.0.1', DB_PORT: '50000' };
  assert.equal(updateDatabasePort(env, 56001), env);
  assert.equal(env.DB_PORT, '56001');
  for (const port of [0, -1, 'abc', null, 65536]) {
    assert.throws(() => updateDatabasePort({}, port), /Puerto MariaDB inválido/);
  }
});

test('T-S7-05.2: publishedPort solo acepta un puerto publicado válido', () => {
  assert.equal(publishedPort(JSON.parse(inspect({ port: 57001 }))[0]), 57001);
  assert.equal(publishedPort(JSON.parse(inspect({ port: undefined }))[0]), null);
  assert.equal(publishedPort({ NetworkSettings: { Ports: { '3306/tcp': [{ HostPort: '0' }] } } }), null);
});
