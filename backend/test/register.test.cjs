const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
Object.assign(process.env, { JWT_SECRET: require('node:crypto').randomUUID(), DB_HOST: '127.0.0.1', DB_PORT: '1', DB_NAME: 'unit', DB_USER: 'unit', DB_PASSWORD: 'unit' });
const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { once } = require('node:events');
const express = require('express');
const bcrypt = require('bcryptjs');
const { authRouter } = require('../dist/routes/auth.routes');
const { prepareRegisterUser } = require('../dist/services/register.service');
const registerService = require('../dist/services/register.service');
const { pool } = require('../dist/config/catalog-snapshot.config');
const { validateRegister } = require('../dist/validators/register.validator');

let server;
let baseUrl;
before(async () => {
  const app = express();
  app.use('/api/auth', authRouter);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  await pool.end();
});

for (const tipoCliente of ['PARTICULAR', 'EMPRESA']) {
  const body = {
    tipoCliente,
    nombreRazonSocial: 'Cliente de prueba',
    email: 'registro@example.com',
    password: 'Clave de prueba 166',
  };

  test(`${tipoCliente}: prepara CLIENTE y conserva el hash sin mezclar tipoCliente`, async () => {
    const result = validateRegister(body);
    assert.equal(result.valid, true);
    const user = await prepareRegisterUser(result.data);
    assert.equal(user.rol, 'CLIENTE');
    assert.equal(user.email, body.email);
    assert.equal(await bcrypt.compare(body.password, user.passwordHash), true);
    assert.equal('password' in user, false);
    assert.equal('tipoCliente' in user, false);
    assert.equal(result.data.tipoCliente, tipoCliente);
  });

  test(`${tipoCliente}: el helper no toma un rol inyectado`, async () => {
    const user = await prepareRegisterUser({ ...body, rol: 'ADMIN' });
    assert.equal(user.rol, 'CLIENTE');
  });

  for (const rol of ['ADMIN', 'CLIENTE', null]) {
    test(`${tipoCliente}: POST rechaza el campo rol=${rol}`, async () => {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, rol }),
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { message: 'El body contiene campos no permitidos.' });
    });
  }

  test(`${tipoCliente}: responde 201 con data.user sin credenciales ni cookie`, async (t) => {
    const user = { id: 123, email: body.email, rol: 'CLIENTE', tipoCliente };
    t.mock.method(registerService, 'registerClient', async () => user);
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), {
      message: 'Registro exitoso',
      data: { user },
    });
  });
}
