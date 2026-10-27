const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
Object.assign(process.env, { JWT_SECRET: randomBytes(32).toString('hex'), DB_HOST: '127.0.0.1', DB_NAME: 'unit', DB_USER: 'unit', DB_PASSWORD: 'unit' });
const { loadHttpSecurity, validateJwtSecret } = require('../dist/config/http-security.config');
const production = {
  NODE_ENV: 'production', APP_PUBLIC_ORIGIN: 'https://app.example.test',
  TRUSTED_PROXY_CIDRS: '192.0.2.10/32,2001:db8::/64', HTTPS_TERMINATION: 'trusted-proxy',
  AUTH_RATE_STORE: 'memory', API_PROCESS_COUNT: '1',
  AUTH_LOGIN_LIMIT: '3', AUTH_LOGIN_WINDOW_MS: '1000', AUTH_REGISTER_LIMIT: '2', AUTH_REGISTER_WINDOW_MS: '2000',
};
exports.productionConfig = production;
for (const mode of ['development', 'test']) test('known local mode, no proxy or external CORS: ' + mode, () => {
  const c = loadHttpSecurity({ NODE_ENV: mode });
  assert.equal(c.mode, mode); assert.equal(c.trustedProxies, false); assert.equal(c.requireHttps, false);
  assert.equal(c.publicOrigin, 'http://localhost:5173');
});
for (const mode of [undefined, '', 'prod', 'Production', 'staging', 'production ']) test('reject mode ' + String(mode), () => {
  assert.throws(() => loadHttpSecurity({ NODE_ENV: mode }));
});
test('explicit production configuration, with precise proxy networks', () => {
  const c = loadHttpSecurity(production); assert.equal(c.requireHttps, true);
  assert.deepEqual(c.trustedProxies, ['192.0.2.10/32', '2001:db8::/64']);
});
for (const key of Object.keys(production)) test('production requires ' + key, () => {
  const c = { ...production }; delete c[key]; assert.throws(() => loadHttpSecurity(c));
});
for (const [key, bad] of Object.entries({
  APP_PUBLIC_ORIGIN: ['http://app.example.test', '*', 'null', 'https://user:secret@app.example.test', 'https://app.example.test/', 'https://app.example.test/path', 'https://app.example.test?q=x', 'https://app.example.test#x', 'https://APP.example.test'],
  TRUSTED_PROXY_CIDRS: ['true', '1', '*', '', 'none', '0.0.0.0/0', '::/0', '127.0.0.1/33', '::1/129', 'invalid', '127.0.0.1,', '127.0.0.1/1e1'],
  HTTPS_TERMINATION: ['nginx', 'false', ''], AUTH_RATE_STORE: ['redis', ''], API_PROCESS_COUNT: ['2', '0', '01', '1e0'],
})) for (const [i, value] of bad.entries()) test('reject invalid ' + key + ' case ' + i, () => {
  assert.throws(() => loadHttpSecurity({ ...production, [key]: value }));
});
for (const key of ['AUTH_LOGIN_LIMIT', 'AUTH_LOGIN_WINDOW_MS', 'AUTH_REGISTER_LIMIT', 'AUTH_REGISTER_WINDOW_MS'])
  for (const value of ['', '0', '-1', '1.5', '1e3', ' 3', '03', 'Infinity', 'NaN', '99999999999999999999']) test('strict positive config integer ' + key + ' ' + value, () => {
    assert.throws(() => loadHttpSecurity({ ...production, [key]: value }));
  });
for (const kind of ['short', 'repeated', 'surrounding whitespace']) test('production rejects weak JWT secret: ' + kind, () => {
  const value = kind === 'short' ? 'x' : kind === 'repeated' ? 'a'.repeat(64) : ' ' + randomBytes(32).toString('hex');
  assert.throws(() => validateJwtSecret(value, 'production'), error => error.message === 'Configuración inválida: JWT_SECRET.');
});
test('production accepts a generated key intact, without logging or fallback', () => {
  const value = randomBytes(32).toString('hex'); assert.equal(validateJwtSecret(value, 'production'), value);
});
for (const [label, overrides] of [['missing mode', { NODE_ENV: '' }], ['weak secret', { ...production, JWT_SECRET: 'x' }],
  ['missing proxy', { ...production, TRUSTED_PROXY_CIDRS: '' }], ['missing production limits', { ...production, AUTH_LOGIN_LIMIT: '' }]])
  test('startup fails before listening: ' + label, () => {
    const result = spawnSync(process.execPath, ['dist/server.js'], { env: { ...process.env, ...overrides }, encoding: 'utf8', timeout: 5000 });
    assert.notEqual(result.status, 0); assert.doesNotMatch(result.stdout, /API disponible/);
  });
test('cookie flags come from validated startup mode, not a later process.env mutation', () => {
  const { clearAuthCookieOptions, issueAuthCookieOptions } = require('../dist/config/auth-cookie.config');
  const old = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try {
    assert.equal(issueAuthCookieOptions.secure, false);
    assert.equal(issueAuthCookieOptions.maxAge, 7200000); assert.equal(clearAuthCookieOptions.maxAge, undefined);
    assert.equal(issueAuthCookieOptions.path, '/'); assert.equal(issueAuthCookieOptions.domain, undefined);
    assert.equal(issueAuthCookieOptions.httpOnly, true); assert.equal(issueAuthCookieOptions.sameSite, 'strict');
  } finally { process.env.NODE_ENV = old; }
});
