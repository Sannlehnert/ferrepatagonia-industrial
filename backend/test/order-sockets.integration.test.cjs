const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { test: nodeTest, before, after } = require('node:test');
const jwt = require('jsonwebtoken');
const { io } = require('socket.io-client');
const { childProfile, connectOwned, assertOwned } = require('./helpers/cc260-disposable.cjs');
const { createOrderFixture } = require('./helpers/account-order.fixture.cjs');
const { fetchFromBrowser } = require('./helpers/browser-request.cjs');

const EVENT = 'pedido.confirmado.v1';
const CART_EVENT = 'carrito.actualizado.v1';
const STOCK_EVENT = 'stock.actualizado.v1';
const ORIGIN = process.env.APP_PUBLIC_ORIGIN;
const ORDERS = '/api/pedidos/cuenta-corriente';
const CART = '/api/carrito/items';
const PRODUCTS = '/api/admin/productos';
const waitFor = (socket, event) => once(socket, event, { signal: AbortSignal.timeout(5000) });
const test = (name, fn) => nodeTest(name, { timeout: 20000 }, fn);

let db, session, backend, base, signToken;

before(async () => {
  session = await connectOwned(childProfile());
  await assertOwned(session);
  db = require('../dist/config/database.config');
  await db.initializeDatabase();
  ({ signToken } = require('../dist/services/token.service'));
  backend = require('../dist/http-server').createBackendServer();
  backend.server.listen(0, '127.0.0.1');
  await once(backend.server, 'listening');
  base = `http://127.0.0.1:${backend.server.address().port}`;
});

after(async () => {
  try { await backend?.close(); }
  finally {
    try { await db?.destroyDatabase(); }
    finally { await session?.connection.end(); }
  }
});

function socketFor(t, options = {}) {
  const {
    token, origin = ORIGIN, transport = 'websocket', reconnection = false, query, auth,
  } = options;
  const socket = io(base, {
    autoConnect: false, forceNew: true, transports: [transport], reconnection,
    reconnectionDelay: 25, randomizationFactor: 0, timeout: 3000, query, auth,
    extraHeaders: { ...(origin ? { Origin: origin } : {}), ...(token ? { Cookie: `jwt_token=${token}` } : {}) },
  });
  t.after(() => socket.disconnect());
  return socket;
}

async function connect(t, auth, options = {}) {
  const socket = socketFor(t, { token: signToken(auth), ...options });
  const events = [];
  const cart = [];
  const stock = [];
  socket.on(EVENT, payload => events.push(payload));
  socket.on(CART_EVENT, payload => cart.push(payload));
  socket.on(STOCK_EVENT, payload => stock.push(payload));
  const connected = waitFor(socket, 'connect');
  socket.connect();
  await connected;
  return { socket, events, cart, stock };
}

async function expectRejected(t, options, message) {
  const socket = socketFor(t, options);
  const rejected = waitFor(socket, 'connect_error');
  socket.connect();
  const [error] = await rejected;
  if (message) assert.equal(error.message, message);
  assert.equal(socket.connected, false);
}

function peer({ socket }) {
  const serverSocket = backend.io.sockets.sockets.get(socket.id);
  assert.ok(serverSocket);
  return serverSocket;
}

async function flush(...connections) {
  await backend.waitForNotifications();
  await Promise.all(connections.map(async connection => {
    const seen = waitFor(connection.socket, 'test:flush');
    // Socket.IO preserves the order of packets on this connection.
    peer(connection).emit('test:flush');
    await seen;
  }));
}

function assertSilent(...connections) {
  for (const c of connections) {
    assert.deepEqual(c.events, []);
    assert.deepEqual(c.cart, []);
    assert.deepEqual(c.stock, []);
  }
}

