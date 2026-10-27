// Native fetch deliberately used: absent-header tests must not acquire a test Origin.
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
Object.assign(process.env, { JWT_SECRET: randomBytes(32).toString('hex'), DB_HOST: '127.0.0.1', DB_PORT: '1', DB_NAME: 'unit', DB_USER: 'unit', DB_PASSWORD: 'unit' });
const { app } = require('../dist/app');
const auth = require('../dist/services/auth.services');
const registration = require('../dist/services/register.service');
const users = require('../dist/repositories/usuario.repository');
const products = require('../dist/services/adminProduct.service');
const { signToken } = require('../dist/services/token.service');
const { destroyDatabase } = require('../dist/config/database.config');
const { sessionRow } = require('./helpers/session-fixture.cjs');
const routes = require('./helpers/protected-routes.cjs').protectedRoutes();
const origin = process.env.APP_PUBLIC_ORIGIN;
let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise(r => server.close(r)); await destroyDatabase(); });
const mutations = [
  { method: 'POST', path: '/api/auth/login', body: { email: 'client@example.test', password: 'test-only' } },
  { method: 'POST', path: '/api/auth/register', body: { tipoCliente: 'PARTICULAR', nombreRazonSocial: 'Test', email: 'client@example.test', password: 'test-only' } },
  { method: 'POST', path: '/api/auth/logout' },
  ...routes.filter(r => !['GET', 'HEAD', 'OPTIONS'].includes(r.method)),
];
async function request(route, headers = {}) {
  return fetch(base + route.path, { method: route.method,
    headers: { Cookie: 'jwt_token=' + signToken({ id: 7, rol: 'ADMIN' }), 'Content-Type': 'application/json', ...headers },
    ...(route.body ? { body: JSON.stringify(route.body) } : {}) });
}
for (const route of mutations) for (const [label, headers] of [
  ['absent', {}], ['external', { Origin: 'https://untrusted.example' }], ['null', { Origin: 'null' }],
  ['misleading prefix', { Origin: origin + '.untrusted.example' }],
  ['mismatched port', { Origin: origin + ':444' }], ['path in origin', { Origin: origin + '/path' }],
  ['cross-site metadata', { Origin: origin, 'Sec-Fetch-Site': 'cross-site' }],
  ['same-site sibling', { Origin: origin, 'Sec-Fetch-Site': 'same-site' }],
  ['external referer', { Referer: 'https://untrusted.example/path' }],
  ['contradictory referer', { Origin: origin, Referer: 'https://untrusted.example/path' }],
]) test('CSRF rejects ' + label + ': ' + route.method + ' ' + route.path, async t => {
  const login = t.mock.method(auth, 'loginUsuario', async () => { throw Error('must not run'); });
  const register = t.mock.method(registration, 'registerClient', async () => { throw Error('must not run'); });
  const lookup = t.mock.method(users, 'findUsuarioById', async () => { throw Error('must not run'); });
  const response = await request(route, headers);
  assert.equal(response.status, 403); assert.deepEqual(await response.json(), { message: 'Origen de solicitud no permitido.' });
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(login.mock.callCount(), 0); assert.equal(register.mock.callCount(), 0); assert.equal(lookup.mock.callCount(), 0);
});
for (const [label, headers] of [['origin', { Origin: origin }], ['referer fallback', { Referer: origin + '/login' }]])
  test('legitimate browser context: ' + label, async t => {
    const login = t.mock.method(auth, 'loginUsuario', async () => ({ user: { id: 7, rol: 'ADMIN' }, token: signToken({ id: 7, rol: 'ADMIN' }) }));
    const response = await request(mutations[0], headers); assert.equal(response.status, 200); assert.equal(login.mock.callCount(), 1); await response.json();
  });
test('metadata fallback requires the canonical Host on the actual HTTP request', async t => {
  t.mock.method(auth, 'loginUsuario', async () => ({ user: { id: 7 }, token: signToken({ id: 7, rol: 'ADMIN' }) }));
  const response = await new Promise((resolve, reject) => {
    const request = require('node:http').request(base + '/api/auth/login', { method: 'POST', headers: {
      Host: new URL(origin).host, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json',
    } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject); request.end(JSON.stringify(mutations[0].body));
  });
  assert.equal(response, 200);
});
test('metadata cannot authorize a request with an unrelated Host or X-Forwarded-Host', async () => {
  const response = await request(mutations[0], { 'Sec-Fetch-Site': 'same-origin', 'X-Forwarded-Host': new URL(origin).host });
  assert.equal(response.status, 403);
});
test('valid origin preserves Passport 401/403 and DTO 400', async t => {
  t.mock.method(users, 'findUsuarioById', async id => sessionRow(id, 'CLIENTE'));
  const client = await fetch(base + '/api/admin/productos/1/stock', { method: 'PATCH', headers: { Origin: origin, Cookie: 'jwt_token=' + signToken({ id: 7, rol: 'CLIENTE' }), 'Content-Type': 'application/json' }, body: JSON.stringify({ stock: 1 }) });
  assert.equal(client.status, 403); assert.deepEqual(await client.json(), { message: 'El rol autenticado no tiene permiso.' });
  const missing = await fetch(base + '/api/admin/productos', { method: 'POST', headers: { Origin: origin } }); assert.equal(missing.status, 401);
  t.mock.method(users, 'findUsuarioById', async id => sessionRow(id, 'ADMIN'));
  const write = t.mock.method(products, 'updateAdminProductStock', async () => { throw Error('must not run'); });
  const invalid = await request({ ...routes.find(r => r.path.endsWith('/stock')), body: { stock: '1' } }, { Origin: origin });
  assert.equal(invalid.status, 400); assert.equal(write.mock.callCount(), 0);
});
for (const [label, headers, status] of [['foreign', { Origin: 'https://untrusted.example', 'Access-Control-Request-Method': 'POST' }, 403], ['same origin', { Origin: origin, 'Access-Control-Request-Method': 'POST' }, 200], ['absent', {}, 200]])
  test('preflight ' + label + ' never enables external CORS', async () => {
    const r = await fetch(base + '/api/auth/login', { method: 'OPTIONS', headers }); assert.equal(r.status, status);
    assert.equal(r.headers.get('access-control-allow-origin'), null); assert.equal(r.headers.get('access-control-allow-credentials'), null); await r.text();
  });
