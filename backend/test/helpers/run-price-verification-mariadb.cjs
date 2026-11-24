const { assertSchemaInventory } = require('./schema-inventory.cjs');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mariadb = require('mariadb');
const assert = require('node:assert/strict');
const { withTestSignals, runTestProcess } = require('./disposable-test-process.cjs');
const backend = path.resolve(__dirname, '../..');
const token = randomUUID().replaceAll('-', '');
const database = `price_verification_test_${token}`;
const container = `price-verification-test-${token}`;
const password = randomUUID();
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 180000 }).trim();

const CONTAINER_PORT_KEY = '3306/tcp';
const DEFAULT_ATTEMPTS = 60;
const RETRY_DELAY_MS = 1000;
const PORT_CONNECTION_ERRORS = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH']);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class MariaDbContainerError extends Error {
  constructor(code, message, diagnostics) {
    super(message);
    this.name = 'MariaDbContainerError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

function sanitize(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets) {
    if (secret) text = text.split(String(secret)).join('[oculto]');
  }
  return text;
}

function sanitizeDiagnostics(diagnostics, secrets = []) {
  return JSON.parse(sanitize(JSON.stringify(diagnostics), secrets));
}

function inspectContainer(dockerClient, name) {
  const [info] = JSON.parse(dockerClient('inspect', '--type', 'container', name));
  if (!info) throw Error('docker inspect no devolvió información del contenedor');
  return info;
}

function publishedPort(info) {
  const binding = info?.NetworkSettings?.Ports?.[CONTAINER_PORT_KEY]?.[0];
  const port = Number(binding?.HostPort);
  return Number.isInteger(port) && port > 0 ? port : null;
}

function containerDiagnostics(info, name) {
  return {
    container: name,
    status: info?.State?.Status ?? null,
    running: info?.State?.Running === true,
    exitCode: Number.isInteger(info?.State?.ExitCode) ? info.State.ExitCode : null,
    stateError: info?.State?.Error || null,
    restartCount: Number.isInteger(info?.RestartCount) ? info.RestartCount : null,
    publishedPort: publishedPort(info),
  };
}

function connectionErrorSummary(error, attempt, port, secrets) {
  const cause = error?.cause ?? error?.errors?.[0] ?? error;
  return {
    attempt,
    port,
    code: cause?.code ?? error?.code ?? null,
    errno: cause?.errno ?? error?.errno ?? null,
    sqlState: cause?.sqlState ?? error?.sqlState ?? null,
    message: sanitize(cause?.message ?? error, secrets).slice(0, 500),
  };
}

function connectionFailure({ action, container: name, attempts, info, inspectError, lastPort, errors, secrets }) {
  const diagnostics = sanitizeDiagnostics({
    ...containerDiagnostics(info, name),
    action,
    attempts,
    lastPort: lastPort ?? null,
    connectionErrors: errors,
    inspectError: inspectError ? inspectError.message ?? inspectError : null,
  }, secrets);
  const help = `Diagnóstico: ${JSON.stringify(diagnostics)}`;

  if (inspectError && !info) {
    return new MariaDbContainerError('MARIADB_INSPECT_FAILED',
      `${action}: no se pudo inspeccionar el contenedor ${name} tras ${attempts} intentos. ${help}`,
      diagnostics);
  }
  if (info?.State?.Running !== true || info?.State?.Status !== 'running') {
    return new MariaDbContainerError('MARIADB_NOT_RUNNING',
      `${action}: MariaDB no está en ejecución (estado: ${diagnostics.status ?? 'desconocido'}, `
      + `exitCode: ${diagnostics.exitCode ?? 'desconocido'}). ${help}`,
      diagnostics);
  }
  if (!lastPort) {
    return new MariaDbContainerError('MARIADB_PORT_UNAVAILABLE',
      `${action}: MariaDB está en ejecución pero Docker no publicó un puerto válido para `
      + `${CONTAINER_PORT_KEY}. ${help}`,
      diagnostics);
  }

  const lastCode = errors.at(-1)?.code;
  if (PORT_CONNECTION_ERRORS.has(lastCode)) {
    return new MariaDbContainerError('MARIADB_PORT_MISMATCH',
      `${action}: MariaDB está en ejecución pero 127.0.0.1:${lastPort} no acepta conexiones tras `
      + `${attempts} intentos; el puerto publicado puede haber cambiado o no ser accesible `
      + `(${lastCode}). ${help}`,
      diagnostics);
  }
  return new MariaDbContainerError('MARIADB_CONNECTION_FAILED',
    `${action}: MariaDB está en ejecución pero la conexión en 127.0.0.1:${lastPort} falló tras `
    + `${attempts} intentos con un error distinto de puerto (${lastCode ?? 'sin código'}). ${help}`,
    diagnostics);
}

