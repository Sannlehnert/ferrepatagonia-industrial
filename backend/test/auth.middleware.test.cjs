const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
const assert = require('node:assert/strict');
const { before, beforeEach, after, test } = require('node:test');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

// Configuración aislada: estas pruebas no acceden a MariaDB.
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.DB_HOST = '127.0.0.1';
process.env.DB_NAME = 'auth_test';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
const { signToken, verifyToken } = require('../dist/services/token.service');
const { authenticate, authorizeRoles } = require('../dist/middlewares/auth.middleware');
const users = require('../dist/repositories/usuario.repository');
const { sessionRow } = require('./helpers/session-fixture.cjs');
beforeEach(t => { t.mock.method(users, 'findUsuarioById', async id => sessionRow(id, 'CLIENTE')); });
let server;
let baseUrl;
let handlerCalls = 0;

before(async () => {
  const app = express();
  app.use(cookieParser());
  app.get('/session', authenticate, (req, res) => res.json(req.auth));
  app.get('/admin', authenticate, authorizeRoles('ADMIN'), (_req, res) => {
    handlerCalls++;
    res.json({ ok: true });
  });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
});

const request = (token, path = '/session') => fetch(`${baseUrl}${path}`, {
  headers: token === undefined ? {} : { Cookie: `jwt_token=${encodeURIComponent(token)}` },
});
const rawToken = (payload, options = {}) => jwt.sign(payload, process.env.JWT_SECRET, {
  algorithm: 'HS256', expiresIn: '2h', ...options,
});

for (const rol of ['CLIENTE', 'ADMIN']) {
  test(`authenticate: ${rol} conserva solamente id y rol`, async t => {
    t.mock.method(users, 'findUsuarioById', async id => sessionRow(id, rol));
    const token = signToken({ id: 7, rol });
    const decoded = jwt.decode(token);
    assert.equal(decoded.exp - decoded.iat, 7200);
    const response = await request(token);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: 7, rol });
  });
}

const valid = rawToken({ id: 7, rol: 'CLIENTE' });
const parts = valid.split('.');
parts[1] = Buffer.from(JSON.stringify({ ...jwt.decode(valid), rol: 'ADMIN' })).toString('base64url');
const invalidTokens = [
  ['sin cookie', undefined],
  ['token manipulado', parts.join('.')],
  ['token expirado', rawToken({ id: 7, rol: 'CLIENTE' }, { expiresIn: -1 })],
  ['token sin exp', jwt.sign({ id: 7, rol: 'CLIENTE' }, process.env.JWT_SECRET, { algorithm: 'HS256' })],
  ['rol EMPRESA', rawToken({ id: 7, rol: 'EMPRESA' })],
  ['sin rol', rawToken({ id: 7 })],
  ['payload string', jwt.sign('texto', process.env.JWT_SECRET)],
  ['algoritmo distinto', rawToken({ id: 7, rol: 'CLIENTE' }, { algorithm: 'HS384' })],
  ['firma con otro secreto', jwt.sign({ id: 7, rol: 'ADMIN' }, randomBytes(32))],
  ['cookie JSON', 'j:{"id":7,"rol":"ADMIN"}'],
  ['token malformado', 'invalid'],
  ...[undefined, null, 0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1].map(id => [
    `id inválido ${id}`, rawToken({ id, rol: 'CLIENTE' }),
  ]),
];
for (const [label, token] of invalidTokens) {
  test(`authenticate: ${label} devuelve 401 con message`, async () => {
    const response = await request(token);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { message: 'No autenticado.' });
  });
}

test('authenticate elimina un contexto previo si falla la autenticación', () => {
  const req = { auth: { id: 1, rol: 'ADMIN' } };
  const res = { status(code) { assert.equal(code, 401); return this; }, json() {} };
  authenticate(req, res, () => assert.fail('No debe continuar'));
  assert.equal(req.auth, undefined);
});

test('authorizeRoles ADMIN devuelve 200 y ejecuta el handler', async t => {
  t.mock.method(users, 'findUsuarioById', async id => sessionRow(id, 'ADMIN'));
  const beforeCalls = handlerCalls;
  const allowed = await request(signToken({ id: 7, rol: 'ADMIN' }), '/admin');
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { ok: true });
  assert.equal(handlerCalls, beforeCalls + 1);
});

