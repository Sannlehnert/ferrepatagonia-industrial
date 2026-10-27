const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const express = require('express');
const { loadHttpSecurity } = require('../dist/config/http-security.config');
const { httpSecurity } = require('../dist/middlewares/http-security.middleware');
const { productionHttpEnv } = require('./helpers/production-http-env.cjs');
async function serve(raw) {
  const config = loadHttpSecurity(raw), app = express();
  app.set('trust proxy', config.trustedProxies); app.use(httpSecurity(config));
  app.get('/', (req, res) => res.json({ ip: req.ip, protocol: req.protocol, hostname: req.hostname }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) };
}
test('direct development ignores spoofed forwarded IP, protocol and host', async () => {
  const server = await serve({ NODE_ENV: 'development' });
  try {
    const r = await fetch(server.url, { headers: { 'X-Forwarded-For': '198.51.100.1', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'untrusted.example' } });
    assert.deepEqual(await r.json(), { ip: '127.0.0.1', protocol: 'http', hostname: '127.0.0.1' });
  } finally { await server.close(); }
});
test('trust precise proxy networks and stop at the nearest untrusted hop', async () => {
  const server = await serve({ NODE_ENV: 'test', TRUSTED_PROXY_CIDRS: '127.0.0.1/32' });
  try {
    const r = await fetch(server.url, { headers: { 'X-Forwarded-For': '198.51.100.1,192.0.2.2', 'X-Forwarded-Proto': 'https' } });
    const json = await r.json(); assert.equal(json.ip, '192.0.2.2'); assert.equal(json.protocol, 'https');
  } finally { await server.close(); }
});
for (const proto of [undefined, 'http', 'https', 'https,http']) test('untrusted peer cannot satisfy production HTTPS with header: ' + String(proto), async () => {
  const server = await serve({ ...productionHttpEnv(), TRUSTED_PROXY_CIDRS: '192.0.2.10/32' });
  try {
    const r = await fetch(server.url, { headers: { ...(proto ? { 'X-Forwarded-Proto': proto } : {}), 'X-Forwarded-For': '192.0.2.10', 'X-Forwarded-Host': 'browser.test' } });
    assert.equal(r.status, 426); assert.deepEqual(await r.json(), { message: 'Se requiere HTTPS.' });
  } finally { await server.close(); }
});
test('synthetic trusted TLS terminator permits HTTPS and correct client IP', async () => {
  const server = await serve(productionHttpEnv());
  try {
    const r = await fetch(server.url, { headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '198.51.100.8' } });
    assert.equal(r.status, 200); const json = await r.json(); assert.equal(json.ip, '198.51.100.8'); assert.equal(json.protocol, 'https');
  } finally { await server.close(); }
});
test('invalid forwarded network identity gets controlled 400 without echoing its value', async () => {
  const server = await serve({ NODE_ENV: 'test', TRUSTED_PROXY_CIDRS: '127.0.0.1/32' });
  try {
    const r = await fetch(server.url, { headers: { 'X-Forwarded-For': 'private-marker@example.test' } });
    assert.equal(r.status, 400); assert.deepEqual(await r.json(), { message: 'Información de red inválida.' });
  } finally { await server.close(); }
});
