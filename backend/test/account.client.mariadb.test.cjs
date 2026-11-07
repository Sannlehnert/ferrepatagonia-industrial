// Integration on #251, not a screen E2E. No route interception or auth stubs.
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
  const body = await response.json();
  return { response, body, status: response.status };
}
for (const path of ['', '/movimientos', '/vencimientos']) {
  test(`Passport real: visitante 401 ${path}`, async () => assert.equal((await http(path, null)).status, 401));
  test(`ADMIN no accede a consulta propia ${path}`, async () => assert.equal((await http(path, c.fixture.admin)).status, 403));
  test(`usuario inactivo 401 ${path}`, async () => assert.equal((await http(path, c.fixture.clients['usuario-inactivo'])).status, 401));
}
test('particular sin cuenta devuelve SIN_CUENTA', async () => {
  const r = await http('', c.fixture.clients.particular);
  assert.equal(r.status, 200); assert.equal(r.body.data.estado, 'SIN_CUENTA');
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
});
for (const path of ['?clienteId=1', '?cuentaId=1', '/movimientos?clienteId=1', '/movimientos?limite=0', '/movimientos?limite=101',
  '/movimientos?cursor=alterado', '/vencimientos?limite=1.5']) test(`validación HTTP ${path}`, async () => assert.equal((await http(path)).status, 400));
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
// Actual contract assertions: expected failures on 406f5ad, retained visibly.
test('#250 cliente inactivo no se transforma en SIN_CUENTA exitoso', async () => {
  assert.ok([401, 403].includes((await http('', c.fixture.clients['cliente-inactivo'])).status));
});
test('#250 lista no vacía debe ejercer movimientos persistidos, orden y cursor', async () => {
  const r = await http('/movimientos?limite=2');
  assert.equal(r.status, 200); assert.equal(r.body.data.items.length, 2);
  assert.deepEqual(r.body.data.items.map(m => m.id), [...c.a.movements].sort((a, b) => b.effective.localeCompare(a.effective) || b.id - a.id).slice(0, 2).map(m => String(m.id)));
  assert.equal(typeof r.body.data.siguienteCursor, 'string');
  const next = await http(`/movimientos?limite=2&cursor=${encodeURIComponent(r.body.data.siguienteCursor)}`);
  assert.equal(next.body.data.corte, r.body.data.corte);
  assert.equal(next.body.data.revision, r.body.data.revision);
  assert.ok(next.body.data.items.every(m => !r.body.data.items.some(n => m.id === n.id)));
});
test('#250 cursor repetido se rechaza, no se ignora', async () => assert.equal((await http('/movimientos?cursor=a&cursor=b')).status, 400));
