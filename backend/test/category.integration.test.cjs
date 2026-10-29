const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
require('./helpers/integration-lifecycle.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');

// Ejecutar mediante helpers/run-category-mariadb.cjs: instancia Docker desechable.
test('categorías HTTP y SQL real en MariaDB aislada', {
  skip: !process.env.CATEGORIES_TEST_DATABASE,
}, async t => {
  assert.match(process.env.CATEGORIES_TEST_DATABASE, /^categories_test_[a-f0-9]{32}$/);
  assert.equal(process.env.DB_NAME, process.env.CATEGORIES_TEST_DATABASE);
  const { pool } = require('../dist/config/catalog-snapshot.config');
  const { app } = require('../dist/app');
  let server;
  try {
    const [count] = await pool.query('SELECT COUNT(*) AS total FROM CATEGORIA');
    assert.equal(Number(count.total), 0, 'Se requiere la base desechable vacía');
    const columns = await pool.query('SHOW FULL COLUMNS FROM CATEGORIA');
    assert.equal(columns.find(c => c.Field === 'nombre').Collation, 'utf8mb4_unicode_ci');
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const request = async (path, expected, headers = {}) => {
      const response = await fetch(base + path, { headers });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^application\/json/);
      assert.deepEqual(body, { data: { categorias: expected } });
      t.diagnostic(JSON.stringify({ request: `GET ${path}`, status: response.status, body }));
    };
    await t.test('cero categorías', () => request('/categorias', []));
    const add = async (nombre, activo) => {
      const result = await pool.query('INSERT INTO CATEGORIA (nombre, descripcion, activo) VALUES (?, ?, ?)',
        [nombre, 'No debe exponerse', activo]);
      return { id: Number(result.insertId), nombre };
    };
    await add('Oculta', 0);
    await t.test('solo inactivas también devuelve vacío', () => request('/categorias', []));
    const z = await add('Zinc', 1);
    const a1 = await add('Áridos', 1);
    const a2 = await add('aridos', 1);
    const a3 = await add('Áridos', 1);
    const special = await add("Fijaciones & tornillos ' %_", 1);
    const expected = [a1, a2, a3, special, z];
    await t.test('activas sin productos, orden por collation y desempate por ID', async () => {
      const [products] = await pool.query('SELECT COUNT(*) AS total FROM PRODUCTO');
      assert.equal(Number(products.total), 0);
      await request('/categorias', expected);
      await request('/categorias', expected, { Cookie: 'jwt_token=invalido' });
    });
    await t.test('paginación, búsqueda y venta no limitan categorías; catálogo sigue vacío', async () => {
      await request('/categorias?page=2&limit=1&categoria=999&busqueda=nada&venta=0', expected);
      const response = await fetch(base + '/catalogo?limit=1');
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).data.productos, []);
      await request('/categorias', expected);
    });
    await t.test('productos inactivos y sin stock no cambian el listado', async () => {
      for (const [category, active] of [[a1, 0], [z, 1]]) {
        await pool.query(`INSERT INTO PRODUCTO
          (id_categoria, codigo, nombre, precio, stock, activo) VALUES (?, ?, ?, 1, 0, ?)`,
          [category.id, require('node:crypto').randomUUID(), 'Fixture aislado', active]);
      }
      await request('/categorias', expected);
    });
    await t.test('más de 100 categorías no se truncan', async () => {
      const extra = [];
      for (let i = 0; i < 105; i++) extra.push(await add(`Tornillos ${String(i).padStart(3, '0')}`, 1));
      await request('/categorias?limit=1&page=999', [a1, a2, a3, special, ...extra, z]);
    });
    await t.test('fallo SQL real responde 500 genérico', async () => {
      // Solo en esta base desechable, nunca se altera el esquema de desarrollo.
      await pool.query('RENAME TABLE CATEGORIA TO CATEGORIA_TEST_UNAVAILABLE');
      try {
        const response = await fetch(base + '/categorias');
        const body = await response.json();
        assert.equal(response.status, 500);
        assert.deepEqual(body, { message: 'Error interno del servidor.' });
        t.diagnostic(JSON.stringify({ request: 'GET /categorias (tabla no disponible)', status: response.status, body }));
      } finally {
        await pool.query('RENAME TABLE CATEGORIA_TEST_UNAVAILABLE TO CATEGORIA');
      }
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
});
