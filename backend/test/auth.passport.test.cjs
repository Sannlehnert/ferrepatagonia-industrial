const assert = require('node:assert/strict');
const { test, before, beforeEach, after } = require('node:test');
const { once } = require('node:events');
const { randomBytes, createHmac } = require('node:crypto');
Object.assign(process.env, { JWT_SECRET: randomBytes(32).toString('hex'),
  DB_HOST: '127.0.0.1', DB_PORT: '1', DB_NAME: 'unit', DB_USER: 'unit', DB_PASSWORD: 'unit' });
const jwt = require('jsonwebtoken');
const { Strategy } = require('passport-jwt');
const { app } = require('../dist/app');
const { authPassport, sessionJwtStrategy } = require('../dist/config/passport.config');
const users = require('../dist/repositories/usuario.repository');
const products = require('../dist/services/adminProduct.service');
const clients = require('../dist/services/clientes.service');
const { signToken, verifyToken } = require('../dist/services/token.service');
const { destroyDatabase } = require('../dist/config/database.config');
const { sessionRow } = require('./helpers/session-fixture.cjs');
const routes = require('./helpers/protected-routes.cjs').protectedRoutes();
let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise(r => server.close(r)); await destroyDatabase(); });
beforeEach(t => {
  t.mock.method(users, 'findUsuarioById', async id => sessionRow(id, 'ADMIN'));
  for (const key of ['listAdminProducts', 'getAdminProductById', 'createAdminProduct', 'updateAdminProduct', 'deactivateAdminProduct', 'updateAdminProductStock'])
    t.mock.method(products, key, async () => ({ id_producto: 1 }));
  t.mock.method(clients, 'listClientes', async () => []);
});
async function request(route, token, headers = {}) {
  const response = await fetch(base + route.path, { method: route.method,
    headers: { ...(token ? { Cookie: 'jwt_token=' + encodeURIComponent(token) } : {}),
      ...(route.body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(route.body ? { body: JSON.stringify(route.body) } : {}) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
// Build unsupported claim types without jwt.sign's input validation, using only
// the ephemeral test key. Never print signed tokens in test names or diagnostics.
const signedClaims = claims => {
  const input = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url');
  return input + '.' + createHmac('sha256', process.env.JWT_SECRET).update(input).digest('base64url');
};
const valid = () => signToken({ id: 7, rol: 'ADMIN' });
const invalidTokens = [
  ['absent', undefined], ['malformed', 'invalid'],
  ['expired', jwt.sign({ id: 7, rol: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: -1 })],
  ['without exp', jwt.sign({ id: 7, rol: 'ADMIN' }, process.env.JWT_SECRET)],
  ['null exp', signedClaims({ id: 7, rol: 'ADMIN', exp: null })],
  ['string exp', signedClaims({ id: 7, rol: 'ADMIN', exp: '4102444800' })],
  ['HS384', jwt.sign({ id: 7, rol: 'ADMIN' }, process.env.JWT_SECRET, { algorithm: 'HS384', expiresIn: 120 })],
  ['none', jwt.sign({ id: 7, rol: 'ADMIN' }, '', { algorithm: 'none', expiresIn: 120 })],
  ['wrong key', jwt.sign({ id: 7, rol: 'ADMIN' }, randomBytes(32), { expiresIn: 120 })],
  ['future nbf', jwt.sign({ id: 7, rol: 'ADMIN' }, process.env.JWT_SECRET, { notBefore: 60, expiresIn: 120 })],
  ['invalid id', signedClaims({ id: '7', rol: 'ADMIN', exp: 4102444800 })],
  ['invalid role', signedClaims({ id: 7, rol: 'EMPRESA', exp: 4102444800 })],
  ['tampered', (() => { const parts = valid().split('.'); parts[1] = Buffer.from(JSON.stringify({ id: 8, rol: 'ADMIN', exp: 4102444800 })).toString('base64url'); return parts.join('.'); })()],
];
for (const route of routes) {
  const label = route.method + ' ' + route.path;
  test('Passport ADMIN, exactly one verification and lookup: ' + label, async t => {
    assert.ok(sessionJwtStrategy instanceof Strategy);
    const strategy = t.mock.method(sessionJwtStrategy, 'authenticate');
    const passport = t.mock.method(authPassport, 'authenticate');
    const lookup = users.findUsuarioById;
    const response = await request(route, valid());
    assert.equal(response.status, route.status);
    assert.equal(strategy.mock.callCount(), 1);
    assert.equal(lookup.mock.callCount(), 1);
    assert.deepEqual(lookup.mock.calls[0].arguments, [7]);
    assert.deepEqual(passport.mock.calls[0].arguments.slice(0, 2), ['jwt', { session: false }]);
    assert.equal(response.headers.get('set-cookie'), null);
  });
  test('strategy denial cannot be bypassed: ' + label, async t => {
    const strategy = t.mock.method(sessionJwtStrategy, 'authenticate', function () { this.fail(); });
    const response = await request(route, valid());
    assert.equal(strategy.mock.callCount(), 1);
    assert.equal(response.status, 401);
    assert.equal(users.findUsuarioById.mock.callCount(), 0);
  });
  test('current CLIENTE: ' + label, async t => {
    t.mock.method(users, 'findUsuarioById', async id => sessionRow(id, 'CLIENTE'));
    const response = await request(route, signToken({ id: 7, rol: 'CLIENTE' }));
    assert.equal(response.status, route.publicToClient ? 200 : 403);
    if (!route.publicToClient) assert.deepEqual(response.body, { message: 'El rol autenticado no tiene permiso.' });
  });
  for (const [kind, row] of [['missing', null], ['inactive', sessionRow(7, 'ADMIN', { activo: 0 })], ['changed role', sessionRow(7, 'CLIENTE')]])
    test('401 for ' + kind + ': ' + label, async t => {
      t.mock.method(users, 'findUsuarioById', async () => row);
      const response = await request(route, valid());
      assert.equal(response.status, 401); assert.deepEqual(response.body, { message: 'No autenticado.' });
      for (const key of ['listAdminProducts', 'createAdminProduct', 'updateAdminProduct', 'updateAdminProductStock', 'deactivateAdminProduct', 'getAdminProductById'])
        assert.equal(products[key].mock.callCount(), 0);
      assert.equal(clients.listClientes.mock.callCount(), 0);
    });
  test('controlled DB failure: ' + label, async t => {
    t.mock.method(users, 'findUsuarioById', async () => { throw Object.assign(Error('private-driver-marker'), { status: 401, code: 'ER_DUP_ENTRY', parameters: ['private-parameter'] }); });
    const response = await request(route, valid());
    assert.equal(response.status, 500); assert.deepEqual(response.body, { message: 'Error interno del servidor.' });
  });
  for (const [kind, token] of invalidTokens) test('401 before DB, ' + kind + ': ' + label, async () => {
    const response = await request(route, token);
    assert.equal(response.status, 401); assert.deepEqual(response.body, { message: 'No autenticado.' });
    assert.equal(users.findUsuarioById.mock.callCount(), 0);
  });
}
for (const transport of ['Authorization', 'query', 'body']) test('cookie is the exclusive token transport: ' + transport, async () => {
  let route = routes[0], headers = {};
  if (transport === 'Authorization') headers.Authorization = 'Bearer ' + valid();
  if (transport === 'query') route = { ...route, path: route.path + '?jwt_token=' + valid() };
  if (transport === 'body') route = { method: 'POST', path: '/api/admin/productos', body: { jwt_token: valid() } };
  assert.equal((await request(route, undefined, headers)).status, 401);
});
test('role upgrade also invalidates previously issued CLIENTE token', async t => {
  t.mock.method(users, 'findUsuarioById', async id => sessionRow(id, 'ADMIN'));
  assert.equal((await request(routes[0], signToken({ id: 7, rol: 'CLIENTE' }))).status, 401);
});
test('compatibility verifier requires exp without exposing claims', () => {
  for (const [kind, token] of invalidTokens.filter(([_kind, token]) => token))
    assert.throws(() => verifyToken(token), undefined, kind);
  assert.deepEqual(verifyToken(valid()), { id: 7, rol: 'ADMIN' });
});
