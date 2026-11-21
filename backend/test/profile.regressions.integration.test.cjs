const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
require('./helpers/integration-lifecycle.cjs');
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { once } = require('node:events');
const { createAuthUser } = require('./helpers/auth-user.cjs');
const { pool } = require('../dist/config/catalog-snapshot.config');
const { app } = require('../dist/app');
const { dataSource } = require('../dist/config/database.config');
const { updatePerfilByUsuarioId } = require('../dist/repositories/perfil.repository');
const { lockCartClient } = require('../dist/repositories/cart.repository');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const users = [];
let server;
let base;

const request = (method, cookie, body, raw) => {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (raw !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = raw;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(`${base}/api/perfil`, {
    method,
    headers,
    ...(payload === undefined ? {} : { body: payload }),
  });
};

const stored = async clientId => (await pool.query(
  'SELECT telefono, direccion, activo FROM CLIENTE WHERE id_cliente = ?',
  [clientId],
))[0];

async function client({
  usuarioActivo = 1,
  clienteActivo = 1,
  tipo = 'PARTICULAR',
  telefono = '294 400 0000',
  direccion = 'Calle Base 1',
} = {}) {
  const created = await createAuthUser(pool, 'CLIENTE');
  users.push(created);
  await pool.query(`UPDATE CLIENTE SET tipo_cliente = ?, estado_aprobacion_empresa = ?,
    nombre_razon_social = ?, telefono = ?, direccion = ?, activo = ?
    WHERE id_cliente = ?`, [
    tipo, tipo === 'EMPRESA' ? 'PENDIENTE' : null,
    `Perfil ${created.id}`, telefono, direccion, clienteActivo, created.clientId,
  ]);
  if (usuarioActivo !== 1) {
    await pool.query('UPDATE USUARIO SET activo = ? WHERE id_usuario = ?', [usuarioActivo, created.id]);
  }
  return created;
}

async function waitForLock(pattern, description) {
  // MariaDB 11.4 puede esperar una fila constante durante la optimización,
  // antes de exponerla en INNODB_LOCK_WAITS. PROCESSLIST ya muestra la consulta.
  const deadline = performance.now() + 3000;
  do {
    const rows = await pool.query(`
      SELECT INFO FROM information_schema.PROCESSLIST
      WHERE DB = DATABASE() AND ID <> CONNECTION_ID() AND COMMAND = 'Query'`);
    if (rows.some(row => pattern.test(row.INFO ?? ''))) return;
    await delay(20);
  } while (performance.now() < deadline);
  assert.fail(`MariaDB no mostró una espera real: ${description}`);
}

async function withRowLock(sql, parameters, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(sql, parameters);
    await work(connection);
  } finally {
    try { await connection.rollback(); } finally { connection.release(); }
  }
}

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  for (const user of users) {
    try {
      if (user.clientId != null) await pool.query('DELETE FROM CARRITO WHERE id_cliente = ?', [user.clientId]);
      await user.destroy();
    } catch {}
  }
  await pool.end().catch(() => {});
});

test('H-01: cliente inactivo no puede consultar ni editar su perfil', async () => {
  const user = await client({ clienteActivo: 0, telefono: '294 411 1000' });
  const before = await stored(user.clientId);

  const read = await request('GET', user.cookie);
  assert.notEqual(read.status, 200, 'GET no debe exponer un cliente inactivo');
  assert.equal(read.headers.get('cache-control'), 'private, no-store');

  const edit = await request('PATCH', user.cookie, { telefono: '294 499 9999' });
  assert.notEqual(edit.status, 200, 'PATCH no debe actualizar un cliente inactivo');
  assert.equal(edit.headers.get('cache-control'), 'private, no-store');
  assert.match(edit.headers.get('vary') ?? '', /Cookie/i);

  const after = await stored(user.clientId);
  assert.equal(after.telefono, before.telefono);
  assert.equal(after.direccion, before.direccion);
});