test('authorizeRoles CLIENTE devuelve 403 con message sin ejecutar handler', async () => {
  const beforeCalls = handlerCalls;
  const denied = await request(signToken({ id: 7, rol: 'CLIENTE' }), '/admin');
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { message: 'El rol autenticado no tiene permiso.' });
  assert.equal(handlerCalls, beforeCalls);
});

for (const [label, token] of [
  ['sin sesión', undefined],
  ['token inválido', 'invalid'],
  ['token expirado', rawToken({ id: 7, rol: 'ADMIN' }, { expiresIn: -1 })],
]) {
  test(`ruta ADMIN: ${label} devuelve 401 sin ejecutar handler`, async () => {
    const beforeCalls = handlerCalls;
    const response = await request(token, '/admin');
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { message: 'No autenticado.' });
    assert.equal(handlerCalls, beforeCalls);
  });
}

test('authorizeRoles no lee cookies ni vuelve a verificar JWT', (t) => {
  t.mock.method(jwt, 'verify', () => assert.fail('No debe verificar JWT'));
  for (const rol of ['ADMIN', 'CLIENTE']) {
    const req = { auth: { id: 7, rol }, get cookies() { assert.fail('No debe leer cookies'); } };
    let calls = 0;
    let responses = 0;
    const res = {
      status(code) { assert.equal(code, 403); return this; },
      json(body) {
        assert.deepEqual(body, { message: 'El rol autenticado no tiene permiso.' });
        responses++;
      },
    };
    authorizeRoles('ADMIN')(req, res, error => {
      calls++;
      assert.equal(error, undefined);
    });
    assert.equal(calls, rol === 'ADMIN' ? 1 : 0);
    assert.equal(responses, rol === 'ADMIN' ? 0 : 1);
  }
});

test('authorizeRoles permite múltiples roles y sin argumentos devuelve 403', () => {
  for (const rol of ['ADMIN', 'CLIENTE']) {
    const req = { auth: { id: 7, rol } };
    let calls = 0;
    authorizeRoles('ADMIN', 'CLIENTE')(req, {}, error => {
      assert.equal(error, undefined);
      calls++;
    });
    assert.equal(calls, 1);
    let responses = 0;
    const res = {
      status(code) { assert.equal(code, 403); return this; },
      json(body) {
        assert.deepEqual(body, { message: 'El rol autenticado no tiene permiso.' });
        responses++;
      },
    };
    authorizeRoles()(req, res, () => assert.fail('No debe continuar'));
    assert.equal(responses, 1);
  }
});

test('authorizeRoles sin req.auth devuelve 401 aunque haya cookie', () => {
  const req = { cookies: { jwt_token: signToken({ id: 7, rol: 'ADMIN' }) } };
  const res = {
    status(code) { assert.equal(code, 401); return this; },
    json(body) { assert.deepEqual(body, { message: 'No autenticado.' }); },
  };
  authorizeRoles('ADMIN')(req, res, () => assert.fail('No debe continuar'));
  assert.equal(req.auth, undefined);
});

test('JWT_SECRET vacío impide cargar la configuración', () => {
  const result = spawnSync(process.execPath, ['-e', "require('./dist/config/env.config')"], {
    env: { ...process.env, JWT_SECRET: '' }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Falta JWT_SECRET/);
});

test('login emite JWT verificable sin cambiar sus datos públicos', async (t) => {
  const repository = require('../dist/repositories/usuario.repository');
  const bcrypt = require('bcrypt');
  const { pool } = require('../dist/config/catalog-snapshot.config');
  try {
    t.mock.method(repository, 'findUsuarioByEmail', async () => ({
      id_usuario: 7, rol: 'CLIENTE', activo: 1, email: 'login@example.test',
      password_hash: 'hash', tipo_cliente: 'PARTICULAR', nombre_razon_social: 'Cliente',
    }));
    t.mock.method(bcrypt, 'compare', async () => true);
    const { loginUsuario } = require('../dist/services/auth.services');
    const result = await loginUsuario('login@example.test', 'password');
    assert.deepEqual(verifyToken(result.token), { id: 7, rol: 'CLIENTE' });
    assert.deepEqual(result.user, {
      id: 7, email: 'login@example.test', rol: 'CLIENTE', tipo_cliente: 'PARTICULAR', nombre: 'Cliente',
    });
  } finally {
    await pool.end();
  }
});
