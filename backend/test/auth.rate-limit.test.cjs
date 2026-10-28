const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const express = require('express');
const { MemoryStore } = require('express-rate-limit');
const { authRateLimiter } = require('../dist/middlewares/auth-rate-limit.middleware');
const { startHttpApp } = require('./helpers/start-http-app.cjs');
const fixture = { JWT_SECRET: randomBytes(32).toString('hex'), DB_HOST: '127.0.0.1', DB_PORT: '1', DB_NAME: 'unit', DB_USER: 'unit', DB_PASSWORD: 'unit',
  HTTP_TEST_SERVICE_STUBS: '1', AUTH_LOGIN_LIMIT: '2', AUTH_REGISTER_LIMIT: '3', AUTH_LOGIN_WINDOW_MS: '60000', AUTH_REGISTER_WINDOW_MS: '60000' };
const input = path => path === 'login' ? { email: 'limit@example.test', password: 'not-a-key' }
  : { tipoCliente: 'PARTICULAR', nombreRazonSocial: 'Rate fixture', email: 'limit@example.test', password: 'not-a-key' };
async function send(worker, endpoint, headers = {}) {
  const r = await fetch(worker.base + '/api/auth/' + endpoint, { method: 'POST', headers: { Origin: process.env.APP_PUBLIC_ORIGIN, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input(endpoint)) });
  return { status: r.status, body: await r.json(), retry: r.headers.get('retry-after') };
}
test('login and registration quotas are separate, and 429 precedes expensive services', async () => {
  const worker = await startHttpApp(fixture);
  try {
    for (const [endpoint, limit, success] of [['login', 2, 200], ['register', 3, 201]]) {
      for (let i = 0; i < limit; i++) assert.equal((await send(worker, endpoint)).status, success);
      const denied = await send(worker, endpoint); assert.equal(denied.status, 429);
      assert.deepEqual(denied.body, { message: 'Demasiadas solicitudes. Intente nuevamente más tarde.' });
      assert.match(denied.retry, /^[1-9][0-9]*$/);
    }
    assert.deepEqual(await worker.stats(), { login: 2, register: 3 });
  } finally { await worker.close(); }
});
test('same account from different verified client IPs is not globally locked', async () => {
  const worker = await startHttpApp({ ...fixture, AUTH_LOGIN_LIMIT: '1', TRUSTED_PROXY_CIDRS: '127.0.0.1/32' });
  try {
    assert.equal((await send(worker, 'login', { 'X-Forwarded-For': '198.51.100.1' })).status, 200);
    assert.equal((await send(worker, 'login', { 'X-Forwarded-For': '198.51.100.1' })).status, 429);
    assert.equal((await send(worker, 'login', { 'X-Forwarded-For': '198.51.100.2' })).status, 200);
    assert.equal((await send(worker, 'login', { 'X-Forwarded-For': '::ffff:198.51.100.2' })).status, 429);
  } finally { await worker.close(); }
});
test('IPv6 addresses in one /56 share quota, another /56 is isolated', async () => {
  const worker = await startHttpApp({ ...fixture, AUTH_LOGIN_LIMIT: '1', TRUSTED_PROXY_CIDRS: '127.0.0.1/32' });
  try {
    assert.equal((await send(worker, 'login', { 'X-Forwarded-For': '2001:db8:abcd:1200::1' })).status, 200);
    assert.equal((await send(worker, 'login', { 'X-Forwarded-For': '2001:db8:abcd:12ff::2' })).status, 429);
    assert.equal((await send(worker, 'login', { 'X-Forwarded-For': '2001:db8:abcd:1300::1' })).status, 200);
  } finally { await worker.close(); }
});
test('untrusted X-Forwarded-* cannot choose a new rate-limit key', async () => {
  const worker = await startHttpApp({ ...fixture, AUTH_LOGIN_LIMIT: '1', TRUSTED_PROXY_CIDRS: 'none' });
  try {
    assert.equal((await send(worker, 'login', { 'X-Forwarded-For': '198.51.100.1' })).status, 200);
    const denied = await send(worker, 'login', { 'X-Forwarded-For': '198.51.100.2', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'trusted.example', Forwarded: 'for=198.51.100.3;proto=https' });
    assert.equal(denied.status, 429); assert.equal((await worker.stats()).login, 1);
  } finally { await worker.close(); }
});
test('quota resets after the configured window and reports Retry-After', async () => {
  const worker = await startHttpApp({ ...fixture, AUTH_LOGIN_LIMIT: '1', AUTH_LOGIN_WINDOW_MS: '1000' });
  try {
    assert.equal((await send(worker, 'login')).status, 200);
    const denied = await send(worker, 'login'); assert.equal(denied.status, 429); assert.equal(denied.retry, '1');
    await delay(1150); assert.equal((await send(worker, 'login')).status, 200);
  } finally { await worker.close(); }
});
test('rate store keys contain only IPs, never account or credential values', async () => {
  const store = new MemoryStore(), keys = [], increment = store.increment.bind(store);
  store.increment = key => { keys.push(key); return increment(key); };
  const app = express(); app.use(express.json()); app.post('/login', authRateLimiter(1, 60000, store), (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'private-marker@example.test', password: 'private-password-marker', token: 'private-token-marker' }) });
    assert.equal(r.status, 200); await r.json(); assert.deepEqual(keys, ['127.0.0.1']);
  } finally { await new Promise(r => server.close(r)); store.shutdown(); }
});
test('store failure blocks the handler instead of failing open', async () => {
  const store = new MemoryStore(); store.increment = async () => { throw Error('private-store-marker'); };
  let calls = 0; const app = express();
  app.post('/login', authRateLimiter(1, 60000, store), (_req, res) => { calls++; res.json({ ok: true }); });
  app.use((_error, _req, res, _next) => res.status(500).json({ message: 'Error interno del servidor.' }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/login`, { method: 'POST' });
    assert.equal(r.status, 500); assert.deepEqual(await r.json(), { message: 'Error interno del servidor.' }); assert.equal(calls, 0);
  } finally { await new Promise(r => server.close(r)); store.shutdown(); }
});
