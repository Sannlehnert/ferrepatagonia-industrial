const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { test, before, after } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');

const {
  childProfile,
  connectOwned,
  assertOwned,
} = require('./helpers/cc260-disposable.cjs');

const {
  createOrderFixture,
} = require('./helpers/account-order.fixture.cjs');

const {
  fetchFromBrowser,
} = require('./helpers/browser-request.cjs');

let session;
let database;
let server;
let base;
let signToken;

before(async () => {
  session = await connectOwned(childProfile());
  await assertOwned(session);

  database = require('../dist/config/database.config.js');
  await database.initializeDatabase();

  ({ signToken } = require('../dist/services/token.service.js'));
  const { app } = require('../dist/app.js');

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  base = `http://127.0.0.1:${server.address().port}`;
  base += '/api/pedidos/cuenta-corriente';
});

after(async () => {
  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeIdleConnections();
      });
    }
  } finally {
    try {
      await database?.destroyDatabase();
    } finally {
      await session?.connection.end();
    }
  }
});

function request({
  method = 'GET',
  path = '',
  auth,
  key,
  body,
  headers = {},
}) {
  const requestHeaders = { ...headers };

  if (auth) {
    requestHeaders.Cookie = `jwt_token=${signToken(auth)}`;
  }

  if (key !== undefined) {
    requestHeaders['Idempotency-Key'] = key;
  }

  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  return fetchFromBrowser(`${base}${path}`, {
    method,
    headers: requestHeaders,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
}

async function responseBody(response, expectedStatus) {
  assert.equal(response.status, expectedStatus);
  assert.equal(
    response.headers.get('cache-control'),
    'private, no-store',
  );

  const vary = response.headers.get('vary') ?? '';
  assert.ok(
    vary.split(',').some(value => value.trim().toLowerCase() === 'cookie'),
    'La respuesta debe variar según la cookie de sesión',
  );

  const body = await response.json();

  if (expectedStatus >= 400) {
    assert.equal(typeof body.code, 'string');
    assert.ok(body.code.length > 0);
    assert.equal(typeof body.message, 'string');
    assert.ok(body.message.length > 0);
  }

  return body;
}

async function countForClient(table, clientId) {
  assert.ok(['PEDIDO', 'CONFIRMACION_PEDIDO_CC'].includes(table));

  const [row] = await session.connection.query(
    `SELECT COUNT(*) cantidad FROM ${table} WHERE id_cliente = ?`,
    [clientId],
  );

  return Number(row.cantidad);
}

async function quoteFor(auth) {
  const body = await responseBody(await request({ path: '/eligibilidad', auth }), 200);
  assert.equal(typeof body.data.cotizacion, 'string');
  return body.data.cotizacion;
}

function confirm(f, key, cotizacion, headers) {
  return request({ method: 'POST', auth: f.auth, key, body: { cotizacion }, headers });
}

async function account(f, suffix = '') {
  const url = new URL('/api/cuenta-corriente' + suffix, base);
  const response = await fetchFromBrowser(url, {
    headers: { Cookie: `jwt_token=${signToken(f.auth)}` },
    signal: AbortSignal.timeout(15000),
  });
  return (await responseBody(response, 200)).data;
}

async function commercialState(f) {
  const db = session.connection;
  return {
    orders: await db.query(`
      SELECT id_pedido, estado, total, moneda_total FROM PEDIDO
      WHERE id_cliente = ? ORDER BY id_pedido
    `, [f.clientId]),
    movements: await db.query(`
      SELECT CAST(id_movimiento_cuenta AS CHAR) AS id, id_pedido, tipo_movimiento,
             estado, monto, moneda, plazo_aplicado, fecha_base_civil, fecha_efectiva, vence_el
      FROM MOVIMIENTO_CUENTA_CORRIENTE
      WHERE id_cuenta_corriente = ? ORDER BY id_movimiento_cuenta
    `, [f.accountId]),
    items: await db.query(`
      SELECT id_producto, cantidad FROM ITEM_CARRITO
      WHERE id_carrito = ? ORDER BY id_producto
    `, [f.cartId]),
    stock: (await db.query('SELECT stock FROM PRODUCTO WHERE id_producto = ?', [f.productId]))[0].stock,
    revision: (await db.query(
      'SELECT CAST(revision AS CHAR) AS revision FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?',
      [f.accountId],
    ))[0].revision,
  };
}

test('#286: el checkout normal rechaza evidencia académica aunque el cliente solicite ese modo', async () => {
  const f = await createOrderFixture(session);
  const cotizacion = await quoteFor(f.auth);
  await session.connection.query(
    'UPDATE PRECIO_USD_EVIDENCIA SET sintetica = 1, evidencia = ? WHERE id_producto = ?',
    [`SINTETICO ACADEMICO #286 SHA256:${'a'.repeat(64)}`, f.productId],
  );
  const initial = await commercialState(f);
  const headers = { 'X-Academic-Checkout': 'true' };
  const eligibility = await responseBody(await request({ path: '/eligibilidad', auth: f.auth, headers }), 200);
  assert.equal(eligibility.data.elegible, false);
  assert.equal(eligibility.data.codigo, 'PRECIO_SINTETICO');
  assert.equal(eligibility.data.cotizacion, null);
  assert.equal(eligibility.data.simulado, undefined);
  const rejected = await responseBody(await confirm(f, randomUUID(), cotizacion, headers), 422);
  assert.equal(rejected.code, 'PRECIO_SINTETICO');
  assert.deepEqual(await commercialState(f), initial);
});

async function assertCredit(f, saldo, disponible) {
  const summary = await account(f);
  assert.equal(summary.saldo, saldo);
  assert.equal(summary.disponible, disponible);
  return summary;
}

async function stageCharge(f, monto) {
  const { insertId } = await session.connection.query(`
    INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento,
                        total, moneda_total, evidencia_total_usd)
    VALUES (?, 'CONFIRMADO', 'CUENTA_CORRIENTE', ?, 0, ?, 'USD', 'Fixture #263')
  `, [f.clientId, monto, monto]);
  const { registrarCargoPorPedido } = require('../dist/repositories/cuentaCorriente.repository.js');
  return manager => registrarCargoPorPedido({
    id_cuenta_corriente: f.accountId,
    id_pedido: Number(insertId),
    monto,
    moneda: 'USD',
  }, manager);
}

async function waitFor(check, message, interval = 10) {
  const deadline = performance.now() + 1500;
  do {
    if (await check()) return;
    await delay(interval);
  } while (performance.now() < deadline);
  assert.fail(message);
}

async function waitForLock(blocker, count = 1) {
  await waitFor(async () => {
    const [row] = await session.connection.query(`
      SELECT COUNT(DISTINCT w.requesting_trx_id) AS waiting
      FROM information_schema.INNODB_LOCK_WAITS w
      JOIN information_schema.INNODB_TRX t ON t.trx_id = w.blocking_trx_id
      WHERE t.trx_mysql_thread_id = ?
    `, [blocker]);
    return Number(row.waiting) === count;
  // InnoDB conserva una vista temporal de estas tablas entre consultas.
  }, `MariaDB no mostró ${count} transacciones esperando a la sesión ${blocker}`, 125);
}

async function whileHoldingTransaction(work) {
  const runner = database.dataSource.createQueryRunner();
  const requests = [];
  const track = promise => {
    requests.push(promise);
    promise.catch(() => {});
    return promise;
  };
  await runner.connect();
  try {
    await runner.startTransaction('READ COMMITTED');
    const [{ id }] = await runner.query('SELECT CONNECTION_ID() AS id');
    await work(runner, id, track);
  } finally {
    try {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
    } finally {
      try {
        await runner.release();
      } finally {
        await Promise.allSettled(requests);
      }
    }
  }
}

test('#263 A07/A08 HTTP: visitante, JWT inválido y ADMIN no operan pedidos', async () => {
  const f = await createOrderFixture(session);
  const before = await commercialState(f);
  const cotizacion = await quoteFor(f.auth);
  const key = randomUUID();

  const actors = [
    { input: {}, status: 401, code: 'NO_AUTENTICADO' },
    { input: { headers: { Cookie: 'jwt_token=token.invalido.firma' } },
      status: 401, code: 'NO_AUTENTICADO' },
    { input: { auth: { id: f.adminId, rol: 'ADMIN' } }, status: 403, code: 'NO_AUTORIZADO' },
  ];

  for (const { input, status, code } of actors) {
    const rejected = await responseBody(await request({
      method: 'POST',
      ...input,
      key,
      body: { cotizacion },
    }), status);

    const lookup = await responseBody(await request({
      path: `/${key}`,
      ...input,
    }), status);
    assert.deepEqual(rejected, { code, message: rejected.message });
    assert.deepEqual(lookup, rejected);
    assert.deepEqual(await commercialState(f), before);
  }

  assert.equal(await countForClient('PEDIDO', f.clientId), 0);
  assert.equal(
    await countForClient('CONFIRMACION_PEDIDO_CC', f.clientId),
    0,
  );
});

for (const [label, sql, fixtureId, status, code, persisted] of [
  ['A02 empresa pendiente', "UPDATE CLIENTE SET estado_aprobacion_empresa = 'PENDIENTE' WHERE id_cliente = ?",
    'clientId', 403, 'EMPRESA_NO_HABILITADA', true],
  ['A03 empresa rechazada', "UPDATE CLIENTE SET estado_aprobacion_empresa = 'RECHAZADA' WHERE id_cliente = ?",
    'clientId', 403, 'EMPRESA_NO_HABILITADA', true],
  ['A04 cuenta deshabilitada', 'UPDATE CUENTA_CORRIENTE SET habilitada = 0 WHERE id_cuenta_corriente = ?',
    'accountId', 403, 'CUENTA_NO_HABILITADA', true],
  ['A05 cliente inactivo', 'UPDATE CLIENTE SET activo = 0 WHERE id_cliente = ?',
    'clientId', 403, 'CLIENTE_NO_HABILITADO', false],
  ['A06 usuario inactivo', 'UPDATE USUARIO SET activo = 0 WHERE id_usuario = ?',
    'userId', 401, 'NO_AUTENTICADO', false],
  ['A10 saldo desconocido', "UPDATE CUENTA_CORRIENTE SET cobertura = 'NO_ACREDITADA' WHERE id_cuenta_corriente = ?",
    'accountId', 422, 'CREDITO_NO_VERIFICADO', true],
]) {
  test(`#263 ${label}: POST firmado sin escrituras comerciales`, async () => {
    const f = await createOrderFixture(session);
    const cotizacion = await quoteFor(f.auth);
    await session.connection.query(sql, [f[fixtureId]]);
    const before = await commercialState(f);

    const result = await responseBody(await confirm(f, randomUUID(), cotizacion), status);
    assert.deepEqual(result, { code, message: result.message, ...(persisted && { estado: 'RECHAZADO' }) });
    assert.deepEqual(await commercialState(f), before);
    assert.equal(await countForClient('CONFIRMACION_PEDIDO_CC', f.clientId), Number(persisted));
  });
}

test('#262 HTTP: la prevalidación requiere cliente y no admite cuerpo ni consulta', async () => {
  const f = await createOrderFixture(session);

  await responseBody(await request({
    path: '/eligibilidad',
  }), 401);
  await responseBody(await request({
    path: '/eligibilidad',
    auth: { id: f.adminId, rol: 'ADMIN' },
  }), 403);
  await responseBody(await request({
    path: '/eligibilidad?cliente=1',
    auth: f.auth,
  }), 400);

  const result = await responseBody(await request({
    path: '/eligibilidad',
    auth: f.auth,
  }), 200);
  assert.deepEqual({ ...result.data, cotizacion: '<signed>' }, {
    elegible: true,
    moneda: 'USD',
    totalUSD: '20.00',
    creditoDisponibleUSD: '1000.00',
    codigo: null,
    mensaje: null,
    cotizacion: '<signed>',
  });
  assert.equal(await countForClient('PEDIDO', f.clientId), 0);
  assert.equal(
    await countForClient('CONFIRMACION_PEDIDO_CC', f.clientId),
    0,
  );
});

test('#261 HTTP: rechaza solicitudes inválidas antes de reservar el intento', async () => {
  const f = await createOrderFixture(session);
  const key = randomUUID();

  const cases = [
    { body: { cotizacion: 'a'.repeat(40) } },
    { key: 'clave-invalida', body: { cotizacion: 'a'.repeat(40) } },
    { key },
    { key, body: [] },
    { key, body: { id_cliente: f.clientId } },
    { key, body: { totalUSD: '0.01' } },
    { key, body: { cotizacion: 'a'.repeat(40) }, path: '?cliente=1' },
  ];

  for (const input of cases) {
    await responseBody(await request({
      method: 'POST',
      auth: f.auth,
      ...input,
    }), 400);
  }

  await responseBody(await request({
    path: '/clave-invalida',
    auth: f.auth,
  }), 400);

  assert.equal(await countForClient('PEDIDO', f.clientId), 0);
  assert.equal(
    await countForClient('CONFIRMACION_PEDIDO_CC', f.clientId),
    0,
  );
});

test('#263 C01/A01/P01–P07 HTTP/SQL: acredita cargo, histórico, saldo, vencimiento y revisión', async () => {
  const f = await createOrderFixture(session);
  const openingCharge = await stageCharge(f, '5.00');
  await database.inTransaction(openingCharge);
  const before = await commercialState(f);
  const originalSummary = await assertCredit(f, '5.00', '995.00');
  const key = randomUUID();
  const cotizacion = await quoteFor(f.auth);

  const first = await responseBody(await request({
    method: 'POST',
    auth: f.auth,
    key,
    body: { cotizacion },
  }), 201);

  assert.equal(first.data.estado, 'CONFIRMADO');
  assert.equal(first.data.moneda, 'USD');
  assert.equal(first.data.totalUSD, '20.00');
  const confirmed = await commercialState(f);
  assert.deepEqual(confirmed.orders, [
    ...before.orders,
    { id_pedido: first.data.pedidoId, estado: 'CONFIRMADO', total: '20.00', moneda_total: 'USD' },
  ]);
  assert.equal(confirmed.movements.length, 2);
  assert.deepEqual(confirmed.movements[0], before.movements[0]);
  const { fecha_base_civil, fecha_efectiva, ...charge } = confirmed.movements[1];
  const [dates] = await session.connection.query(`
    SELECT DATE(DATE_SUB(CAST(? AS DATETIME), INTERVAL 3 HOUR)) AS civil,
           DATE_ADD(CAST(? AS DATE), INTERVAL 30 DAY) AS due
  `, [fecha_efectiva, fecha_base_civil]);
  assert.equal(fecha_base_civil, dates.civil);
  assert.deepEqual(charge, {
    id: first.data.cargoId, id_pedido: first.data.pedidoId, tipo_movimiento: 'CARGO',
    estado: 'ACREDITADO', monto: '20.00', moneda: 'USD', plazo_aplicado: 30, vence_el: dates.due,
  });
  assert.equal(first.data.venceEl, dates.due);
  const historical = await session.connection.query(`
    SELECT h.regla, d.subtotal
    FROM DETALLE_PEDIDO_CC_PRECIO h JOIN DETALLE_PEDIDO d USING (id_detalle_pedido)
    WHERE d.id_pedido = ?
  `, [first.data.pedidoId]);
  assert.deepEqual(historical, [{ regla: 'FER17-v1', subtotal: '20.00' }]);
  assert.equal(confirmed.stock, 3);
  assert.deepEqual(confirmed.items, []);
  assert.notEqual(confirmed.revision, before.revision);
  const updatedSummary = await assertCredit(f, '25.00', '975.00');
  assert.notEqual(updatedSummary.revision, originalSummary.revision);
  const movements = await account(f, '/movimientos');
  assert.equal(movements.revision, updatedSummary.revision);
  assert.equal(movements.items.length, 2);
  assert.deepEqual(movements.items.find(m => m.id === first.data.cargoId), {
    id: first.data.cargoId, concepto: `Pedido #${first.data.pedidoId}`,
    fechaOperacion: new Date(fecha_efectiva.replace(' ', 'T') + 'Z').toISOString().replace('.000Z', 'Z'),
    importe: '20.00', saldoResultante: '25.00', moneda: 'USD', estado: 'VIGENTE',
    origen: 'DEMO', tipo: 'CARGO', referencia: { pedidoId: first.data.pedidoId },
    plazoDias: 30, venceEl: first.data.venceEl,
  });

  const recovered = await responseBody(await request({
    path: `/${key}`,
    auth: f.auth,
  }), 200);

  const repeated = await responseBody(await request({
    method: 'POST',
    auth: f.auth,
    key,
    body: { cotizacion },
  }), 200);

  assert.deepEqual(recovered, first);
  assert.deepEqual(repeated, first);
  assert.deepEqual(await commercialState(f), confirmed);
  const afterReplay = await assertCredit(f, '25.00', '975.00');
  assert.equal(afterReplay.revision, updatedSummary.revision);
});

test('#262 H01 HTTP/SQL: rechaza una cotización vieja sin pedido, cargo ni descuento de stock', async () => {
  const f = await createOrderFixture(session);
  const key = randomUUID();
  const cotizacion = await quoteFor(f.auth);
  await session.connection.query(
    'UPDATE ITEM_CARRITO SET cantidad = 3 WHERE id_carrito = ? AND id_producto = ?',
    [f.cartId, f.productId],
  );

  const rejected = await responseBody(await request({
    method: 'POST', auth: f.auth, key, body: { cotizacion },
  }), 409);
  assert.equal(rejected.code, 'COTIZACION_DESACTUALIZADA');
  assert.equal(await countForClient('PEDIDO', f.clientId), 0);
  assert.equal(await countForClient('CONFIRMACION_PEDIDO_CC', f.clientId), 1);
  const [movementCount] = await session.connection.query(`
    SELECT COUNT(*) cantidad FROM MOVIMIENTO_CUENTA_CORRIENTE m
    INNER JOIN CUENTA_CORRIENTE c USING (id_cuenta_corriente)
    WHERE c.id_cliente = ?
  `, [f.clientId]);
  assert.equal(Number(movementCount.cantidad), 0);
  const [product] = await session.connection.query(
    'SELECT stock FROM PRODUCTO WHERE id_producto = ?', [f.productId],
  );
  const [item] = await session.connection.query(
    'SELECT cantidad FROM ITEM_CARRITO WHERE id_carrito = ? AND id_producto = ?',
    [f.cartId, f.productId],
  );
  assert.equal(Number(product.stock), 5);
  assert.equal(Number(item.cantidad), 3);
});

test('#262 H01 HTTP/SQL: rechaza un cambio de precio posterior a la cotización', async () => {
  const f = await createOrderFixture(session);
  const cotizacion = await quoteFor(f.auth);
  const key = randomUUID();
  await session.connection.query(`
    UPDATE PRECIO_USD_EVIDENCIA SET precio_verificado = 12.00
    WHERE id_producto = ? AND valida = 1 AND sintetica = 0
  `, [f.productId]);
  await session.connection.query(
    'UPDATE PRODUCTO SET precio = 12.00 WHERE id_producto = ?',
    [f.productId],
  );

  const rejected = await responseBody(await request({
    method: 'POST', auth: f.auth, key, body: { cotizacion },
  }), 409);
  assert.equal(rejected.code, 'COTIZACION_DESACTUALIZADA');
  assert.equal(await countForClient('PEDIDO', f.clientId), 0);
  const [movementCount] = await session.connection.query(`
    SELECT COUNT(*) cantidad FROM MOVIMIENTO_CUENTA_CORRIENTE m
    INNER JOIN CUENTA_CORRIENTE c USING (id_cuenta_corriente)
    WHERE c.id_cliente = ?
  `, [f.clientId]);
  assert.equal(Number(movementCount.cantidad), 0);
  const [product] = await session.connection.query(
    'SELECT stock FROM PRODUCTO WHERE id_producto = ?', [f.productId],
  );
  assert.equal(Number(product.stock), 5);
});

test('#263 A09 HTTP: una clave de otro cliente no expone su resultado', async () => {
  const owner = await createOrderFixture(session);
  const other = await createOrderFixture(session);
  const key = randomUUID();
  const cotizacion = await quoteFor(owner.auth);

  await responseBody(await request({
    method: 'POST',
    auth: owner.auth,
    key,
    body: { cotizacion },
  }), 201);
  const ownerBefore = await commercialState(owner);
  const otherBefore = await commercialState(other);

  const foreign = await responseBody(await request({
    path: `/${key}`,
    auth: other.auth,
  }), 404);

  const missing = await responseBody(await request({
    path: `/${randomUUID()}`,
    auth: other.auth,
  }), 404);

  assert.deepEqual(foreign, missing);
  assert.deepEqual(foreign, { code: 'INTENTO_NO_ENCONTRADO', message: missing.message });
  assert.deepEqual(await commercialState(owner), ownerBefore);
  assert.deepEqual(await commercialState(other), otherBefore);
});

test('#263 C03/I07 HTTP: exceder el disponible por un centavo conserva el rechazo', async () => {
  const f = await createOrderFixture(session, { limit: '19.99' });
  const before = await commercialState(f);
  const key = randomUUID();
  const cotizacion = await quoteFor(f.auth);

  const rejected = await responseBody(await request({
    method: 'POST',
    auth: f.auth,
    key,
    body: { cotizacion },
  }), 409);

  assert.equal(rejected.code, 'CREDITO_INSUFICIENTE');
  assert.equal(rejected.estado, 'RECHAZADO');

  const recovered = await responseBody(await request({
    path: `/${key}`,
    auth: f.auth,
  }), 409);

  assert.deepEqual(recovered, rejected);
  assert.deepEqual(await commercialState(f), before);
  await assertCredit(f, '0.00', '19.99');
  await session.connection.query('UPDATE CUENTA_CORRIENTE SET limite_credito = 20 WHERE id_cuenta_corriente = ?', [f.accountId]);
  const afterLimitChange = await commercialState(f);
  assert.deepEqual(await responseBody(await confirm(f, key, cotizacion), 409), rejected);
  assert.deepEqual(await commercialState(f), afterLimitChange);
  await assertCredit(f, '0.00', '20.00');
});

test('#261 HTTP: informa un intento pendiente con 202 y Retry-After', async () => {
  const f = await createOrderFixture(session);
  const key = randomUUID();

  const {
    reserveAccountOrderAttempt,
  } = require('../dist/repositories/accountOrderAttempt.repository.js');

  await reserveAccountOrderAttempt(f.clientId, key);

  const response = await request({
    path: `/${key}`,
    auth: f.auth,
  });

  assert.equal(response.headers.get('retry-after'), '1');

  const pending = await responseBody(response, 202);

  assert.equal(pending.data.estado, 'PENDIENTE');
  assert.equal(pending.data.code, 'CONFIRMACION_PENDIENTE');
  assert.equal(await countForClient('PEDIDO', f.clientId), 0);
});

for (const sameKey of [true, false]) {
  test(`#263 ${sameKey ? 'I01/I06' : 'I02'} HTTP: POST concurrentes con ${sameKey ? 'la misma clave' : 'claves distintas'}`, async t => {
    const f = await createOrderFixture(session);
    const cotizacion = await quoteFor(f.auth);
    const key = randomUUID();
    const before = await commercialState(f);
    const { cartAdmission } = require('../dist/services/cart.admission.js');
    const enqueue = cartAdmission.enqueue.bind(cartAdmission);
    const queue = t.mock.method(cartAdmission, 'enqueue', (...args) => enqueue(...args));

    await whileHoldingTransaction(async (runner, blocker, track) => {
      await runner.query('SELECT id_cuenta_corriente FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente = ? FOR UPDATE',
        [f.accountId]);
      const first = track(confirm(f, key, cotizacion));
      await waitForLock(blocker);
      const secondKey = sameKey ? key : randomUUID();
      const second = track(confirm(f, secondKey, cotizacion));
      await waitFor(() => queue.mock.callCount() === 1, 'El segundo POST no entró en la cola del usuario');

      if (sameKey) {
        const lookup = await request({ auth: f.auth, path: `/${key}` });
        assert.equal(lookup.headers.get('retry-after'), '1');
        const pending = await responseBody(lookup, 202);
        assert.equal(pending.data.estado, 'PENDIENTE');
        assert.equal(pending.data.code, 'CONFIRMACION_PENDIENTE');
        assert.deepEqual(await commercialState(f), before);
      }
      await runner.commitTransaction();

      const receipt = await responseBody(await first, 201);
      const replay = await responseBody(await second, sameKey ? 200 : 422);
      if (sameKey) assert.deepEqual(replay, receipt);
      else assert.equal(replay.code, 'CARRITO_VACIO');

      const after = await commercialState(f);
      assert.deepEqual(after.orders.map(order => order.id_pedido), [receipt.data.pedidoId]);
      assert.deepEqual(after.movements.map(movement => movement.id), [receipt.data.cargoId]);
      assert.equal(after.stock, 3);
      assert.deepEqual(after.items, []);
      assert.equal(await countForClient('CONFIRMACION_PEDIDO_CC', f.clientId), sameKey ? 1 : 2);
      await assertCredit(f, '20.00', '980.00');
    });
  });
}

test('#263 C04/I03 HTTP: un cargo concurrente reduce el crédito después de cotizar', async () => {
  const f = await createOrderFixture(session, { limit: '30.00' });
  const eligibility = await responseBody(await request({ auth: f.auth, path: '/eligibilidad' }), 200);
  assert.equal(eligibility.data.elegible, true);
  assert.equal(eligibility.data.creditoDisponibleUSD, '30.00');
  assert.equal(eligibility.data.totalUSD, '20.00');
  const charge = await stageCharge(f, '11.00');
  const before = await commercialState(f);
  await whileHoldingTransaction(async (runner, blocker, track) => {
    const chargeId = await charge(runner.manager);
    const purchase = track(confirm(f, randomUUID(), eligibility.data.cotizacion));
    await waitForLock(blocker);
    assert.deepEqual(await commercialState(f), before);
    await runner.commitTransaction();

    const rejection = await responseBody(await purchase, 409);
    assert.equal(rejection.code, 'CREDITO_INSUFICIENTE');
    assert.equal(rejection.estado, 'RECHAZADO');
    const after = await commercialState(f);
    assert.deepEqual(after.orders, before.orders);
    assert.deepEqual(after.items, before.items);
    assert.equal(after.stock, before.stock);
    assert.deepEqual(after.movements.map(m => [m.id, m.monto, m.estado]),
      [[String(chargeId), '11.00', 'ACREDITADO']]);
    await assertCredit(f, '11.00', '19.00');
  });
});

test('#263 I04 HTTP: dos compradores esperan por la última unidad', async () => {
  const first = await createOrderFixture(session, { stock: 1, quantity: 1 });
  const second = await createOrderFixture(session, { quantity: 1 });
  await session.connection.query('UPDATE ITEM_CARRITO SET id_producto = ? WHERE id_carrito = ?',
    [first.productId, second.cartId]);
  second.productId = first.productId;
  const buyers = [first, second];
  const quotes = await Promise.all(buyers.map(f => quoteFor(f.auth)));

  await whileHoldingTransaction(async (runner, blocker, track) => {
    await runner.query('SELECT stock FROM PRODUCTO WHERE id_producto = ? FOR UPDATE', [first.productId]);
    const purchases = buyers.map((f, i) => track(confirm(f, randomUUID(), quotes[i])));
    await waitForLock(blocker, 2);
    await runner.commitTransaction();

    const responses = await Promise.all(purchases);
    assert.deepEqual(responses.map(res => res.status).sort(), [201, 409]);
    for (const [index, response] of responses.entries()) {
      const f = buyers[index];
      const after = await commercialState(f);
      assert.equal(after.stock, 0);
      if (response.status === 201) {
        const { data } = await responseBody(response, 201);
        assert.deepEqual(after.orders.map(order => order.id_pedido), [data.pedidoId]);
        assert.deepEqual(after.movements.map(movement => movement.id), [data.cargoId]);
        assert.deepEqual(after.items, []);
        await assertCredit(f, '10.00', '990.00');
      } else {
        assert.equal((await responseBody(response, 409)).code, 'STOCK_INSUFICIENTE');
        assert.deepEqual(after.orders, []);
        assert.deepEqual(after.movements, []);
        assert.deepEqual(after.items, [{ id_producto: first.productId, cantidad: 1 }]);
        await assertCredit(f, '0.00', '1000.00');
      }
    }
  });
});

for (const [criterion, event, table] of [
  ['R01', 'INSERT', 'PEDIDO'],
  ['R02', 'INSERT', 'MOVIMIENTO_CUENTA_CORRIENTE'],
  ['R03', 'UPDATE', 'PRODUCTO'],
  ['R04', 'UPDATE', 'CONFIRMACION_PEDIDO_CC'],
]) {
  test(`#263 ${criterion} HTTP: fallo antes de COMMIT en ${table} revierte y permite reintentar`, async () => {
    const f = await createOrderFixture(session);
    const key = randomUUID();
    const cotizacion = await quoteFor(f.auth);
    const before = await commercialState(f);
    const original = await assertCredit(f, '0.00', '1000.00');
    await assertOwned(session);
    await session.connection.query(`
      CREATE TRIGGER fail_order_263 BEFORE ${event} ON ${table} FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FALLO_PRE_COMMIT_${criterion}'
    `);
    try {
      const failed = await responseBody(await confirm(f, key, cotizacion), 503);
      assert.equal(failed.code, 'CONFIRMACION_NO_DISPONIBLE');
      const pending = await responseBody(await request({ auth: f.auth, path: `/${key}` }), 202);
      assert.equal(pending.data.estado, 'PENDIENTE');
      assert.deepEqual(await commercialState(f), before);
      assert.equal((await assertCredit(f, '0.00', '1000.00')).revision, original.revision);
    } finally {
      await session.connection.query('DROP TRIGGER fail_order_263');
    }

    const { data } = await responseBody(await confirm(f, key, cotizacion), 201);
    const after = await commercialState(f);
    assert.deepEqual(after.orders.map(order => order.id_pedido), [data.pedidoId]);
    assert.deepEqual(after.movements.map(movement => movement.id), [data.cargoId]);
    assert.equal(after.stock, 3);
    assert.deepEqual(after.items, []);
    assert.equal(await countForClient('CONFIRMACION_PEDIDO_CC', f.clientId), 1);
    await assertCredit(f, '20.00', '980.00');
  });
}

test('#261 HTTP: errores de origen y JSON también mantienen respuestas privadas', async () => {
  const f = await createOrderFixture(session);
  const key = randomUUID();
  const cotizacion = await quoteFor(f.auth);

  await responseBody(await request({
    method: 'POST',
    auth: f.auth,
    key,
    body: { cotizacion },
    headers: { Origin: 'https://origen-no-autorizado.example' },
  }), 403);

  const malformed = await fetchFromBrowser(base, {
    method: 'POST',
    headers: {
      Cookie: `jwt_token=${signToken(f.auth)}`,
      'Idempotency-Key': key,
      'Content-Type': 'application/json',
    },
    body: '{',
    signal: AbortSignal.timeout(15000),
  });

  await responseBody(malformed, 400);

  assert.equal(
    await countForClient('CONFIRMACION_PEDIDO_CC', f.clientId),
    0,
  );
});
