const assert = require('node:assert/strict');
const { test } = require('node:test');
const { allowsSocketTransport } = require('../dist/realtime/socket-transport');

const policy = {
  publicOrigin: 'https://orders.example.test',
  requireHttps: true,
};

function allowed(headers, { trusted = false, encrypted = false, remoteAddress = '127.0.0.1' } = {}) {
  return allowsSocketTransport(
    { headers, socket: { encrypted, remoteAddress } }, policy, () => trusted,
  );
}

test('#281: HTTPS solo directo o acreditado por el proxy confiable', () => {
  const headers = { origin: policy.publicOrigin, 'x-forwarded-proto': 'https, http' };
  assert.equal(allowed(headers, { trusted: true }), true);
  assert.equal(allowed(headers, { encrypted: true }), true);
  assert.equal(allowed(headers), false);
  assert.equal(allowed(headers, { trusted: true, remoteAddress: 'invalid' }), false);
  assert.equal(allowed({ ...headers, 'x-forwarded-proto': 'http, https' }, { trusted: true }), false);
});

test('#281: origen, Referer y Fetch Metadata coherentes con el host canónico', () => {
  const headers = { host: 'orders.example.test', 'sec-fetch-site': 'same-origin' };
  const tls = { encrypted: true };
  assert.equal(allowed(headers, tls), true);
  assert.equal(allowed({ ...headers, host: 'wrong.example.test', 'x-forwarded-host': headers.host }, tls), false);
  assert.equal(allowed({ referer: policy.publicOrigin + '/orders' }, tls), true);
  assert.equal(allowed({ origin: policy.publicOrigin, referer: 'https://foreign.example.test' }, tls), false);
  assert.equal(allowed({ origin: policy.publicOrigin, 'sec-fetch-site': 'same-site' }, tls), false);
  assert.equal(allowed({}, tls), false);
});
