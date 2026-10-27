const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
require('./helpers/integration-lifecycle.cjs');
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { app } = require('../dist/app');
const { dataSource } = require('../dist/config/database.config');
const { pool } = require('../dist/config/catalog-snapshot.config');
const users = require('../dist/repositories/usuario.repository');
const { signToken } = require('../dist/services/token.service');
const { sessionJwtStrategy } = require('../dist/config/passport.config');
const { createAuthUser } = require('./helpers/auth-user.cjs');
const { startHttpApp } = require('./helpers/start-http-app.cjs');
const { productionHttpEnv } = require('./helpers/production-http-env.cjs');
let server, base, admin, client, categoryId, productId, routes;
before(async () => {
  admin = await createAuthUser(pool);
  client = await createAuthUser(pool, 'CLIENTE');
  const category = await pool.query("INSERT INTO CATEGORIA(nombre,activo) VALUES ('Auth security 217',1)");
  categoryId = Number(category.insertId);
  const product = await pool.query("INSERT INTO PRODUCTO(id_categoria,codigo,nombre,precio,stock,activo) VALUES (?,'AUTH-SECURITY-217','Security fixture',1,1,1)", [categoryId]);
  productId = Number(product.insertId);
  routes = require('./helpers/protected-routes.cjs').protectedRoutes(productId, categoryId);
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  try {
    if (server) await new Promise(r => server.close(r));
    if (categoryId) { await pool.query('DELETE FROM PRODUCTO WHERE id_categoria = ?', [categoryId]); await pool.query('DELETE FROM CATEGORIA WHERE id_categoria = ?', [categoryId]); }
    if (admin) await admin.destroy(); if (client) await client.destroy();
  } finally { await pool.end(); }
});
async function send(route, cookie, headers = {}) {
  const response = await fetch(base + route.path, { method: route.method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(route.body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(route.body ? { body: JSON.stringify(route.body) } : {}) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
const productSnapshot = async () => JSON.stringify(await pool.query('SELECT * FROM PRODUCTO WHERE id_categoria = ? ORDER BY id_producto', [categoryId]));

test('real ADMIN crosses Passport exactly once on every protected method/path', async t => {
  for (const route of routes) await t.test(route.method + ' ' + route.path, async t => {
    const strategy = t.mock.method(sessionJwtStrategy, 'authenticate');
    const lookup = t.mock.method(users, 'findUsuarioById'); // delegates to real TypeORM
    const response = await send(route, admin.cookie);
    assert.equal(response.status, route.status);
    assert.equal(strategy.mock.callCount(), 1); assert.equal(lookup.mock.callCount(), 1);
    assert.deepEqual(lookup.mock.calls[0].arguments, [admin.id]);
    assert.equal(response.headers.get('set-cookie'), null);
  });
});
test('real CLIENTE receives 403 in ADMIN and 200 in me, without product writes', async t => {
  const before = await productSnapshot();
  for (const route of routes) await t.test(route.method + ' ' + route.path, async () => {
    const response = await send(route, client.cookie);
    assert.equal(response.status, route.publicToClient ? 200 : 403);
    if (!route.publicToClient) assert.deepEqual(response.body, { message: 'El rol autenticado no tiene permiso.' });
  });
  assert.equal(await productSnapshot(), before);
});
for (const state of ['inactive', 'deleted', 'downgraded', 'upgraded']) test('real session revalidated after user is ' + state, async t => {
  const fixture = await createAuthUser(pool, state === 'upgraded' ? 'CLIENTE' : 'ADMIN');
  let changedClientId;
  try {
    assert.equal((await send(routes[0], fixture.cookie)).status, 200);
    if (state === 'inactive') await pool.query('UPDATE USUARIO SET activo = 0 WHERE id_usuario = ?', [fixture.id]);
    if (state === 'deleted') await pool.query('DELETE FROM USUARIO WHERE id_usuario = ?', [fixture.id]);
    if (state === 'upgraded') await pool.query("UPDATE USUARIO SET rol = 'ADMIN', id_cliente = NULL WHERE id_usuario = ?", [fixture.id]);
    if (state === 'downgraded') {
      const c = await pool.query("INSERT INTO CLIENTE(tipo_cliente,nombre_razon_social,es_fiel,activo) VALUES ('PARTICULAR','Role change fixture',0,1)");
      changedClientId = Number(c.insertId);
      await pool.query("UPDATE USUARIO SET rol = 'CLIENTE', id_cliente = ? WHERE id_usuario = ?", [changedClientId, fixture.id]);
    }
    const before = await productSnapshot();
    for (const route of routes) await t.test(route.method + ' ' + route.path, async () => {
      const response = await send(route, fixture.cookie);
      assert.equal(response.status, 401); assert.deepEqual(response.body, { message: 'No autenticado.' });
    });
    assert.equal(await productSnapshot(), before, 'A rejected session cannot modify products');
  } finally {
    await fixture.destroy();
    if (changedClientId) await pool.query('DELETE FROM CLIENTE WHERE id_cliente = ?', [changedClientId]);
  }
});
for (const kind of ['absent', 'invalid', 'expired', 'without exp', 'HS384', 'wrong key', 'tampered']) test('real HTTP rejects ' + kind + ' before lookup', async t => {
  let token;
  const claims = { id: admin.id, rol: 'ADMIN' };
  if (kind === 'invalid') token = 'invalid';
  if (kind === 'expired') token = jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: -1 });
  if (kind === 'without exp') token = jwt.sign(claims, process.env.JWT_SECRET);
  if (kind === 'HS384') token = jwt.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS384', expiresIn: 120 });
  if (kind === 'wrong key') token = jwt.sign(claims, randomBytes(32), { expiresIn: 120 });
  if (kind === 'tampered') {
    const parts = signToken(claims).split('.'); parts[1] = Buffer.from(JSON.stringify({ ...claims, id: admin.id + 1, exp: 4102444800 })).toString('base64url'); token = parts.join('.');
  }
  const before = await productSnapshot();
  for (const route of routes) await t.test(route.method + ' ' + route.path, async t => {
    const lookup = t.mock.method(users, 'findUsuarioById');
    const response = await send(route, token ? 'jwt_token=' + encodeURIComponent(token) : undefined);
    assert.equal(response.status, 401); assert.deepEqual(response.body, { message: 'No autenticado.' });
    assert.equal(lookup.mock.callCount(), 0);
  });
  assert.equal(await productSnapshot(), before);
});
test('real identity pool saturation produces controlled 500 and recovers', async t => {
  const before = await productSnapshot();
  const runners = Array.from({ length: 5 }, () => dataSource.createQueryRunner());
  try {
    await Promise.all(runners.map(r => r.connect()));
    for (const route of routes) await t.test(route.method + ' ' + route.path, async () => {
      const response = await send(route, admin.cookie);
      assert.equal(response.status, 500); assert.deepEqual(response.body, { message: 'Error interno del servidor.' });
      assert.equal(response.headers.get('set-cookie'), null);
    });
  } finally { await Promise.all(runners.map(r => r.release())); }
  assert.equal(await productSnapshot(), before);
  assert.equal((await send(routes[0], admin.cookie)).status, 200);
});
test('real login/me/logout preserve cookie flags, TTL, public JSON and no refresh', async t => {
  for (const mode of ['development', 'production']) await t.test(mode, async () => {
    // Fresh process: cookie mode is validated once at startup, never changed via
    // process.env after the server is initialized. Real accounts/DB in both modes.
    const options = mode === 'production' ? productionHttpEnv() : { NODE_ENV: mode };
    const worker = await startHttpApp({ ...options, HTTP_TEST_DATABASE: '1', JWT_SECRET: randomBytes(32).toString('hex') });
    const call = async (route, cookie) => {
      const r = await fetch(worker.base + route.path, { method: route.method, headers: {
        Origin: options.APP_PUBLIC_ORIGIN ?? process.env.APP_PUBLIC_ORIGIN,
        ...(mode === 'production' ? { 'X-Forwarded-Proto': 'https' } : {}),
        ...(cookie ? { Cookie: cookie } : {}), ...(route.body ? { 'Content-Type': 'application/json' } : {}),
      }, ...(route.body ? { body: JSON.stringify(route.body) } : {}) });
      return { status: r.status, body: await r.json(), headers: r.headers };
    };
    try {
      const login = await call({ method: 'POST', path: '/api/auth/login', body: { email: admin.email, password: admin.password } });
      assert.equal(login.status, 200);
      assert.deepEqual(login.body, { message: 'Login exitoso', user: { id: admin.id, email: admin.email, rol: 'ADMIN', tipo_cliente: null, nombre: 'Administrador' } });
      const set = login.headers.get('set-cookie');
      for (const pattern of [/HttpOnly/, /SameSite=Strict/, /Path=\//, /Max-Age=7200/]) assert.ok(pattern.test(set), 'Required cookie flag missing');
      assert.equal(/; Secure/i.test(set), mode === 'production'); assert.equal(/Domain=/i.test(set), false);
      const cookie = set.split(';')[0];
      const decoded = jwt.decode(cookie.slice(cookie.indexOf('=') + 1));
      assert.equal(decoded.exp - decoded.iat, 7200);
      const me = await call(routes[0], cookie);
      assert.deepEqual(me.body, { user: login.body.user }); assert.equal(me.headers.get('set-cookie'), null);
      const logout = await call({ method: 'POST', path: '/api/auth/logout' }, cookie);
      assert.equal(logout.status, 200); assert.deepEqual(logout.body, { message: 'Sesión cerrada correctamente' });
      const clear = logout.headers.get('set-cookie');
      for (const pattern of [/jwt_token=;/, /Expires=Thu, 01 Jan 1970/, /Path=\//, /HttpOnly/, /SameSite=Strict/]) assert.ok(pattern.test(clear), 'Required clear-cookie flag missing');
      assert.equal(/; Secure/i.test(clear), mode === 'production');
      assert.equal((await call(routes[0])).status, 401); // browser applies cookie deletion
      assert.equal((await call(routes[0], cookie)).status, 200); // persistent revocation is out of scope
    } finally { await worker.close(); }
  });
});
