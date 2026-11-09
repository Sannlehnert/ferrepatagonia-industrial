// Real Express and Passport requests against the #253 disposable fixture.
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { once } = require('node:events');
const { accountContext } = require('./helpers/account-test-context.cjs');
const c = accountContext();
let server, url, signToken;
before(async () => {
  const { app } = require('../dist/app');
  ({ signToken } = require('../dist/services/token.service'));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  url = `http://127.0.0.1:${server.address().port}/api/cuenta-corriente`;
});
after(async () => { if (server) await new Promise(r => server.close(r)); });
async function http(suffix = '', user = c.a, options = {}) {
  const token = user ? signToken({ id: user.userId, rol: user === c.fixture.admin ? 'ADMIN' : 'CLIENTE' }) : null;
  const response = await fetch(url + suffix, { headers: token ? { Cookie: `jwt_token=${token}` } : {}, ...options });
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
  assert.match(response.headers.get('vary'), /(?:^|,\s*)Cookie(?:,|$)/i);
  const body = await response.json();
  return { response, body, status: response.status };
}
for (const path of ['', '/movimientos', '/vencimientos']) {
  test(`Passport real: visitante 401 ${path}`, async () => assert.equal((await http(path, null)).status, 401));
  test(`ADMIN no accede a consulta propia ${path}`, async () => assert.equal((await http(path, c.fixture.admin)).status, 403));
  test(`usuario inactivo 401 ${path}`, async () => assert.equal((await http(path, c.fixture.clients['usuario-inactivo'])).status, 401));
}
for (const key of ['particular', 'empresa-sin-cuenta']) test(key + ' recibe SIN_CUENTA en las tres consultas', async () => {
  for (const path of ['', '/movimientos', '/vencimientos']) {
    const r = await http(path, c.fixture.clients[key]);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.estado, 'SIN_CUENTA');
    assert.equal(r.body.data.items, undefined);
  }
});
test('identidades A y B resuelven cuentas distintas desde JWT', async () => {
  const a = await http(), b = await http('', c.fixture.clients.empresa60);
  assert.equal(a.body.data.cuentaId, c.a.accountId);
  assert.equal(b.body.data.cuentaId, c.fixture.clients.empresa60.accountId);
  assert.notEqual(a.body.data.cuentaId, b.body.data.cuentaId);
});
test('cuenta inhabilitada conserva lectura histórica', async () => {
  const r = await http('', c.fixture.clients.inhabilitada);
  assert.equal(r.status, 200); assert.equal(r.body.data.estado, 'INHABILITADA');
  assert.equal(r.body.data.saldo, '70.00');
  assert.equal(r.body.data.disponible, '0.00');
  assert.equal(r.body.data.estadoCredito, 'BLOQUEADO');
  const history = await http('/movimientos', c.fixture.clients.inhabilitada);
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.data.items.map(m => [m.id, m.importe]), [
    [String(c.fixture.clients.inhabilitada.movements[0].id), '70.00'],
  ]);
});
for (const path of ['?clienteId=1', '?cuentaId=1', '/movimientos?clienteId=1', '/movimientos?limite=0', '/movimientos?limite=101',
  '/movimientos?cursor=alterado', '/vencimientos?limite=1.5', '/vencimientos?limite=1&limite=2',
  '/movimientos?cursor=', '/vencimientos?clienteId=1']) test(`validación HTTP ${path}`, async () => {
  const r = await http(path);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'CONSULTA_INVALIDA');
});
test('cabeceras privadas en consulta exitosa y error', async () => {
  for (const path of ['', '?clienteId=1']) {
    const { response } = await http(path);
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
    assert.match(response.headers.get('vary'), /Cookie/i);
  }
});
test('cuenta realmente vacía devuelve items vacíos y cursor final', async () => {
  const r = await http('/movimientos', c.fixture.clients.vacia);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.items, []); assert.equal(r.body.data.siguienteCursor, null);
});
test('sesión expirada es rechazada por Passport', async () => {
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id: c.a.userId, rol: 'CLIENTE', exp: 1 }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  assert.equal((await http('', null, { headers: { Cookie: `jwt_token=${token}` } })).status, 401);
});
test('login/logout/login A → B resuelve el titular actual en backend', async () => {
  const authUrl = url.replace('/cuenta-corriente', '/auth');
  const login = async user => {
    const response = await fetch(authUrl + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://browser.test' },
      body: JSON.stringify({ email: user.email, password: c.fixture.password }) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const cookieA = await login(c.a);
  const a = await http('', null, { headers: { Cookie: cookieA } });
  assert.equal(a.body.data.cuentaId, c.a.accountId);
  const logout = await fetch(authUrl + '/logout', { method: 'POST', headers: { Cookie: cookieA, Origin: 'http://browser.test' } });
  assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /jwt_token=;/);
  assert.equal((await http('', null)).status, 401);
  const cookieB = await login(c.fixture.clients.empresa60);
  const b = await http('', null, { headers: { Cookie: cookieB } });
  assert.equal(b.body.data.cuentaId, c.fixture.clients.empresa60.accountId);
});
test('fallo real de lectura no se presenta como lista vacía exitosa', async () => {
  await c.db.query('RENAME TABLE CUENTA_CORRIENTE TO DEMO_ACCOUNT_UNAVAILABLE');
  try {
    const r = await http('/movimientos');
    assert.equal(r.status, 500); assert.equal(r.body.data, undefined);
  } finally { await c.db.query('RENAME TABLE DEMO_ACCOUNT_UNAVAILABLE TO CUENTA_CORRIENTE'); }
});
test('#250 cliente inactivo no se transforma en SIN_CUENTA exitoso', async () => {
  for (const path of ['', '/movimientos', '/vencimientos']) {
    const r = await http(path, c.fixture.clients['cliente-inactivo']);
    assert.ok([401, 403].includes(r.status));
    assert.equal(r.body.data, undefined);
  }
});
test('movimientos recorren cada ID una vez con empate de fecha y saldo acumulado', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(c.fixture.cut) });
  const summary = (await http()).body.data;
  const expectedBalances = ['100.00', '100.00', '300.00', '350.00', '225.00', '225.00'];
  const expected = c.a.movements.map((item, index) => ({
    id: String(item.id), fechaOperacion: item.effective, importe: item.amount,
    saldoResultante: expectedBalances[index], estado: item.state === 'ANULADO' ? 'ANULADO' : 'VIGENTE',
    moneda: 'USD', origen: 'DEMO',
    referencia: item.type === 'CARGO' ? { pedidoId: item.orderId } : { pagoId: item.paymentId },
  })).reverse();
  let cursor;
  for (const item of expected) {
    const r = await http(page('/movimientos', 1, cursor));
    assert.equal(r.status, 200);
    const data = r.body.data;
    assert.equal(data.corte, c.fixture.cut);
    assert.equal(data.revision, summary.revision);
    assert.equal(data.items.length, 1);
    const { tipo, concepto, plazoDias, venceEl, ...actual } = data.items[0];
    assert.deepEqual(actual, item);
    assert.equal(typeof concepto, 'string');
    if (tipo === 'ABONO') assert.deepEqual([plazoDias, venceEl], [null, null]);
    else assert.equal(plazoDias, 30);
    cursor = data.siguienteCursor;
    if (item !== expected.at(-1)) assert.equal(typeof cursor, 'string');
  }
  assert.equal(cursor, null);
});
test('#250 cursor repetido se rechaza, no se ignora', async () => assert.equal((await http('/movimientos?cursor=a&cursor=b')).status, 400));

