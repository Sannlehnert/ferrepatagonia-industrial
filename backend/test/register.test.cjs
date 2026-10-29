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
const passwordCases = [
  ['', false], ['x', false], ['a'.repeat(7), false], ['😀'.repeat(7), false],
  ['a'.repeat(8), true], ['😀'.repeat(8), true], [' '.repeat(8), true],
  ['  abcdef  ', true], ['a'.repeat(72), true], ['a'.repeat(73), false],
  ['é'.repeat(36), true], ['é'.repeat(36)+'a', false],
  ['😀'.repeat(18), true], ['😀'.repeat(18)+'a', false],
  ['e\u0301'.repeat(4), true],
];
for (const tipoCliente of ['PARTICULAR', 'EMPRESA']) {
  for (const [index, [password, valid]] of passwordCases.entries()) {
    test(`F02 ${tipoCliente}: boundary ${index}`, async t => {
      const body = {tipoCliente,nombreRazonSocial:'Fixture',email:'policy@example.test',password};
      const validated = validateRegister(body);
      assert.equal(validated.valid,valid);
      if (valid) assert.equal(validated.data.password,password);
      const service = t.mock.method(registerService,'registerClient',async () => ({id:1}));
      const response = await fetch(`${baseUrl}/api/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      assert.equal(response.status,valid?201:400);
      assert.equal(service.mock.callCount(),valid?1:0);
      if (!valid) {
        assert.deepEqual(Object.keys(await response.json()),['message']);
        const db = require('../dist/config/database.config');
        const transaction = t.mock.method(db,'inTransaction',async()=>{throw Error('must not write');});
        // Also check the service boundary independently of the HTTP DTO.
        await assert.rejects(registerServiceOriginal(body), {status:400});
        assert.equal(transaction.mock.callCount(),0);
      }
    });
  }
}
const registerServiceOriginal = registerService.registerClient;
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
