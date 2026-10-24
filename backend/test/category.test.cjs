const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
// Ningún test unitario usa credenciales ni conexiones reales.
Object.assign(process.env, { JWT_SECRET: randomUUID(), DB_HOST: '127.0.0.1',
  DB_PORT: '1', DB_NAME: randomUUID(), DB_USER: randomUUID(), DB_PASSWORD: randomUUID() });
const { pool } = require('../dist/config/database.config');
const repository = require('../dist/repositories/category.repository');
const catalog = require('../dist/repositories/catalog.repository');
const { app } = require('../dist/app');
let server, url;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = `http://127.0.0.1:${server.address().port}/api/categorias`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
});
for (const cookie of [undefined, 'jwt_token=invalido']) {
  test(`público, contrato exacto, sin autenticación: ${cookie}`, async t => {
    t.mock.method(repository, 'findActiveCategories', async () => [
      { id_categoria: 7, nombre: 'Áridos & fijaciones', descripcion: 'privado', activo: 1 },
    ]);
    const response = await fetch(url, { headers: cookie ? { Cookie: cookie } : {} });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), { data: { categorias: [{ id: 7, nombre: 'Áridos & fijaciones' }] } });
  });
}
test('vacío HTTP 200', async t => {
  t.mock.method(repository, 'findActiveCategories', async () => []);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { categorias: [] } });
});
test('lista completa y orden preservado, sin depender de catálogo ni query', async t => {
  const rows = Array.from({ length: 125 }, (_, i) => ({ id_categoria: i + 1, nombre: `Categoría ${i}` }));
  const stub = t.mock.method(repository, 'findActiveCategories', async () => rows);
  const forbidden = t.mock.method(catalog, 'findCatalogPage', async () => { throw Error('No consultar productos'); });
  for (const suffix of ['', '?page=2&limit=1&categoria=99&busqueda=inexistente&venta=0', '?page=0&page=3']) {
    const response = await fetch(url + suffix);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: { categorias: rows.map(r => ({ id: r.id_categoria, nombre: r.nombre })) } });
  }
  assert.equal(forbidden.mock.callCount(), 0);
  assert.ok(stub.mock.calls.every(c => c.arguments.length === 0));
});
test('fallo del driver no filtra SQL, stack ni status', async t => {
  t.mock.method(pool, 'query', async () => { throw Object.assign(Error('SELECT secreto'), { status: 401 }); });
  const log = t.mock.method(console, 'error', () => {});
  const response = await fetch(url);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { message: 'Error interno del servidor.' });
  assert.deepEqual(log.mock.calls[0].arguments, ['Error al consultar las categorías.']);
});
test('repositorio consulta solo categorías activas, orden SQL determinista y timeout', async t => {
  const rows = [{ id_categoria: 1, nombre: 'A' }];
  const stub = t.mock.method(pool, 'query', async () => rows);
  assert.deepEqual(await repository.findActiveCategories(), rows);
  assert.equal(stub.mock.callCount(), 1);
  const [query] = stub.mock.calls[0].arguments;
  assert.equal(query.sql.replace(/\s+/g, ' ').trim(),
    'SELECT id_categoria, nombre FROM CATEGORIA WHERE activo = 1 ORDER BY nombre ASC, id_categoria ASC');
  assert.equal(query.timeout, 5000);
});