function page(route, limit, cursor) {
  return route + '?limite=' + limit + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
}

test('resúmenes DEMO concilian saldos, cobertura, crédito y vencimientos', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(c.fixture.cut) });
  for (const [key, expected] of [
    ['empresa30', ['225.00', '1000.00', '775.00', 30, 'COMPLETA', 'DISPONIBLE', '0.00', '225.00']],
    ['empresa60', ['500.00', '2000.00', '1500.00', 60, 'COMPLETA', 'DISPONIBLE', '500.00', '0.00']],
    ['favor', ['-150.00', '100.00', '100.00', 30, 'COMPLETA', 'DISPONIBLE', '0.00', '0.00']],
    ['vacia', ['0.00', '300.00', '300.00', 30, 'COMPLETA', 'DISPONIBLE', '0.00', '0.00']],
    ['cero', ['0.00', '0.00', '0.00', 30, 'COMPLETA', 'BLOQUEADO', '0.00', '0.00']],
    ['pendiente', ['0.00', '400.00', '0.00', 30, 'COMPLETA', 'BLOQUEADO', '0.00', '0.00']],
    ['incompleta', [null, null, null, 30, 'NO_ACREDITADA', 'NO_DETERMINABLE', null, null]],
    ['parcial', [null, '700.00', null, 30, 'PARCIAL', 'NO_DETERMINABLE', null, null]],
  ]) {
    const client = c.fixture.clients[key];
    const r = await http('', client);
    assert.equal(r.status, 200, key);
    const s = r.body.data;
    assert.equal(s.cuentaId, client.accountId);
    assert.deepEqual([s.origen, s.moneda], ['DEMO', 'USD']);
    assert.deepEqual([s.saldo, s.limite, s.disponible, s.plazoDias, s.cobertura, s.estadoCredito,
      s.deudaVencidaTotal, s.deudaPorVencerTotal], expected, key);
  }
});

