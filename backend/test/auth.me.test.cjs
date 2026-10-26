const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
Object.assign(process.env, { DB_HOST: '127.0.0.1', DB_NAME: 'auth_test', DB_USER: 'test', DB_PASSWORD: 'test' });
const pool = require('./helpers/query-probe.cjs');
const { app } = require('../dist/app');
const { signToken } = require('../dist/services/token.service');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/auth`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
const row = (changes = {}) => ({ id_usuario: 12, email: 'cliente@example.test', rol: 'CLIENTE', activo: 1,
  nombre_razon_social: 'Cliente', tipo_cliente: 'PARTICULAR', password_hash: 'secreto', ...changes });
const get = (token = signToken({ id: 12, rol: 'CLIENTE' })) => fetch(`${base}/me`, {
  headers: token === null ? {} : { Cookie: `jwt_token=${token}` },
});
for (const [rol, tipo] of [['CLIENTE', 'PARTICULAR'], ['CLIENTE', 'EMPRESA'], ['ADMIN', null]]) {
  test(`${rol} ${tipo}: contrato exacto, SQL por id y sin renovar cookie`, async t => {
    let calls = 0;
    t.mock.method(pool, 'query', async (sql, values) => {
      calls++;
      assert.match(sql, /LEFT JOIN `CLIENTE`/);
      assert.match(sql, /WHERE `u`\.`id_usuario` = \?/);
      assert.doesNotMatch(sql, /password_hash|SELECT\s+\*/i);
      assert.deepEqual(values, [12]);
      return [row({ rol, tipo_cliente: tipo, nombre_razon_social: rol === 'ADMIN' ? null : 'Cliente' })];
    });
    const response = await get(signToken({ id: 12, rol }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), { user: {
      id: 12, nombre: rol === 'ADMIN' ? 'Administrador' : 'Cliente',
      email: 'cliente@example.test', rol, tipo_cliente: tipo,
    } });
    assert.equal(calls, 1);
  });
}
for (const [label, token] of [
  ['sin cookie', null], ['JWT inválido', 'invalid'],
  ['JWT expirado', jwt.sign({ id: 12, rol: 'CLIENTE' }, process.env.JWT_SECRET, { expiresIn: -1 })],
]) {
  test(`${label}: 401 sin consultar BD`, async t => {
    t.mock.method(pool, 'query', () => assert.fail('No debe consultar BD'));
    const response = await get(token);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { message: 'No autenticado.' });
  });
}
for (const [label, rows] of [
  ['inexistente', []], ['inactivo', [row({ activo: 0 })]], ['rol desactualizado', [row({ rol: 'ADMIN' })]],
]) {
  test(`${label}: 401`, async t => {
    t.mock.method(pool, 'query', async () => rows);
    const response = await get();
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { message: 'No autenticado.' });
  });
}
test('error de BD: 500 sin detalles internos incluso si contiene status/code', async t => {
  t.mock.method(pool, 'query', async () => { throw Object.assign(new Error('password=secreto'), { code: 'ER_DUP_ENTRY', status: 409 }); });
  const response = await get();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { message: 'Error interno del servidor.' });
});
for (const tipo of ['PARTICULAR', 'EMPRESA', null]) {
  test(`regresión login y coherencia con /me: ${tipo}`, async t => {
    const rol = tipo === null ? 'ADMIN' : 'CLIENTE';
    t.mock.method(pool, 'query', async () => [row({ rol, tipo_cliente: tipo, nombre_razon_social: tipo ? 'Cliente' : null })]);
    t.mock.method(bcrypt, 'compare', async () => true);
    const response = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cliente@example.test', password: 'clave' }) });
    assert.equal(response.status, 200);
    const expected = { id: 12, email: 'cliente@example.test', rol, tipo_cliente: tipo, nombre: tipo ? 'Cliente' : 'Administrador' };
    assert.deepEqual(await response.json(), { message: 'Login exitoso', user: expected });
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const restored = await fetch(`${base}/me`, { headers: { Cookie: cookie } });
    assert.equal(restored.status, 200);
    assert.deepEqual(await restored.json(), { user: expected });
  });
}
