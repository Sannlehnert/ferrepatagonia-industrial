const assert = require('node:assert/strict');
const { before, after, test, mock } = require('node:test');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');

// Configuración aislada: pool.query se reemplaza y no se accede a MariaDB.
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.DB_HOST = '127.0.0.1';
process.env.DB_NAME = 'clientes_test';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
const jwt = require('jsonwebtoken');
const { signToken } = require('../dist/services/token.service');
// Capturar el controlador antes de que la ruta registre su referencia.
const controller = require('../dist/controllers/clientes.controller');
const handler = mock.method(controller, 'getClientes');
// Espías que delegan en las guardas reales, instalados antes de cargar el router.
const auth = require('../dist/middlewares/auth.middleware');
const authenticate = mock.method(auth, 'authenticate');
const authorizeRoles = auth.authorizeRoles;
const authorizationGuards = [];
mock.method(auth, 'authorizeRoles', (...roles) => {
  const guard = mock.fn(authorizeRoles(...roles));
  authorizationGuards.push(guard);
  return guard;
});
const verify = mock.method(jwt, 'verify');
const { app } = require('../dist/app');
const { adminRouter } = require('../dist/routes/admin.routes');
const auxiliaryHandler = mock.fn((_req, res) => res.json({ ok: true }));
// Solo de test: se agrega al router real después de sus guardas globales.
adminRouter.get('/test-only', auxiliaryHandler);
const guardCounts = () => [
  authenticate.mock.callCount(),
  authorizationGuards.reduce((sum, guard) => sum + guard.mock.callCount(), 0),
  verify.mock.callCount(),
];
const request = (token, path = '/clientes') => fetch(`${url}${path}`, {
  headers: token === undefined ? {} : { Cookie: `jwt_token=${encodeURIComponent(token)}` },
});
const adminRequest = () => request(signToken({ id: 7, rol: 'ADMIN' }));
const { pool } = require('../dist/config/database.config');
const repository = require('../dist/repositories/cliente.repository');
let server;
let url;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = `http://127.0.0.1:${server.address().port}/api/admin`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  mock.restoreAll();
  await pool.end();
});

test('#178: ADMIN autenticado recibe 200 con lista vacía', async (t) => {
  t.mock.method(pool, 'query', async () => []);
  const response = await adminRequest();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    message: 'Clientes obtenidos correctamente', data: { clientes: [] },
  });
});

for (const [label, token, status, message] of [
  ['CLIENTE autenticado', signToken({ id: 7, rol: 'CLIENTE' }), 403, 'El rol autenticado no tiene permiso.'],
  ['sin cookie', undefined, 401, 'No autenticado.'],
  ['token inválido', 'invalid', 401, 'No autenticado.'],
  ['token expirado', jwt.sign({ id: 7, rol: 'ADMIN' }, process.env.JWT_SECRET, {
    algorithm: 'HS256', expiresIn: -1,
  }), 401, 'No autenticado.'],
]) {
  test(`#178: ${label} devuelve ${status} sin ejecutar el controlador`, async (t) => {
    const beforeCalls = handler.mock.callCount();
    const query = t.mock.method(pool, 'query', async () => []);
    const response = await request(token);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { message });
    assert.equal(handler.mock.callCount(), beforeCalls);
    assert.equal(query.mock.callCount(), 0);
  });
}

// Cada request debe autenticar una vez; solo una autenticación exitosa llega al rol.
for (const path of ['/clientes', '/test-only', '/inexistente']) {
  for (const [label, token, expectedStatus, expectedBody, roleCalls, jwtCalls] of [
    ['ADMIN', signToken({ id: 7, rol: 'ADMIN' }), path === '/inexistente' ? 404 : 200,
      path === '/inexistente' ? { error: 'Ruta no encontrada' } :
        path === '/test-only' ? { ok: true } :
          { message: 'Clientes obtenidos correctamente', data: { clientes: [] } }, 1, 1],
    ['CLIENTE', signToken({ id: 7, rol: 'CLIENTE' }), 403,
      { message: 'El rol autenticado no tiene permiso.' }, 1, 1],
    ['sin sesión', undefined, 401, { message: 'No autenticado.' }, 0, 0],
    ['token inválido', 'invalid', 401, { message: 'No autenticado.' }, 0, 1],
    ['token expirado', jwt.sign({ id: 7, rol: 'ADMIN' }, process.env.JWT_SECRET, {
      algorithm: 'HS256', expiresIn: -1,
    }), 401, { message: 'No autenticado.' }, 0, 1],
  ]) {
    test(`#175: ${path}, ${label}: protección global sin duplicar guardas ni JWT`, async (t) => {
      const counts = guardCounts();
      const handlerCalls = handler.mock.callCount();
      const auxiliaryCalls = auxiliaryHandler.mock.callCount();
      const query = t.mock.method(pool, 'query', async () => []);
      const response = await request(token, path);
      assert.equal(response.status, expectedStatus);
      assert.deepEqual(await response.json(), expectedBody);
      assert.deepEqual(guardCounts().map((count, i) => count - counts[i]), [1, roleCalls, jwtCalls]);
      assert.equal(handler.mock.callCount() - handlerCalls, path === '/clientes' && expectedStatus === 200 ? 1 : 0);
      assert.equal(auxiliaryHandler.mock.callCount() - auxiliaryCalls, path === '/test-only' && expectedStatus === 200 ? 1 : 0);
      assert.equal(query.mock.callCount(), path === '/clientes' && expectedStatus === 200 ? 1 : 0);
    });
  }
}

test('#179: mapea los cuatro campos y usa fecha_creacion, conservando el orden de MariaDB', async (t) => {
  t.mock.method(pool, 'query', async () => [
    { id_cliente: 8n, nombre_razon_social: 'Reciente', email: 'cuenta@example.test', fecha_creacion: new Date('2026-10-09T13:45:00.000Z'), telefono: 'no-exponer', fecha_alta: new Date('2000-01-01T00:00:00.000Z') },
    { id_cliente: 7, nombre_razon_social: 'Misma fecha, menor id', email: 'segundo@example.test', fecha_creacion: new Date('2026-10-09T13:45:00.000Z') },
    { id_cliente: 20, nombre_razon_social: 'Anterior', email: 'anterior@example.test', fecha_creacion: new Date('2026-10-08T10:00:00.000Z') },
  ]);
  const response = await adminRequest();
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
    const response = await adminRequest();
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { message: 'Error interno del servidor.' });
  });
}
