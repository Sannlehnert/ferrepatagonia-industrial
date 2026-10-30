// Dedicated local test process so configuration/cookies are validated at startup.
const assert = require('node:assert/strict');
const { initializeDatabase, destroyDatabase } = require('../../dist/config/database.config');
const stats = { login: 0, register: 0 };
if (process.env.HTTP_TEST_SERVICE_STUBS === '1') {
  assert.notEqual(process.env.HTTP_TEST_DATABASE, '1');
  const auth = require('../../dist/services/auth.services');
  const registration = require('../../dist/services/register.service');
  const { signToken } = require('../../dist/services/token.service');
  auth.loginUsuario = async () => { stats.login++; return { token: signToken({ id: 7, rol: 'ADMIN' }), user: { id: 7, rol: 'ADMIN' } }; };
  registration.registerClient = async () => { stats.register++; return { id: 17, rol: 'CLIENTE' }; };
}
const { app } = require('../../dist/app');
let server;
async function main() {
  if (process.env.HTTP_TEST_DATABASE === '1') {
    assert.match(process.env.DB_NAME, /^(admin_products|categories)_test_[a-f0-9]{32}$/);
    assert.equal(process.env.DB_HOST, '127.0.0.1');
    await initializeDatabase();
  }
  server = app.listen(0, '127.0.0.1');
  server.once('listening', () => process.send({ port: server.address().port }));
  process.on('message', async message => {
    if (message === 'stats') process.send({ stats });
    if (message === 'close') {
      await new Promise(r => server.close(r)); await destroyDatabase(); process.disconnect();
    }
  });
}
main().catch(() => { console.error('Test HTTP worker startup failed.'); process.exitCode = 1; if (process.connected) process.disconnect(); });
