const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { test, before, after } = require('node:test');

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

test('#261 HTTP: visitante y ADMIN no confirman ni consultan pedidos', async () => {
  const f = await createOrderFixture(session);
  const key = randomUUID();

  const actors = [
    { auth: undefined, status: 401 },
    { auth: { id: f.adminId, rol: 'ADMIN' }, status: 403 },
  ];

  for (const actor of actors) {
    await responseBody(await request({
      method: 'POST',
      auth: actor.auth,
      key,
      body: {},
    }), actor.status);

    await responseBody(await request({
      path: `/${key}`,
      auth: actor.auth,
    }), actor.status);
  }

  assert.equal(await countForClient('PEDIDO', f.clientId), 0);
  assert.equal(
    await countForClient('CONFIRMACION_PEDIDO_CC', f.clientId),
    0,
  );
});

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

test('#261 HTTP: confirma, consulta y repite la misma compra sin duplicarla', async () => {
  const f = await createOrderFixture(session);
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
  assert.equal(await countForClient('PEDIDO', f.clientId), 1);
  const [movementCount] = await session.connection.query(`
    SELECT COUNT(*) cantidad FROM MOVIMIENTO_CUENTA_CORRIENTE m
    INNER JOIN CUENTA_CORRIENTE c USING (id_cuenta_corriente)
    WHERE c.id_cliente = ? AND m.origen = 'PEDIDO'
  `, [f.clientId]);
  assert.equal(Number(movementCount.cantidad), 1);

  const [product] = await session.connection.query(
    'SELECT stock FROM PRODUCTO WHERE id_producto = ?',
    [f.productId],
  );

  assert.equal(Number(product.stock), 3);
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

test('#261 HTTP: una clave de otro cliente no expone su resultado', async () => {
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

  const foreign = await responseBody(await request({
    path: `/${key}`,
    auth: other.auth,
  }), 404);

  const missing = await responseBody(await request({
    path: `/${randomUUID()}`,
    auth: other.auth,
  }), 404);

  assert.deepEqual(foreign, missing);
  assert.equal(await countForClient('PEDIDO', other.clientId), 0);
});

test('#261 HTTP: conserva y permite consultar un rechazo por crédito insuficiente', async () => {
  const f = await createOrderFixture(session, { limit: '1.00' });
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
  assert.equal(await countForClient('PEDIDO', f.clientId), 0);
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
