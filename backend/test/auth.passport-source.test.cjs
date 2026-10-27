// Exercise the real source app with tsx; replace only the TypeORM driver boundary.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
Object.assign(process.env, { JWT_SECRET: randomBytes(32).toString('hex'), DB_HOST: '127.0.0.1', DB_PORT: '1', DB_NAME: 'unit', DB_USER: 'unit', DB_PASSWORD: 'unit' });
const { app } = require('../src/app.ts');
const { dataSource, destroyDatabase } = require('../src/config/database.config.ts');
const { sessionJwtStrategy } = require('../src/config/passport.config.ts');
const { signToken } = require('../src/services/token.service.ts');
const { sessionRow } = require('./helpers/session-fixture.cjs');

test('tsx source app: Passport actually protects me and nested admin methods with current identity', async t => {
  await dataSource.buildMetadatas();
  let active = 1, queries = 0;
  t.mock.method(dataSource, 'createQueryRunner', () => ({
    query: async (sql, params) => {
      queries++; assert.doesNotMatch(sql, /password_hash/); assert.deepEqual(params, [1]);
      return { records: [sessionRow(1, 'ADMIN', { activo: active })] };
    }, release: async () => {}, isTransactionActive: false,
  }));
  const strategy = t.mock.method(sessionJwtStrategy, 'authenticate');
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const cookie = 'jwt_token=' + signToken({ id: 1, rol: 'ADMIN' });
  try {
    const me = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/me`, { headers: { Cookie: cookie } });
    assert.equal(me.status, 200); const json = await me.json();
    assert.equal(json.user.rol, 'ADMIN'); assert.equal(queries, 1); assert.equal(strategy.mock.callCount(), 1);
    active = 0;
    for (const [method, path] of [['GET', '/api/auth/me'], ['POST', '/api/admin/productos'], ['PUT', '/api/admin/productos/1'], ['PATCH', '/api/admin/productos/1/stock'], ['GET', '/api/admin/unknown']]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { Cookie: cookie } });
      assert.equal(response.status, 401); assert.deepEqual(await response.json(), { message: 'No autenticado.' });
    }
    assert.equal(queries, 6); assert.equal(strategy.mock.callCount(), 6);
  } finally { await new Promise(r => server.close(r)); await destroyDatabase(); }
});
