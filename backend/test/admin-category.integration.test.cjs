const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { fetchFromBrowser: browserFetch } = require('./helpers/browser-request.cjs');
require('./helpers/integration-lifecycle.cjs');
const { createAuthUser } = require('./helpers/auth-user.cjs');
const { pool } = require('../dist/config/catalog-snapshot.config');
const { app } = require('../dist/app');

test('API ADMIN de categorías con HTTP y MariaDB', {
  skip: !process.env.CATEGORIES_TEST_DATABASE,
}, async t => {
  assert.match(process.env.CATEGORIES_TEST_DATABASE, /^categories_test_[a-f0-9]{32}$/);
  assert.equal(process.env.DB_NAME, process.env.CATEGORIES_TEST_DATABASE);
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    try { await new Promise(resolve => server.close(resolve)); }
    finally { await pool.end(); }
  });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const admin = await createAuthUser(pool);
  const client = await createAuthUser(pool, 'CLIENTE');
  const inactive = await createAuthUser(pool);
  await pool.query('UPDATE USUARIO SET activo = 0 WHERE id_usuario = ?', [inactive.id]);
  const request = async (path, status, init) => {
    const response = await browserFetch(base + path, { signal: AbortSignal.timeout(15000), ...init });
    const body = await response.json();
    assert.equal(response.status, status, `${init?.method ?? 'GET'} ${path}: ${response.status}`);
    return body;
  };
  const adminPath = '/admin/categorias';
  const mutate = (method, suffix, status, body, { cookie = admin.cookie, origin, contentType = 'application/json' } = {}) =>
    request(adminPath + suffix, status, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...(body !== undefined ? { 'Content-Type': contentType } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const getPublic = async () => (await request('/categorias', 200)).data.categorias;
  const getPersisted = async id => (await pool.query(
    'SELECT id_categoria, nombre, descripcion, activo FROM CATEGORIA WHERE id_categoria = ?', [id],
  ))[0];
  const initialPublic = await getPublic();
  const nombre = `Herramientas  eléctricas ${randomUUID()}`;
  const descripcion = 'Descripción industrial';

  const created = await mutate('POST', '', 201, { nombre: `  ${nombre}  `, descripcion });
  const id = created.id_categoria;
  assert.ok(Number.isInteger(id) && id > 0);
  const suffix = `/${id}`;
  const deactivate = suffix + '/desactivar';
  await t.test('C01–C02: alta activa con ID generado, lectura SQL y publicación', async () => {
    assert.deepEqual(created, { id_categoria: id, nombre, descripcion, activo: 1 });
    assert.deepEqual(await getPersisted(id), created);
    const categories = await getPublic();
    assert.deepEqual(categories.find(category => category.id === id), { id, nombre });
    assert.deepEqual(categories.filter(category => category.id !== id), initialPublic);
  });

  await t.test('C03–C04: edición completa, parcial y sin cambios con lectura persistida', async () => {
    const edited = { ...created, nombre: 'Instrumentos técnicos', descripcion: 'Revisión técnica' };
    assert.deepEqual(await mutate('PUT', suffix, 200, { nombre: edited.nombre, descripcion: edited.descripcion }), edited);
    assert.deepEqual(await getPersisted(id), edited);
    assert.deepEqual((await getPublic()).find(category => category.id === id), { id, nombre: edited.nombre });
    const cleared = { ...edited, descripcion: null };
    assert.deepEqual(await mutate('PUT', suffix, 200, { descripcion: null }), cleared);
    assert.deepEqual(await mutate('PUT', suffix, 200, { nombre: edited.nombre }), cleared);
    assert.deepEqual(await getPersisted(id), cleared);
  });

  await t.test('C10–C13: IDs, cuerpo, límites utf8mb4 y campos admitidos', async () => {
    const missing = '/2147483647';
    assert.deepEqual(await mutate('PUT', missing, 404, { nombre }), { message: 'Categoría no encontrada.' });
    assert.deepEqual(await mutate('PATCH', missing + '/desactivar', 404), { message: 'Categoría no encontrada.' });
    for (const invalid of ['0', '-1', '01', '1.1', '1e0', 'abc', '2147483648']) {
      await mutate('PUT', '/' + invalid, 400, { nombre });
      await mutate('PATCH', '/' + invalid + '/desactivar', 400);
    }
    const invalidBodies = [undefined, null, [], {}, { nombre: '  ' }, { nombre: 'a'.repeat(151) },
      { nombre: 12 }, { nombre, descripcion: 1 }, { nombre, descripcion: 'é'.repeat(32768) },
      ...['otro', 'id_categoria', 'activo', 'constructor'].map(key => ({ nombre, [key]: 1 })),
      JSON.parse('{"nombre":"Fixture","__proto__":1}')];
    const before = await getPersisted(id);
    for (const body of invalidBodies) {
      await mutate('POST', '', 400, body);
      await mutate('PUT', suffix, 400, body);
    }
    await mutate('POST', '', 400, { nombre }, { contentType: 'text/plain' });
    await mutate('PATCH', deactivate, 400, { activo: 1 });
    await mutate('PATCH', deactivate, 400, { id_categoria: id }, { contentType: 'text/plain' });
    assert.deepEqual(await getPersisted(id), before);
    const boundary = { nombre: '🛠'.repeat(150), descripcion: 'é'.repeat(32767) + 'a' };
    const first = await mutate('POST', '', 201, boundary);
    assert.deepEqual(await getPersisted(first.id_categoria), { ...boundary, id_categoria: first.id_categoria, activo: 1 });
    const duplicate = await mutate('POST', '', 201, { nombre: boundary.nombre });
    assert.notEqual(duplicate.id_categoria, first.id_categoria);
    assert.deepEqual(await getPersisted(duplicate.id_categoria), { ...duplicate, nombre: boundary.nombre, descripcion: null, activo: 1 });
  });

  await t.test('C14–C17: rol, sesión inválida, expirada o inactiva y origen prohibido', async () => {
    const expired = 'jwt_token=' + jwt.sign({ id: admin.id, rol: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: -1 });
    const before = await getPersisted(id);
    const publicBefore = await getPublic();
    for (const [method, path, body] of [['POST', '', { nombre }], ['PUT', suffix, { nombre }], ['PATCH', deactivate]]) {
      await mutate(method, path, 403, body, { cookie: client.cookie });
      for (const cookie of ['', 'jwt_token=invalido', expired, inactive.cookie]) {
        await mutate(method, path, 401, body, { cookie });
      }
      assert.deepEqual(await mutate(method, path, 403, body, { origin: 'https://foreign.example' }),
        { message: 'Origen de solicitud no permitido.' });
    }
    assert.deepEqual(await getPersisted(id), before);
    assert.deepEqual(await getPublic(), publicBefore);
  });

  await t.test('C18: error SQL real sin datos sensibles ni escritura tardía', async () => {
    const before = await getPersisted(id);
    const lock = await pool.getConnection();
    try {
      await lock.beginTransaction();
      await lock.query('SELECT id_categoria FROM CATEGORIA WHERE id_categoria = ? FOR UPDATE', [id]);
      assert.deepEqual(await mutate('PUT', suffix, 500, { nombre: 'Texto privado de prueba' }),
        { message: 'Error interno del servidor' });
    } finally {
      try { await lock.rollback(); }
      finally { lock.release(); }
    }
    assert.deepEqual(await getPersisted(id), before);
  });

  await t.test('C05–C09: baja lógica concurrente y repetida oculta catálogo y detalle, conserva producto', async () => {
    const inserted = await pool.query(`INSERT INTO PRODUCTO
      (id_categoria, codigo, nombre, precio, stock, activo) VALUES (?, ?, ?, 14.25, 7, 1)`,
    [id, randomUUID(), 'Producto relacionado']);
    const productId = Number(inserted.insertId);
    const productPath = '/catalogo/' + productId;
    const catalogPath = '/catalogo?categoria=' + id;
    const productRow = async () => (await pool.query('SELECT * FROM PRODUCTO WHERE id_producto = ?', [productId]))[0];
    const before = await productRow();
    assert.ok(before);
    assert.equal((await request(productPath, 200)).data.producto.id, productId);
    assert.deepEqual((await request(catalogPath, 200)).data.productos.map(product => product.id), [productId]);
    const expected = { ...await getPersisted(id), activo: 0 };
    const results = await Promise.all([
      mutate('PATCH', deactivate, 200),
      mutate('PATCH', deactivate, 200),
    ]);
    assert.deepEqual(results, [expected, expected]);
    assert.deepEqual(await request(adminPath + deactivate, 200, {
      method: 'PATCH',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json', 'Content-Length': '0' },
    }), expected);
    assert.deepEqual(await getPersisted(id), expected);
    assert.equal((await getPublic()).some(category => category.id === id), false);
    assert.deepEqual((await request(catalogPath, 200)).data.productos, []);
    await request(productPath, 404);
    assert.deepEqual(await productRow(), before);
  });
});