async function connectToMariaDb({
  docker: dockerClient = docker,
  container: name = container,
  database: databaseName = database,
  password: secret = password,
  connect = mariadb.createConnection,
  attempts = DEFAULT_ATTEMPTS,
  retryDelayMs = RETRY_DELAY_MS,
  waitForRetry = delay,
  previousPort,
  onPortChange,
  action = 'conexión con MariaDB',
  signal,
} = {}) {
  const secrets = [secret];
  const errors = [];
  let info;
  let inspectError;
  let lastPort;
  let announcedPort = previousPort;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    signal?.throwIfAborted();
    info = undefined;
    inspectError = undefined;
    try {
      info = inspectContainer(dockerClient, name);
    } catch (error) {
      inspectError = error;
    }

    const port = publishedPort(info);
    if (port) {
      if (announcedPort !== undefined && port !== announcedPort) {
        onPortChange?.(announcedPort, port);
      }
      announcedPort = port;
      lastPort = port;
      try {
        const connection = await connect({
          host: '127.0.0.1',
          port,
          user: 'root',
          password: secret,
          database: databaseName,
          connectTimeout: 1000,
        });
        return { connection, port, info };
      } catch (error) {
        errors.push(connectionErrorSummary(error, attempt, port, secrets));
        if (errors.length > 10) errors.shift();
      }
    }

    if (attempt < attempts) await waitForRetry(retryDelayMs);
  }

  throw connectionFailure({
    action, container: name, attempts, info, inspectError, lastPort, errors, secrets,
  });
}

async function restartMariaDb(options = {}) {
  const dockerClient = options.docker ?? docker;
  const name = options.container ?? container;
  dockerClient('restart', name);
  return connectToMariaDb({ ...options, docker: dockerClient, container: name });
}

function updateDatabasePort(env, port) {
  const value = Number(port);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw Error(`Puerto MariaDB inválido para DB_PORT: ${String(port)}`);
  }
  env.DB_PORT = String(value);
  return env;
}