test('H-01 TOCTOU: usuario desactivado después de autenticar no persiste el PATCH', async () => {
  const user = await client({ telefono: '294 411 2000' });
  const before = await stored(user.clientId);

  await withRowLock('UPDATE USUARIO SET activo = 0 WHERE id_usuario = ?', [user.id],
    async connection => {
      const pending = request('PATCH', user.cookie, { telefono: '294 499 9998' });
      await waitForLock(/FOR UPDATE/i, 'PATCH esperando el bloqueo de USUARIO');
      await connection.commit();
      const response = await pending;
      assert.notEqual(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    });

  const after = await stored(user.clientId);
  assert.equal(after.telefono, before.telefono);
  assert.equal(after.direccion, before.direccion);
});

test('H-01 TOCTOU: desactivación concurrente del cliente aborta la escritura', async () => {
  const user = await client({ telefono: '294 411 3000' });
  const before = await stored(user.clientId);

  await withRowLock('UPDATE CLIENTE SET activo = 0 WHERE id_cliente = ?', [user.clientId],
    async connection => {
      const pending = request('PATCH', user.cookie, { telefono: '294 499 9997' });
      await waitForLock(/FOR UPDATE/i, 'PATCH esperando el bloqueo de CLIENTE');
      await connection.commit();
      const response = await pending;
      assert.notEqual(response.status, 200);
    });

  const after = await stored(user.clientId);
  assert.equal(after.activo, 0);
  assert.equal(after.telefono, before.telefono);
  assert.equal(after.direccion, before.direccion);
});

test('H-01: usuario y cliente activos siguen consultando y editando', async () => {
  const user = await client({ telefono: '294 411 4000', direccion: 'Calle Legítima 400' });

  const read = await request('GET', user.cookie);
  assert.equal(read.status, 200);
  assert.equal((await read.json()).data.perfil.telefono, '294 411 4000');

  const edit = await request('PATCH', user.cookie, { telefono: ' 294 455 4444 ' });
  assert.equal(edit.status, 200);
  assert.equal((await edit.json()).data.perfil.telefono, '294 455 4444');
  assert.equal((await stored(user.clientId)).telefono, '294 455 4444');
});

test('H-02: perfil y carrito comparten CLIENTE -> USUARIO sin deadlock AB-BA', async t => {
  const user = await client({ telefono: '294 411 5000' });
  await pool.query('INSERT INTO CARRITO (id_cliente) VALUES (?)', [user.clientId]);

  let paused = false;
  let profileThreadId;
  const armed = Promise.withResolvers();
  const release = Promise.withResolvers();
  const original = dataSource.createQueryRunner.bind(dataSource);

  t.mock.method(dataSource, 'createQueryRunner', (...args) => {
    const runner = original(...args);
    const query = runner.query.bind(runner);
    runner.query = async (sql, parameters, ...rest) => {
      const result = await query(sql, parameters, ...rest);
      if (!paused && typeof sql === 'string' && /FOR UPDATE/i.test(sql)
        && /`(?:USUARIO|CLIENTE)`/.test(sql)) {
        paused = true;
        const [{ id }] = await query('SELECT CONNECTION_ID() AS id');
        profileThreadId = Number(id);
        armed.resolve();
        await release.promise;
      }
      return result;
    };
    return runner;
  });

  const profileOutcome = updatePerfilByUsuarioId(user.id, { telefono: '294 455 5555' })
    .then(() => ({ ok: true }), error => ({
      ok: false,
      code: error?.code ?? error?.driverError?.code,
      errno: error?.errno ?? error?.driverError?.errno,
    }));

  const cartRunner = dataSource.createQueryRunner();
  try {
    await armed.promise;
    assert.ok(profileThreadId, 'La actualización del perfil no alcanzó su primer lock');

    await cartRunner.connect();
    await cartRunner.startTransaction('READ COMMITTED');
    const cartOutcome = lockCartClient(cartRunner.manager, user.id, user.clientId)
      .then(result => ({ ok: result }), error => ({
        ok: false,
        code: error?.code ?? error?.driverError?.code,
        errno: error?.errno ?? error?.driverError?.errno,
      }));

    await waitForLock(/FOR UPDATE/i, 'carrito esperando el segundo lock del perfil');
    release.resolve();

    const [profile, cart] = await Promise.all([profileOutcome, cartOutcome]);
    assert.equal(profile.ok, true,
      `La actualización del perfil falló por concurrencia: ${JSON.stringify(profile)}`);
    assert.equal(cart.ok, true,
      `El flujo de carrito falló por concurrencia: ${JSON.stringify(cart)}`);
    assert.equal((await stored(user.clientId)).telefono, '294 455 5555');
  } finally {
    release.resolve();
    try {
      if (cartRunner.isTransactionActive) await cartRunner.rollbackTransaction();
    } finally {
      await cartRunner.release();
    }
  }
});

test('H-03: errores de parsing de /api/perfil conservan contrato y cabeceras privadas', async () => {
  const user = await client();
  const cases = [
    ['JSON malformado', '{"telefono":'],
    ['JSON primitivo null', 'null'],
    ['JSON primitivo string', '"texto"'],
    ['JSON primitivo número', '123'],
  ];
  for (const [label, raw] of cases) {
    const response = await request('PATCH', user.cookie, undefined, raw);
    assert.equal(response.status, 400, label);
    assert.equal(response.headers.get('cache-control'), 'private, no-store', label);
    assert.match(response.headers.get('vary') ?? '', /Cookie/i, label);
    const body = await response.json();
    assert.equal(typeof body.message, 'string', label);
    assert.ok(!('error' in body), `${label} no debe conservar el contrato heredado`);
    assert.ok(!JSON.stringify(body).includes('at '), `${label} no debe exponer el stack`);
  }

  const array = await request('PATCH', user.cookie, []);
  assert.equal(array.status, 400);
  assert.equal(typeof (await array.json()).message, 'string');
  assert.equal(array.headers.get('cache-control'), 'private, no-store');

  const oversized = await request('PATCH', user.cookie, undefined,
    JSON.stringify({ telefono: 'x'.repeat(110 * 1024) }));
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get('cache-control'), 'private, no-store');
  assert.match(oversized.headers.get('vary') ?? '', /Cookie/i);
  assert.equal(typeof (await oversized.json()).message, 'string');
});

test('H-04: caracteres de control se rechazan y direcciones legítimas se conservan', async () => {
  const user = await client({ telefono: '294 411 6000' });
  const before = await stored(user.clientId);

  for (const body of [
    { telefono: '294\u0000400' },
    { telefono: '294\u0001400' },
    { direccion: 'Calle\u0001123' },
    { direccion: 'Calle\u007f123' },
    { direccion: 'Calle\u0085123' },
  ]) {
    const response = await request('PATCH', user.cookie, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(typeof (await response.json()).message, 'string');
  }
  assert.deepEqual(await stored(user.clientId), before);

  const legitimate = await request('PATCH', user.cookie, {
    direccion: 'Av. San Martín 123, Piso 4° B — Unidad 2/3',
  });
  assert.equal(legitimate.status, 200);
  assert.equal((await legitimate.json()).data.perfil.direccion,
    'Av. San Martín 123, Piso 4° B — Unidad 2/3');
});