async function mutate(auth, method, path, body, status) {
  const headers = { Cookie: `jwt_token=${signToken(auth)}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetchFromBrowser(base + path, {
    method, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  const result = status === 204 && response.status === 204 ? await response.text() : await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  return result;
}

async function inventory(f) {
  const [row] = await session.connection.query(`
    SELECT p.stock, (SELECT cantidad FROM ITEM_CARRITO
      WHERE id_carrito = ? AND id_producto = p.id_producto) AS quantity
    FROM PRODUCTO p WHERE p.id_producto = ?
  `, [f.cartId, f.productId]);
  return [row.stock, row.quantity];
}

async function request(f, path, status, key, cotizacion) {
  const headers = { Cookie: `jwt_token=${signToken(f.auth)}` };
  if (cotizacion !== undefined) {
    headers['Idempotency-Key'] = key;
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetchFromBrowser(base + path, {
    method: cotizacion === undefined ? 'GET' : 'POST',
    headers,
    ...(cotizacion === undefined ? {} : { body: JSON.stringify({ cotizacion }) }),
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

async function quote(f) {
  const { data } = await request(f, ORDERS + '/eligibilidad', 200);
  assert.equal(typeof data.cotizacion, 'string');
  return data.cotizacion;
}

function confirm(f, key, token, status = 201) {
  return request(f, ORDERS, status, key, token);
}

async function counts(f) {
  const [row] = await session.connection.query(`
    SELECT (SELECT COUNT(*) FROM PEDIDO WHERE id_cliente = ?) AS orders,
           (SELECT COUNT(*) FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?) AS movements,
           (SELECT COUNT(*) FROM CONFIRMACION_PEDIDO_CC WHERE id_cliente = ?) AS attempts
  `, [f.clientId, f.accountId, f.clientId]);
  return [row.orders, row.movements, row.attempts].map(Number);
}

function interceptCommit(t, intercept) {
  const results = require('../dist/repositories/accountOrderResult.repository');
  const complete = results.completeAccountOrderAttempt;
  t.mock.method(results, 'completeAccountOrderAttempt', async (manager, ...args) => {
    const result = await complete(manager, ...args);
    const runner = manager.queryRunner;
    const commit = runner.commitTransaction.bind(runner);
    runner.commitTransaction = () => intercept(commit);
    return result;
  });
}

test('S01 S02 S04: conexión y rooms asignadas por el servidor', async t => {
  const f = await createOrderFixture(session);
  const client = await connect(t, f.auth, { transport: 'polling', auth: { room: 'orders:admin' } });
  const admin = await connect(t, { id: f.adminId, rol: 'ADMIN' });
  client.socket.emit('join', 'orders:admin');
  await flush(client, admin);
  assert.deepEqual([...peer(client).rooms], [client.socket.id, `orders:client:${f.clientId}`, 'catalog:authenticated']);
  assert.deepEqual([...peer(admin).rooms], [admin.socket.id, 'orders:admin', 'catalog:authenticated']);
});

test('S03: credenciales ausentes, inválidas, expiradas o rol JWT obsoleto', async t => {
  const f = await createOrderFixture(session);
  const valid = signToken(f.auth);
  await expectRejected(t, { query: { jwt_token: valid }, auth: { token: valid } }, 'NO_AUTENTICADO');
  await expectRejected(t, { token: 'invalid' }, 'NO_AUTENTICADO');
  await expectRejected(t, {
    token: jwt.sign(f.auth, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: -1 }),
  }, 'NO_AUTENTICADO');
  await expectRejected(t, { token: signToken({ ...f.auth, rol: 'ADMIN' }) }, 'NO_AUTENTICADO');
});

test('S06: revocación de cliente conectado y rechazo en un nuevo handshake', async t => {
  const f = await createOrderFixture(session);
  const client = await connect(t, f.auth);
  const token = await quote(f);
  interceptCommit(t, async commit => {
    await commit();
    await session.connection.query('UPDATE CLIENTE SET activo = 0 WHERE id_cliente = ?', [f.clientId]);
  });
  const disconnected = waitFor(client.socket, 'disconnect');
  await confirm(f, randomUUID(), token);
  await disconnected;
  assertSilent(client);
  await expectRejected(t, { token: signToken(f.auth) }, 'NO_AUTENTICADO');
});

test('S06: cuenta comercial deshabilitada pierde acceso antes de entregar', async t => {
  const f = await createOrderFixture(session);
  const client = await connect(t, f.auth);
  const token = await quote(f);
  interceptCommit(t, async commit => {
    await commit();
    await session.connection.query('UPDATE CUENTA_CORRIENTE SET habilitada = 0 WHERE id_cliente = ?', [f.clientId]);
  });
  await confirm(f, randomUUID(), token);
  await flush(client);
  assert.deepEqual(client.events, []);
  assert.deepEqual(await counts(f), [1, 1, 1]);
});

test('error operativo de MariaDB diferenciado de sesión inválida', async t => {
  const f = await createOrderFixture(session);
  const users = require('../dist/repositories/usuario.repository');
  t.mock.method(users, 'findUsuarioById', async () => { throw new Error('DB_TEMPORARY'); });
  await expectRejected(t, { token: signToken(f.auth) }, 'AUTENTICACION_NO_DISPONIBLE');
});

test('S05 S07 S10 S14: barrera COMMIT, aislamiento, recuperación e idempotencia REST', async t => {
  const f = await createOrderFixture(session);
  const other = await createOrderFixture(session);
  const client = await connect(t, f.auth);
  const secondSession = await connect(t, f.auth, { transport: 'polling' });
  const outsider = await connect(t, other.auth);
  const admin = await connect(t, { id: f.adminId, rol: 'ADMIN' });
  const key = randomUUID();
  const token = await quote(f);
  const reached = Promise.withResolvers();
  const runCommit = Promise.withResolvers();
  const persisted = Promise.withResolvers();
  const acknowledge = Promise.withResolvers();
  interceptCommit(t, async commit => {
    reached.resolve();
    await runCommit.promise;
    await commit();
    persisted.resolve();
    await acknowledge.promise;
  });

  const response = confirm(f, key, token);
  const earlyResponse = response.then(() => assert.fail('POST terminó antes de acreditar el COMMIT'));
  try {
    await Promise.race([reached.promise, earlyResponse]);
    assert.deepEqual(await counts(f), [0, 0, 1]);
    assert.deepEqual(await inventory(f), [5, 2]);
    await flush(client, secondSession, outsider, admin);
    assertSilent(client, secondSession, outsider, admin);
    runCommit.resolve();
    await Promise.race([persisted.promise, earlyResponse]);
    assert.deepEqual(await counts(f), [1, 1, 1]);
    assert.deepEqual(await inventory(f), [3, null]);
    await flush(client, secondSession, outsider, admin);
    assertSilent(client, secondSession, outsider, admin);
  } finally {
    runCommit.resolve();
    acknowledge.resolve();
    await response;
  }
  const receipt = await response;
  await flush(client, secondSession, outsider, admin);
  assert.deepEqual(await counts(f), [1, 1, 1]);
  assert.deepEqual(client.events, [{
    version: 1,
    idEvento: `pedido.confirmado.v1:${receipt.data.pedidoId}`,
    pedidoId: receipt.data.pedidoId,
    estado: 'CONFIRMADO',
    notificadoEn: new Date(client.events[0].notificadoEn).toISOString(),
  }]);
  assert.deepEqual(secondSession.events, client.events);
  assert.deepEqual(outsider.events, []);
  assert.deepEqual(admin.events, []);
  assert.deepEqual(await confirm(f, key, token, 200), receipt);
  assert.deepEqual(await request(f, ORDERS + '/' + key, 200), receipt);
  assert.deepEqual(await request(f, '/api/health', 200), { api: 'ok', database: 'ok' });
  await flush(client, secondSession, outsider, admin);
  assert.equal(client.events.length, 1);
  assert.equal(secondSession.events.length, 1);
  for (const c of [client, secondSession]) assert.deepEqual(c.cart, [{ version: 1 }]);
  for (const c of [outsider, admin]) assert.deepEqual(c.cart, []);
  for (const c of [client, secondSession, outsider, admin]) {
    assert.deepEqual(c.stock, [{ version: 1, productosIds: [f.productId] }]);
  }
  assert.deepEqual(await counts(f), [1, 1, 1]);
});

test('S08: rollback después de escribir pedido y cargo no emite', async t => {
  const f = await createOrderFixture(session);
  const client = await connect(t, f.auth);
  const token = await quote(f);
  const results = require('../dist/repositories/accountOrderResult.repository');
  const complete = results.completeAccountOrderAttempt;
  t.mock.method(results, 'completeAccountOrderAttempt', async (...args) => {
    await complete(...args);
    throw new Error('ROLLBACK_TEST');
  });
  await confirm(f, randomUUID(), token, 503);
  await flush(client);
  assertSilent(client);
  assert.deepEqual(await inventory(f), [5, 2]);
  assert.deepEqual(await counts(f), [0, 0, 1]);
});

test('S09: crédito insuficiente no emite', async t => {
  const f = await createOrderFixture(session, { limit: '1.00' });
  const client = await connect(t, f.auth);
  const failure = await confirm(f, randomUUID(), await quote(f), 409);
  assert.equal(failure.code, 'CREDITO_INSUFICIENTE');
  await flush(client);
  assertSilent(client);
  assert.deepEqual(await counts(f), [0, 0, 1]);
});

test('S11: COMMIT con acuse perdido recupera el pedido sin emitir', async t => {
  const f = await createOrderFixture(session);
  const client = await connect(t, f.auth);
  const key = randomUUID();
  const token = await quote(f);
  interceptCommit(t, async commit => {
    await commit();
    throw new Error('COMMIT_ACK_LOST_TEST');
  });
  const recovered = await confirm(f, key, token, 200);
  assert.equal(recovered.data.estado, 'CONFIRMADO');
  assert.deepEqual(await request(f, ORDERS + '/' + key, 200), recovered);
  assert.deepEqual(await confirm(f, key, token, 200), recovered);
  await flush(client);
  assertSilent(client);
  assert.deepEqual(await inventory(f), [3, null]);
  assert.deepEqual(await counts(f), [1, 1, 1]);
});

test('S11: COMMIT no acreditado deja un intento pendiente sin emitir', async t => {
  const f = await createOrderFixture(session);
  const client = await connect(t, f.auth);
  const token = await quote(f);
  interceptCommit(t, async () => { throw new Error('COMMIT_NOT_ACKNOWLEDGED_TEST'); });
  const key = randomUUID();
  assert.equal((await confirm(f, key, token, 202)).data.estado, 'PENDIENTE');
  assert.equal((await request(f, ORDERS + '/' + key, 202)).data.estado, 'PENDIENTE');
  await flush(client);
  assertSilent(client);
  assert.deepEqual(await counts(f), [0, 0, 1]);
});

test('S12: reconexión de transporte reautentica y no modifica el pedido ni el cargo', async t => {
  const f = await createOrderFixture(session);
  const client = await connect(t, f.auth, { reconnection: true });
  const outsider = await connect(t, (await createOrderFixture(session)).auth);
  const token = await quote(f);
  const key = randomUUID();
  await confirm(f, key, token);
  await flush(client);
  const previousId = client.socket.id;
  const reconnected = waitFor(client.socket, 'connect');
  peer(client).conn.close();
  await reconnected;
  assert.notEqual(client.socket.id, previousId);
  assert.ok(peer(client).rooms.has(`orders:client:${f.clientId}`));
  await confirm(f, key, token, 200);
  await flush(client, outsider);
  assert.equal(client.events.length, 1);
  assert.deepEqual(outsider.events, []);
  assert.deepEqual(client.cart, [{ version: 1 }]);
  assert.deepEqual(outsider.cart, []);
  assert.deepEqual(client.stock, [{ version: 1, productosIds: [f.productId] }]);
  assert.deepEqual(outsider.stock, client.stock);
  assert.deepEqual(await inventory(f), [3, null]);
  assert.deepEqual(await counts(f), [1, 1, 1]);
  await session.connection.query('UPDATE USUARIO SET activo = 0 WHERE id_usuario = ?', [f.userId]);
  const rejected = waitFor(client.socket, 'connect_error');
  peer(client).conn.close();
  assert.equal((await rejected)[0].message, 'NO_AUTENTICADO');
  assert.deepEqual(await counts(f), [1, 1, 1]);
});

test('S13: excepción al enviar conserva la compra recuperable por REST', async t => {
  const f = await createOrderFixture(session);
  const client = await connect(t, f.auth);
  const serverSocket = peer(client);
  const emit = serverSocket.emit.bind(serverSocket);
  const send = t.mock.method(serverSocket, 'emit', (event, ...args) => {
    if (event === EVENT) throw new Error('SOCKET_SEND_FAILED_TEST');
    return emit(event, ...args);
  });
  const key = randomUUID();
  const receipt = await confirm(f, key, await quote(f));
  assert.deepEqual(await request(f, ORDERS + '/' + key, 200), receipt);
  await flush(client);
  assert.equal(send.mock.calls.filter(call => call.arguments[0] === EVENT).length, 1);
  assert.deepEqual(client.events, []);
  assert.deepEqual(await counts(f), [1, 1, 1]);
});

test('S15: origen ajeno o ausente se rechaza en polling y WebSocket', async t => {
  const f = await createOrderFixture(session);
  const token = signToken(f.auth);
  for (const transport of ['polling', 'websocket']) {
    await expectRejected(t, { token, transport, origin: 'http://foreign.test' });
    await expectRejected(t, { token, transport, origin: null });
  }
});

test('Carrito: alta con barrera de COMMIT, cantidad y baja privadas sin cambios de inventario', async t => {
  const f = await createOrderFixture(session);
  const other = await createOrderFixture(session);
  await session.connection.query('DELETE FROM ITEM_CARRITO WHERE id_carrito = ?', [f.cartId]);
  await session.connection.query('UPDATE CUENTA_CORRIENTE SET habilitada = 0 WHERE id_cliente = ?', [f.clientId]);
  const owner = await connect(t, f.auth);
  const sibling = await connect(t, f.auth, { transport: 'polling' });
  const outsider = await connect(t, other.auth);

  const reached = Promise.withResolvers();
  const acknowledge = Promise.withResolvers();
  const carts = require('../dist/repositories/cart.repository');
  const save = carts.saveCartItem;
  const hook = t.mock.method(carts, 'saveCartItem', async (manager, ...args) => {
    const changed = await save(manager, ...args);
    const runner = manager.queryRunner;
    const commit = runner.commitTransaction.bind(runner);
    runner.commitTransaction = async () => {
      await commit();
      reached.resolve();
      await acknowledge.promise;
    };
    return changed;
  });
  const added = mutate(f.auth, 'POST', CART, { productoId: f.productId, cantidad: 1 }, 204);
  try {
    await Promise.race([reached.promise, added.then(() => assert.fail('Alta antes del acuse'))]);
    assert.deepEqual(await inventory(f), [5, 1]);
    await flush(owner, sibling, outsider);
    assertSilent(owner, sibling, outsider);
  } finally {
    acknowledge.resolve();
    await added;
    hook.mock.restore();
  }
  const line = CART + '/' + f.productId;
  const check = async (length, quantity) => {
    await flush(owner, sibling, outsider);
    assert.deepEqual(await inventory(f), [5, quantity]);
    assert.deepEqual(owner.cart, Array.from({ length }, () => ({ version: 1 })));
    assert.deepEqual(sibling.cart, owner.cart);
    for (const client of [owner, sibling, outsider]) {
      assert.deepEqual(client.stock, []);
      assert.deepEqual(client.events, []);
    }
    assert.deepEqual(outsider.cart, []);
  };
  await check(1, 1);
  await mutate(f.auth, 'PATCH', line, { cantidad: 3 }, 204);
  await check(2, 3);
  await mutate(f.auth, 'PATCH', line, { cantidad: 3 }, 204);
  await mutate(f.auth, 'POST', CART, { productoId: f.productId, cantidad: 3 }, 204);
  await check(2, 3);
  await mutate(f.auth, 'DELETE', line, undefined, 204);
  await check(3, null);
  await mutate(f.auth, 'DELETE', line, undefined, 204);
  await check(3, null);
});

test('Carrito: rechazo y rollback tras escribir mantienen inventario e ítems y no emiten', async t => {
  const f = await createOrderFixture(session);
  const client = await connect(t, f.auth);
  const line = CART + '/' + f.productId;
  const rejection = await mutate(f.auth, 'PATCH', line, { cantidad: 6 }, 422);
  assert.equal(rejection.code, 'STOCK_INSUFICIENTE');
  const carts = require('../dist/repositories/cart.repository');
  const save = carts.saveCartItem;
  t.mock.method(carts, 'saveCartItem', async (...args) => {
    assert.equal(await save(...args), true);
    throw new Error('ROLLBACK_CART_TEST');
  });
  await mutate(f.auth, 'PATCH', line, { cantidad: 4 }, 500);
  await flush(client);
  assertSilent(client);
  assert.deepEqual(await inventory(f), [5, 2]);
});

test('Stock ADMIN: PATCH, PUT, rechazo, no-op y contratos públicos de catálogo y categorías', async t => {
  const f = await createOrderFixture(session);
  const admin = { id: f.adminId, rol: 'ADMIN' };
  const adminSocket = await connect(t, admin);
  const client = await connect(t, f.auth);
  await session.connection.query('UPDATE CUENTA_CORRIENTE SET habilitada = 0 WHERE id_cliente = ?', [f.clientId]);
  const productPath = PRODUCTS + '/' + f.productId;
  const categories = await fetch(base + '/api/categorias', { signal: AbortSignal.timeout(5000) });
  assert.equal(categories.status, 200);
  assert.ok((await categories.json()).data.categorias.some(c => c.id === f.categoryId && c.nombre === 'DEMO #261'));
  await mutate(admin, 'PATCH', productPath + '/stock', { stock: 0 }, 200);
  await flush(client, adminSocket);
  assert.deepEqual(client.stock, [{ version: 1, productosIds: [f.productId] }]);
  assert.deepEqual(adminSocket.stock, client.stock);
  assert.deepEqual(await inventory(f), [0, 2]);
  const catalog = await fetch(base + '/api/catalogo?categoria=' + f.categoryId, { signal: AbortSignal.timeout(5000) });
  assert.equal(catalog.status, 200);
  const { data } = await catalog.json();
  assert.equal(data.pagination.total, 1);
  assert.deepEqual(data.productos, [{
    id: f.productId, codigo: data.productos[0].codigo, nombre: 'DEMO #261',
    categoria: { id: f.categoryId, nombre: 'DEMO #261' },
    precio: null, estadoPrecio: 'PENDIENTE_DEFINICION', disponible: false,
  }]);
  await mutate(admin, 'PATCH', productPath + '/stock', { stock: 0 }, 200);
  await mutate(admin, 'PUT', productPath, { stock: 0, nombre: 'Otro nombre' }, 200);
  await mutate(admin, 'PATCH', productPath + '/stock', { stock: -1 }, 400);
  await mutate(f.auth, 'PATCH', productPath + '/stock', { stock: 7 }, 403);
  await flush(client, adminSocket);
  assert.equal(client.stock.length, 1);
  assert.equal(adminSocket.stock.length, 1);
  await mutate(admin, 'PUT', productPath, { stock: 7 }, 200);
  await flush(client, adminSocket);
  assert.deepEqual(client.stock, Array(2).fill({ version: 1, productosIds: [f.productId] }));
  assert.deepEqual(adminSocket.stock, client.stock);
  assert.deepEqual(await inventory(f), [7, 2]);
  for (const c of [client, adminSocket]) {
    assert.deepEqual(c.cart, []);
    assert.deepEqual(c.events, []);
  }
  const detail = await fetch(base + '/api/catalogo/' + f.productId, { signal: AbortSignal.timeout(5000) });
  assert.equal(detail.status, 200);
  const { producto } = (await detail.json()).data;
  assert.equal(producto.stock, 7);
  assert.equal(producto.disponible, true);
  assert.equal(producto.precio, null);
});

test('Stock ADMIN: un producto fuera del catálogo no revela su identificador', async t => {
  const f = await createOrderFixture(session);
  const admin = { id: f.adminId, rol: 'ADMIN' };
  const client = await connect(t, f.auth);
  await mutate(admin, 'PUT', PRODUCTS + '/' + f.productId, { stock: 4, activo: false }, 200);
  await flush(client);
  assertSilent(client);
  assert.deepEqual(await inventory(f), [4, 2]);
});

test('Stock ADMIN: retiene el aviso hasta acreditar el COMMIT de la actualización', async t => {
  const f = await createOrderFixture(session);
  const client = await connect(t, f.auth);
  const admin = { id: f.adminId, rol: 'ADMIN' };
  const persisted = Promise.withResolvers();
  const acknowledge = Promise.withResolvers();
  const create = db.dataSource.createQueryRunner.bind(db.dataSource);
  t.mock.method(db.dataSource, 'createQueryRunner', (...args) => {
    const runner = create(...args);
    const commit = runner.commitTransaction.bind(runner);
    runner.commitTransaction = async () => {
      await commit();
      persisted.resolve();
      await acknowledge.promise;
    };
    return runner;
  });
  const changed = mutate(admin, 'PATCH', PRODUCTS + '/' + f.productId + '/stock', { stock: 3 }, 200);
  try {
    await Promise.race([persisted.promise, changed.then(() => assert.fail('Stock antes del acuse'))]);
    assert.deepEqual(await inventory(f), [3, 2]);
    await flush(client);
    assertSilent(client);
  } finally {
    acknowledge.resolve();
    await changed;
  }
  await flush(client);
  assert.deepEqual(client.stock, [{ version: 1, productosIds: [f.productId] }]);
});

test('Stock ADMIN: REST responde mientras el aviso espera autorización y tolera un fallo de envío', async t => {
  const f = await createOrderFixture(session);
  const admin = { id: f.adminId, rol: 'ADMIN' };
  const client = await connect(t, f.auth);
  const users = require('../dist/repositories/usuario.repository');
  const find = users.findUsuarioById;
  const held = Promise.withResolvers();
  const resume = Promise.withResolvers();
  t.mock.method(users, 'findUsuarioById', async id => {
    if (id === f.userId) {
      held.resolve();
      await resume.promise;
    }
    return find(id);
  });
  const serverSocket = peer(client);
  const emit = serverSocket.emit.bind(serverSocket);
  const send = t.mock.method(serverSocket, 'emit', (event, ...args) => {
    if (event === STOCK_EVENT) throw new Error('STOCK_SEND_FAILED_TEST');
    return emit(event, ...args);
  });
  const changed = mutate(admin, 'PATCH', PRODUCTS + '/' + f.productId + '/stock', { stock: 1 }, 200);
  try {
    await changed;
    await held.promise;
    assert.deepEqual(await inventory(f), [1, 2]);
    assertSilent(client);
  } finally {
    resume.resolve();
    await backend.waitForNotifications();
  }
  await flush(client);
  assert.equal(send.mock.calls.filter(call => call.arguments[0] === STOCK_EVENT).length, 1);
  assertSilent(client);
  assert.deepEqual(await inventory(f), [1, 2]);
});