async function main(signal) {
  let started = false;
  let connection;
  try {
    docker('run', '--rm', '-d', '--name', container, '-p', '127.0.0.1::3306',
      '-e', `MARIADB_ROOT_PASSWORD=${password}`, '-e', `MARIADB_DATABASE=${database}`, 'mariadb:11.4');
    started = true;
    const initial = await connectToMariaDb({ action: 'inicio de MariaDB desechable', signal });
    connection = initial.connection;
    let port = initial.port;

    const apply = file => execFileSync(
      'docker',
      ['exec', '-i', container, 'mariadb', '--protocol=socket', '--skip-ssl', '-uroot', `-p${password}`, database],
      { input: fs.readFileSync(path.join(backend, '../database', file)), stdio: 'pipe', timeout: 60000 },
    );

    apply('schema.sql');
    apply('migrate-fer-20-account-movements.sql');
    apply('migrate-fer-17-pricing-evidence.sql');
    apply('migrate-fer-17-price-verification.sql');
    apply('migrate-fer-17-price-verification.sql');
    apply('migrate-s7-04-2-state-consistency.sql');
    apply('migrate-s7-04-2-state-consistency.sql');

    const inventory = await assertSchemaInventory(sql => connection.query(sql), 'complete');

    // Credencial separada de mínimo privilegio para la verificación administrativa.
    // El usuario principal del backend no se usa para escribir evidencia en este flujo.
    const verifierUser = `price_verifier_${token.slice(0, 12)}`;
    const verifierPassword = randomUUID();
    await connection.query(`CREATE USER '${verifierUser}'@'%' IDENTIFIED BY '${verifierPassword}'`);
    await connection.query(`GRANT SELECT ON ${database}.PRODUCTO TO '${verifierUser}'@'%'`);
    await connection.query(`GRANT SELECT ON ${database}.USUARIO TO '${verifierUser}'@'%'`);
    await connection.query(`GRANT SELECT, INSERT, UPDATE ON ${database}.PRECIO_USD_EVIDENCIA TO '${verifierUser}'@'%'`);
    await connection.query(`GRANT SELECT, INSERT ON ${database}.FER17_PRECIO_EVENTO TO '${verifierUser}'@'%'`);
    await connection.query(`GRANT SELECT ON ${database}.FER17_AUDITORIA_TRIGGERS TO '${verifierUser}'@'%'`);

    console.log(JSON.stringify({
      database, container, port,
      version: (await connection.query('SELECT VERSION() AS version'))[0].version,
      ...inventory,
    }));

    const env = {
      ...process.env,
      DOTENV_CONFIG_PATH: path.join(backend, 'test/helpers/nonexistent.env'),
      JWT_SECRET: randomUUID(),
      DB_HOST: '127.0.0.1', DB_NAME: database,
      DB_USER: 'root', DB_PASSWORD: password,
      PRICE_VERIFICATION_DB_USER: verifierUser,
      PRICE_VERIFICATION_DB_PASSWORD: verifierPassword,
      PRICE_VERIFICATION_TEST_DATABASE: database,
      PRICE_VERIFICATION_RUN_ID: token,
    };
    updateDatabasePort(env, port);
    const runSuite = file => runTestProcess(
      ['--require', './test/helpers/test-env.cjs', '--test', '--test-concurrency=1', file],
      { cwd: backend, env }, signal,
    );
    if (await runSuite('test/price-verification.mariadb.test.cjs') !== 0) {
      throw Error('La suite principal de verificación de precios falló');
    }

    // Reapply over historical data, not just over the empty schema.
    const evidenceSql = 'SELECT * FROM PRECIO_USD_EVIDENCIA ORDER BY id_producto';
    const eventSql = 'SELECT * FROM FER17_PRECIO_EVENTO ORDER BY id_evento';
    const [evidence, events] = await Promise.all([connection.query(evidenceSql), connection.query(eventSql)]);
    assert.ok(evidence.length > 0 && events.length > 0);
    apply('migrate-fer-17-price-verification.sql');
    assert.deepEqual(await connection.query(evidenceSql), evidence);
    assert.deepEqual(await connection.query(eventSql), events);
    console.log('Migración FER-17 reaplicada con evidencia y eventos históricos intactos.');

    // Requirement: evidence and audit survive a MariaDB restart.
    await connection.end().catch(() => undefined);
    connection = undefined;
    const restarted = await restartMariaDb({
      signal,
      previousPort: port,
      action: 'reinicio de MariaDB',
      onPortChange: (previous, current) => {
        console.log(`T-S7-05.2: Docker reasignó el puerto publicado de MariaDB ${previous} → ${current}.`);
      },
    });
    connection = restarted.connection;
    port = restarted.port;
    // The restart suite must reconnect through the port published after the restart.
    updateDatabasePort(env, port);

    if (await runSuite('test/price-verification.restart.test.cjs') !== 0) {
      throw Error('La verificación de persistencia tras reinicio falló');
    }
    console.log('T-S7-05.2: evidencia, auditoría y FER17 conservados tras reiniciar MariaDB.');
  } finally {
    try { if (connection) await connection.end(); }
    finally { if (started) docker('rm', '-f', '-v', container); }
  }
}

if (require.main === module) {
  withTestSignals(main).catch(error => {
    console.error(sanitize(error.stderr?.toString?.().trim() || error.message, [password]));
    if (error.diagnostics) {
      console.error('Diagnóstico:', JSON.stringify(sanitizeDiagnostics(error.diagnostics, [password]), null, 2));
    }
    process.exitCode ||= 1;
  });
}

module.exports = {
  CONTAINER_PORT_KEY,
  DEFAULT_ATTEMPTS,
  MariaDbContainerError,
  connectToMariaDb,
  containerDiagnostics,
  inspectContainer,
  publishedPort,
  restartMariaDb,
  sanitize,
  sanitizeDiagnostics,
  updateDatabasePort,
};
