const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');

// Configuración aislada: pool.query se reemplaza y no se accede a MariaDB.
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.DB_HOST = '127.0.0.1';
process.env.DB_NAME = 'clientes_test';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
const { app } = require('../dist/app');
const { pool } = require('../dist/config/database.config');
const repository = require('../dist/repositories/cliente.repository');
let server;
let url;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = `http://127.0.0.1:${server.address().port}/api/admin/clientes`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  await pool.end();
});

test('#177: sin autenticación responde 200 con lista vacía (temporal hasta #178)', async (t) => {
  t.mock.method(pool, 'query', async () => []);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    message: 'Clientes obtenidos correctamente', data: { clientes: [] },
  });
});

test('#179: mapea los cuatro campos y usa fecha_creacion, conservando el orden de MariaDB', async (t) => {
  t.mock.method(pool, 'query', async () => [
    { id_cliente: 8n, nombre_razon_social: 'Reciente', email: 'cuenta@example.test', fecha_creacion: new Date('2026-10-09T13:45:00.000Z'), telefono: 'no-exponer', fecha_alta: new Date('2000-01-01T00:00:00.000Z') },
    { id_cliente: 7, nombre_razon_social: 'Misma fecha, menor id', email: 'segundo@example.test', fecha_creacion: new Date('2026-10-09T13:45:00.000Z') },
    { id_cliente: 20, nombre_razon_social: 'Anterior', email: 'anterior@example.test', fecha_creacion: new Date('2026-10-08T10:00:00.000Z') },
  ]);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    message: 'Clientes obtenidos correctamente', data: { clientes: [
      { id: 8, nombreRazonSocial: 'Reciente', email: 'cuenta@example.test', fechaRegistro: '2026-10-09T13:45:00.000Z' },
      { id: 7, nombreRazonSocial: 'Misma fecha, menor id', email: 'segundo@example.test', fechaRegistro: '2026-10-09T13:45:00.000Z' },
      { id: 20, nombreRazonSocial: 'Anterior', email: 'anterior@example.test', fechaRegistro: '2026-10-08T10:00:00.000Z' },
    ] },
  });
});

test('repositorio selecciona email y fecha de USUARIO, exige asociación y rol CLIENTE, y ordena por registro e id', async (t) => {
  const query = t.mock.method(pool, 'query', async () => []);
  assert.deepEqual(await repository.findAllClientes(), []);
  assert.equal(query.mock.callCount(), 1);
  assert.equal(query.mock.calls[0].arguments[0].replace(/\s+/g, ' ').trim(),
    "SELECT c.id_cliente, c.nombre_razon_social, u.email, u.fecha_creacion FROM CLIENTE c INNER JOIN USUARIO u ON u.id_cliente = c.id_cliente WHERE u.rol = 'CLIENTE' ORDER BY u.fecha_creacion DESC, c.id_cliente DESC");
});

for (const [label, target, method] of [
  ['BD', pool, 'query'], ['repositorio', repository, 'findAllClientes'],
]) {
  test(`error de ${label} devuelve 500 genérico sin detalles internos`, async (t) => {
    t.mock.method(target, method, async () => { throw new Error('SQL privado y credenciales'); });
    t.mock.method(console, 'error', () => {});
    const response = await fetch(url);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { message: 'Error interno del servidor.' });
  });
}
