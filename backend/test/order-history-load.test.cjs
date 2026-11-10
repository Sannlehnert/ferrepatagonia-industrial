const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { before, after, test } = require('node:test');
const { childProfile, connectOwned } = require('./helpers/cc260-disposable.cjs');
const { createOrderFixture } = require('./helpers/account-order.fixture.cjs');
const { fetchFromBrowser } = require('./helpers/browser-request.cjs');

process.env.LEGACY_ORDER_UTC_OFFSET = '-03:00';
let session, db, server, base, signToken;
before(async () => {
  session = await connectOwned(childProfile());
  db = require('../dist/config/database.config');
  await db.initializeDatabase();
  ({ signToken } = require('../dist/services/token.service'));
  const { app } = require('../dist/app');
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port + '/api/pedidos';
});

after(async () => {
  try {
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await db?.destroyDatabase();
  } finally {
    await session?.connection.end();
  }
});

function request(auth, path = '', options = {}) {
  return fetchFromBrowser(base + path, {
    ...options, headers: { Cookie: 'jwt_token=' + signToken(auth), ...options.headers },
  });
}

async function eligibility(fixture) {
  const response = await request(fixture.auth, '/cuenta-corriente/eligibilidad');
  assert.equal(response.status, 200);
  return (await response.json()).data.cotizacion;
}

async function confirm(fixture, cotizacion) {
  const response = await request(fixture.auth, '/cuenta-corriente', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ cotizacion }),
  });
  assert.equal(response.status, 201);
  return (await response.json()).data.pedidoId;
}

function wrapQueries(t, handler) {
  const original = db.dataSource.createQueryRunner.bind(db.dataSource);
  t.mock.method(db.dataSource, 'createQueryRunner', (...args) => {
    const runner = original(...args);
    const query = runner.query.bind(runner);
    runner.query = (...params) => handler(query, ...params);
    return runner;
  });
}

async function waitUntil(predicate) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await delay(10);
  }
  assert.fail('No se observó el estado SQL esperado');
}

test('ocho lecturas conservan capacidad SQL para elegibilidad y confirmación', async t => {
  const reader = await createOrderFixture(session);
  const buyer = await createOrderFixture(session);
  const cotizacion = await eligibility(buyer);
  let active = 0;
  let maxActive = 0;
  wrapQueries(t, async (query, sql, ...rest) => {
    if (!sql.includes('AS fechaUtc')) return query(sql, ...rest);
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      await query('SELECT SLEEP(1.5)');
      return await query(sql, ...rest);
    } finally { active--; }
  });

  const requests = Array.from({ length: 8 }, () => request(reader.auth));
  await waitUntil(() => active === 2);
  const [orderId, secondQuote] = await Promise.all([confirm(buyer, cotizacion), eligibility(reader)]);
  assert.ok(orderId > 0 && secondQuote);
  assert.equal(active, 2);
  const responses = await Promise.all(requests);
  assert.equal(maxActive, 2);
  assert.equal(responses.filter(response => response.status === 200).length, 2);
  for (const response of responses.filter(response => response.status !== 200)) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '1');
    assert.equal((await response.json()).code, 'CONSULTA_PEDIDOS_OCUPADA');
  }
});

test('un aborto en espera, un aborto con SQL activo y un error liberan capacidad', async t => {
  const reader = await createOrderFixture(session);
  const running = new AbortController();
  const secondRunning = new AbortController();
  const waiting = new AbortController();
  let queries = 0;
  let released = 0;
  wrapQueries(t, async (query, sql, ...rest) => {
    if (!sql.includes('AS fechaUtc')) return query(sql, ...rest);
    queries++;
    if (queries <= 2) {
      try { await query('SELECT SLEEP(4)'); }
      finally { released++; }
    }
    if (queries === 3) {
      await query('SELECT columna_inexistente_273');
    }
    return query(sql, ...rest);
  });

  const first = assert.rejects(request(reader.auth, '', { signal: running.signal }), /abort/i);
  const second = assert.rejects(request(reader.auth, '', { signal: secondRunning.signal }), /abort/i);
  async function runningHistorySql() {
    const [row] = await session.connection.query(
      "SELECT COUNT(*) AS running FROM information_schema.PROCESSLIST " +
      "WHERE DB = DATABASE() AND ID <> CONNECTION_ID() AND INFO LIKE '%SLEEP(4)%'",
    );
    return Number(row.running);
  }
  await waitUntil(async () => await runningHistorySql() === 2);
  const arrived = once(server, 'request');
  const queued = assert.rejects(request(reader.auth, '', { signal: waiting.signal }), /abort/i);
  await arrived;
  waiting.abort();
  running.abort();
  secondRunning.abort();
  await Promise.all([first, second, queued]);
  await waitUntil(() => released === 2);
  await waitUntil(async () => await runningHistorySql() === 0);
  assert.equal((await request(reader.auth)).status, 503);
  assert.equal((await request(reader.auth)).status, 200);
  assert.equal(queries, 4);
});

test('el instante nuevo y el histórico se leen correctamente con sesión -03:00', async t => {
  const fixture = await createOrderFixture(session);
  const cotizacion = await eligibility(fixture);
  const original = db.dataSource.createQueryRunner.bind(db.dataSource);
  t.mock.method(db.dataSource, 'createQueryRunner', (...args) => {
    const runner = original(...args);
    const query = runner.query.bind(runner);
    runner.query = async (...params) => {
      await query("SET time_zone = '-03:00'");
      return query(...params);
    };
    return runner;
  });
  const beforeConfirm = Date.now();
  const orderId = await confirm(fixture, cotizacion);
  const afterConfirm = Date.now();
  const [row] = await session.connection.query(
    "SELECT TIMESTAMPDIFF(MINUTE, fecha, fecha_utc) AS delta FROM PEDIDO WHERE id_pedido = ?", [orderId],
  );
  assert.equal(Number(row.delta), 180);

  const history = await session.connection.query(
    "INSERT INTO PEDIDO (id_cliente, fecha, estado, modalidad_pago, subtotal, descuento, total) VALUES (?, '2026-08-12 10:00:00', 'CONFIRMADO', 'TRANSFERENCIA', 10, 0, 10)",
    [fixture.clientId],
  );
  const listResponse = await request(fixture.auth);
  assert.equal(listResponse.status, 200);
  const { data: { items } } = await listResponse.json();
  const fresh = items.find(row => row.pedidoId === orderId);
  assert.ok(Date.parse(fresh.fecha) >= beforeConfirm && Date.parse(fresh.fecha) <= afterConfirm);
  const historicalId = Number(history.insertId);
  assert.equal(items.find(row => row.pedidoId === historicalId).fecha, '2026-08-12T13:00:00.000Z');
  for (const id of [orderId, historicalId]) {
    const response = await request(fixture.auth, '/' + id);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.fecha, items.find(row => row.pedidoId === id).fecha);
  }
});
