const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { once } = require('node:events');
const express = require('express');
const bcrypt = require('bcryptjs');
const { authRouter } = require('../dist/routes/auth');
const { prepareRegisterUser } = require('../dist/services/register.service');
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

  test(`${tipoCliente}: registro válido sigue pendiente sin exponer datos de USUARIO`, async () => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 501);
    assert.deepEqual(await response.json(), {
      message: 'Registro aún no disponible: datos válidos, pero la creación de la cuenta está pendiente.',
    });
  });
}