test('vencimientos incluyen hoy y futuros, excluyen cancelados y anulados, preservan corte', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(c.fixture.cut) });
  const route = '/vencimientos';
  const first = await http(page(route, 1));
  assert.equal(first.status, 200);
  const a = first.body.data;
  assert.deepEqual(a.items, [
    { movimientoId: String(c.a.movements[2].id), venceEl: '2026-03-03', plazoDias: 30,
      moneda: 'USD', pendiente: '175.00', estado: 'POR_VENCER', origen: 'DEMO' },
  ]);
  assert.equal(typeof a.siguienteCursor, 'string');
  t.mock.timers.setTime(Date.parse('2026-03-04T03:00:00Z'));
  const second = await http(page(route, 1, a.siguienteCursor));
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.data.items, [
    { movimientoId: String(c.a.movements[3].id), venceEl: '2026-04-01', plazoDias: 30,
      moneda: 'USD', pendiente: '50.00', estado: 'POR_VENCER', origen: 'DEMO' },
  ]);
  assert.deepEqual([second.body.data.corte, second.body.data.revision, second.body.data.siguienteCursor],
    [a.corte, a.revision, null]);
  assert.equal((await http(route)).body.data.items[0].estado, 'VENCIDO');
  const other = await http(route, c.fixture.clients.empresa60);
  assert.equal(other.status, 200);
  assert.deepEqual(other.body.data.items.map(v => [v.venceEl, v.pendiente, v.estado]), [['2026-03-02', '500.00', 'VENCIDO']]);
  const partial = await http(route, c.fixture.clients.parcial);
  assert.equal(partial.status, 200);
  assert.deepEqual(partial.body.data.items.map(v => [v.venceEl, v.pendiente, v.estado]), [['2026-03-03', null, 'NO_DETERMINABLE']]);
  const partialHistory = await http('/movimientos', c.fixture.clients.parcial);
  assert.equal(partialHistory.status, 200);
  assert.deepEqual(partialHistory.body.data.items.map(m => m.saldoResultante), [null]);
});

test('vencimientos con la misma fecha avanzan por ID ascendente', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(c.fixture.cut) });
  const client = c.fixture.clients.vacia;
  const first = await c.charge(client, '1.00');
  const second = await c.charge(client, '2.00');
  const initial = await http(page('/vencimientos', 1), client);
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body.data.items.map(v => [v.movimientoId, v.venceEl]), [[String(first), '2026-04-02']]);
  const next = await http(page('/vencimientos', 1, initial.body.data.siguienteCursor), client);
  assert.equal(next.status, 200);
  assert.deepEqual(next.body.data.items.map(v => [v.movimientoId, v.venceEl]), [[String(second), '2026-04-02']]);
  assert.equal(next.body.data.siguienteCursor, null);
});

test('default 25, máximo 100 y última página preservan el total de movimientos', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(c.fixture.cut) });
  const client = c.fixture.clients.vacia;
  const ids = [];
  for (let n = 0; n < 105; n++) ids.unshift(String(await c.charge(client, '0.01')));
  const r = await http('/movimientos', client);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.items.map(m => m.id), ids.slice(0, 25));
  const full = await http(page('/movimientos', 100), client);
  assert.equal(full.status, 200);
  assert.deepEqual(full.body.data.items.map(m => m.id), ids.slice(0, 100));
  const tail = await http(page('/movimientos', 100, full.body.data.siguienteCursor), client);
  assert.equal(tail.status, 200);
  assert.deepEqual(tail.body.data.items.map(m => m.id), ids.slice(100));
  assert.equal(tail.body.data.siguienteCursor, null);
});

test('cursor emitido se rechaza al alterarlo, cambiar titular, alcance o filtros', async () => {
  const issued = await http(page('/movimientos', 1));
  assert.equal(issued.status, 200);
  const cursor = issued.body.data.siguienteCursor;
  assert.equal(typeof cursor, 'string');
  const [payload, signature] = cursor.split('.');
  const tampered = payload + '.' + (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
  for (const [url, user] of [
    [page('/movimientos', 1, tampered), c.a],
    [page('/movimientos', 1, cursor), c.fixture.clients.empresa60],
    [page('/vencimientos', 1, cursor), c.a],
    [page('/movimientos', 1, cursor) + '&habilitada=true', c.a],
  ]) {
    const r = await http(url, user);
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'CONSULTA_INVALIDA');
    assert.equal(r.body.data, undefined);
  }
});

test('cursor vencido emite 409 luego de 24 horas con revisión estable', async t => {
  const start = Date.parse(c.fixture.cut);
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const issued = await http(page('/movimientos', 1));
  assert.equal(issued.status, 200);
  const next = page('/movimientos', 1, issued.body.data.siguienteCursor);
  t.mock.timers.setTime(start + 86400000);
  assert.equal((await http(next)).status, 200);
  t.mock.timers.setTime(start + 86400001);
  const r = await http(next);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'CONSULTA_DESACTUALIZADA');
});

test('un cambio financiero ajeno conserva el cursor y un cambio propio emite 409', async () => {
  const issued = await http(page('/movimientos', 1));
  assert.equal(issued.status, 200);
  const next = page('/movimientos', 1, issued.body.data.siguienteCursor);
  await c.charge(c.fixture.clients.empresa60, '1.00');
  const unchanged = await http(next);
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.body.data.revision, issued.body.data.revision);
  await c.charge(c.a, '1.00');
  const r = await http(next);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'CONSULTA_DESACTUALIZADA');
});
