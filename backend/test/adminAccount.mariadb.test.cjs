// Real Passport + HTTP + TypeORM + MariaDB. Verifies the blocked boundary, not financial acceptance.
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
assert.equal(process.env.DB_HOST, '127.0.0.1');
assert.match(process.env.ADMIN_ACCOUNT_TEST_DATABASE, /^e2e_test_[a-f0-9]{32}$/);
assert.equal(process.env.DB_NAME, process.env.ADMIN_ACCOUNT_TEST_DATABASE);
const database = require('../dist/config/database.config');
const { app } = require('../dist/app');
const { signToken } = require('../dist/services/token.service');
const jwt = require('jsonwebtoken');
let server, url;
const admin = signToken({ id: 1, rol: 'ADMIN' }), client = signToken({ id: 2, rol: 'CLIENTE' });
before(async () => {
  await database.dataSource.initialize();
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  url = `http://127.0.0.1:${server.address().port}/api/admin`;
});
after(async () => { if (server) await new Promise(r => server.close(r)); await database.destroyDatabase(); });
async function read(path, token = admin) {
  const response = await fetch(url + path, { headers: token ? { Cookie: `jwt_token=${token}` } : {} });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('vary'), /Cookie/i);
  return { status: response.status, body: await response.json() };
}
const routes = ['/cuentas-corrientes', '/clientes/1/cuenta-corriente',
  '/clientes/1/cuenta-corriente/movimientos', '/clientes/1/cuenta-corriente/vencimientos'];
for (const route of routes) {
  test(`ADMIN: dependencia ausente 503 sin datos ${route}`, async () => {
    const r = await read(route); assert.equal(r.status, 503); assert.equal(r.body.code, 'CUENTA_CORRIENTE_NO_DISPONIBLE'); assert.equal(r.body.data, undefined);
  });
  for (const [name, token, status] of [['visitante', null, 401], ['CLIENTE', client, 403], ['token inválido', 'invalid', 401],
    ['token expirado', jwt.sign({ id: 1, rol: 'ADMIN', exp: 1 }, process.env.JWT_SECRET), 401]]) {
    test(`${name} ${status} ${route}`, async () => assert.equal((await read(route, token)).status, status));
  }
  test(`usuario ADMIN inactivo 401 ${route}`, async () => {
    await database.dataSource.query('UPDATE USUARIO SET activo=0 WHERE id_usuario=1');
    try { assert.equal((await read(route)).status, 401); }
    finally { await database.dataSource.query('UPDATE USUARIO SET activo=1 WHERE id_usuario=1'); }
  });
}
for (const query of ['limite=0', 'limite=101', 'limite=25&limite=25', 'cursor=a&cursor=b', 'cursor=alterado',
  'habilitada=0', 'habilitada=true&habilitada=false', 'clienteId=2147483648', 'cuentaId=1', 'rol=ADMIN']) {
  test(`400 con privacidad ${query}`, async () => {
    const r = await read('/cuentas-corrientes?' + query); assert.equal(r.status, 400); assert.equal(r.body.code, 'CONSULTA_INVALIDA');
  });
}
test('validación del rol precede a validación y resolución de destino', async () => {
  assert.equal((await read('/clientes/2147483648/cuenta-corriente', client)).status, 403);
  assert.equal((await read('/clientes/2147483647/cuenta-corriente', client)).status, 403);
  assert.equal((await read('/clientes/2147483648/cuenta-corriente')).status, 400);
  assert.equal((await read('/clientes/2147483647/cuenta-corriente')).status, 404);
});
test('privacidad conserva el matching case-insensitive del router Express', async () => {
  assert.equal((await read('/CUENTAS-CORRIENTES', null)).status, 401);
  assert.equal((await read('/CLIENTES/1/CUENTA-CORRIENTE')).status, 503);
});
test('ADMIN puede resolver clientes distintos e inactivos; no se inventa SIN_CUENTA', async () => {
  await database.dataSource.query('UPDATE CLIENTE SET activo=0 WHERE id_cliente=2');
  try {
    assert.equal((await read('/clientes/2/cuenta-corriente')).status, 503);
    assert.equal((await read('/clientes/3/cuenta-corriente')).status, 503);
  } finally { await database.dataSource.query('UPDATE CLIENTE SET activo=1 WHERE id_cliente=2'); }
});
test('error SQL real sanitizado sin tabla/consulta/credenciales', async () => {
  await database.dataSource.query('RENAME TABLE CLIENTE TO DEMO_CLIENTE_UNAVAILABLE');
  try {
    const r = await read('/clientes/1/cuenta-corriente'); assert.equal(r.status, 500);
    assert.equal(r.body.data, undefined); assert.doesNotMatch(JSON.stringify(r.body), /SELECT|CLIENTE|password|stack|ER_/);
  } finally { await database.dataSource.query('RENAME TABLE DEMO_CLIENTE_UNAVAILABLE TO CLIENTE'); }
});
test('login y logout reales, sin permisos derivados de headers del navegador', async () => {
  const base = url.replace('/admin', '/auth');
  const login = await fetch(base + '/login', { method: 'POST', headers: { Origin: 'http://browser.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'cliente@e2e.test', password: 'E2eLocal-214!' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const rejected = await fetch(url + '/cuentas-corrientes', { headers: { Cookie: cookie, rol: 'ADMIN', clienteId: '1' } });
  assert.equal(rejected.status, 403);
  assert.equal((await fetch(base + '/logout', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://browser.test' } })).status, 200);
});
