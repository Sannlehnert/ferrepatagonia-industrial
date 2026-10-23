const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');

test('catálogo público real en MariaDB', { skip: !process.env.CATALOG_TEST_DATABASE }, async t => {
  const { env } = require('../dist/config/env.config');
  assert.equal(env.db.database, process.env.CATALOG_TEST_DATABASE, 'Confirmar base de desarrollo');
  const { pool } = require('../dist/config/database.config');
  const { app } = require('../dist/app');
  const { findCatalogPage } = require('../dist/repositories/catalog.repository');
  const prefix = `catalog-${randomUUID()}`;
  const categories = [], products = [];
  const productCodes = new Map();
  let server;
  try {
    for (const active of [1, 0, 1, 1, 1]) {
      const result = await pool.query('INSERT INTO CATEGORIA (nombre, activo) VALUES (?, ?)', [prefix, active]);
      categories.push(Number(result.insertId));
    }
    const addProduct = async (connection, category, active, stock) => {
      const codigo = `${prefix}-${products.length + 1}`;
      const result = await connection.query(`INSERT INTO PRODUCTO
        (id_categoria, codigo, nombre, precio, stock, activo) VALUES (?, ?, ?, 987654.32, ?, ?)`,
        [category, codigo, 'Mismo nombre', stock, active]);
      const id = Number(result.insertId);
      products.push(id);
      productCodes.set(id, codigo);
      return id;
    };
    await addProduct(pool, categories[0], 1, 8);
    await addProduct(pool, categories[0], 1, 0);
    await addProduct(pool, categories[0], 1, 1);
    const inactiveProduct = await addProduct(pool, categories[0], 0, 8);
    const inactiveCategory = await addProduct(pool, categories[1], 1, 8);
    await addProduct(pool, categories[3], 0, 8);
    await addProduct(pool, categories[4], 1, 8);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api/catalogo`;

    await t.test('filtra activos, conserva sin stock y pagina sin duplicar ni omitir productos', async () => {
      const allProducts = await pool.query('SELECT id_producto, id_categoria, nombre, codigo, stock, activo FROM PRODUCTO');
      const allCategories = await pool.query('SELECT id_categoria, nombre, activo FROM CATEGORIA');
      const categoryMap = new Map(allCategories.map(c => [c.id_categoria, c]));
      const expected = allProducts.filter(p => p.activo && categoryMap.get(p.id_categoria)?.activo)
        .sort((a, b) => a.id_producto - b.id_producto).map(p => ({
          id: p.id_producto, nombre: p.nombre, codigo: p.codigo,
          categoria: { id: p.id_categoria, nombre: categoryMap.get(p.id_categoria).nombre },
          precio: null, estadoPrecio: 'PENDIENTE_DEFINICION', disponible: p.stock > 0,
        }));
      const collected = [];
      const totalPages = Math.ceil(expected.length / 2);
      const pages = [...Array.from({ length: totalPages + 2 }, (_, i) => i + 1), 1000000];
      for (const page of pages) {
        const response = await fetch(`${url}?page=${page}&limit=2`);
        assert.equal(response.status, 200);
        const { data } = await response.json();
        assert.deepEqual(data.productos, expected.slice((page - 1) * 2, page * 2));
        assert.deepEqual(data.pagination, { page, limit: 2, total: expected.length, totalPages,
          hasNext: page < totalPages, hasPrevious: page > 1 && page <= totalPages + 1 });
        collected.push(...data.productos);
      }
      assert.deepEqual(collected, expected);
      assert.ok(!collected.some(p => [inactiveProduct, inactiveCategory].includes(p.id)));
      assert.equal(collected.find(p => p.id === products[1]).disponible, false);
    });

    await t.test('categoría activa: contrato HTTP y paginación sobre el subconjunto', async () => {
      for (const page of [1, 2, 3, 4, 1000000]) {
        const response = await fetch(`${url}?categoria=${categories[0]}&page=${page}&limit=2`);
        assert.equal(response.status, 200);
        const { data } = await response.json();
        assert.deepEqual(data.productos, products.slice(0, 3).slice((page - 1) * 2, page * 2).map((id) => ({
          id, nombre: 'Mismo nombre', codigo: productCodes.get(id),
          categoria: { id: categories[0], nombre: prefix },
          disponible: id !== products[1], precio: null, estadoPrecio: 'PENDIENTE_DEFINICION',
        })));
        assert.deepEqual(data.pagination, { page, limit: 2, total: 3, totalPages: 2,
          hasNext: page < 2, hasPrevious: page > 1 && page <= 3 });
      }
      const response = await fetch(`${url}?categoria=${categories[0]}`);
      assert.equal(response.status, 200);
      const { data } = await response.json();
      assert.deepEqual(data.productos.map(p => p.id), products.slice(0, 3));
      assert.deepEqual(data.pagination, { page: 1, limit: 20, total: 3, totalPages: 1,
        hasNext: false, hasPrevious: false });
    });

    await t.test('categorías inactiva, vacía, solo productos inactivos e inexistente devuelven vacío', async () => {
      // Reservar un ID propio y eliminarlo evita suponer que un ID fijo no existe.
      const result = await pool.query('INSERT INTO CATEGORIA (nombre, activo) VALUES (?, 1)', [prefix]);
      const missing = Number(result.insertId);
      categories.push(missing);
      await pool.query('DELETE FROM CATEGORIA WHERE id_categoria = ?', [missing]);
      for (const categoria of [categories[1], categories[2], categories[3], missing]) {
        for (const page of [1, 2, 1000000]) {
          const response = await fetch(`${url}?categoria=${categoria}&page=${page}&limit=2`);
          assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), { data: { productos: [],
            pagination: { page, limit: 2, total: 0, totalPages: 0, hasNext: false, hasPrevious: false },
          } });
        }
      }
    });

    await t.test('categoría inválida rechazada por HTTP real', async () => {
      for (const query of ['categoria=0', 'categoria=2147483648', 'categoria=1&categoria=2',
        'categoria=1%20OR%201=1', 'categoria=1&limit=101', 'categoria=1&page=0']) {
        const response = await fetch(`${url}?${query}`);
        assert.equal(response.status, 400);
        assert.deepEqual(Object.keys(await response.json()), ['message']);
      }
    });

    await t.test('catálogo vacío: ninguna página tiene anterior ni siguiente', async t => {
      const connection = await pool.getConnection();
      try {
        // Las tablas temporales ocultan las reales solo en esta conexión.
        await connection.query(`CREATE TEMPORARY TABLE CATEGORIA (
          id_categoria INT PRIMARY KEY, nombre VARCHAR(255), activo TINYINT
        ) ENGINE=InnoDB`);
        await connection.query(`CREATE TEMPORARY TABLE PRODUCTO (
          id_producto INT PRIMARY KEY, id_categoria INT, nombre VARCHAR(255),
          codigo VARCHAR(255), stock INT, activo TINYINT
        ) ENGINE=InnoDB`);
        t.mock.method(connection, 'release', () => {});
        t.mock.method(pool, 'getConnection', async () => connection);
        for (const page of [1, 2, 3, 1000000]) {
          const response = await fetch(`${url}?page=${page}&limit=2`);
          assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), { data: {
            productos: [],
            pagination: { page, limit: 2, total: 0, totalPages: 0,
              hasNext: false, hasPrevious: false },
          } });
        }
      } finally {
        t.mock.restoreAll();
        // Destruir la conexión elimina las tablas temporales incluso ante un fallo.
        connection.destroy();
      }
    });

    await t.test('busqueda real: nombre/codigo, collation, literales y paginacion', async () => {
      const columns = await pool.query('SHOW FULL COLUMNS FROM PRODUCTO');
      for (const field of ['nombre', 'codigo']) {
        assert.equal(columns.find(c => c.Field === field).Collation, 'utf8mb4_unicode_ci');
      }
      const token = randomUUID();
      const otherPrefix = `OTHER-${randomUUID()}`;
      const fixtures = [];
      const add = async (nombre, codigo, active = 1, category = categories[0], stock = 1) => {
        const result = await pool.query(
          'INSERT INTO PRODUCTO (id_categoria, nombre, codigo, precio, stock, activo) VALUES (?, ?, ?, 10, ?, ?)',
          [category, nombre, codigo, stock, active]);
        const id = Number(result.insertId);
        products.push(id);
        fixtures.push({ id, nombre, codigo, active, category, stock });
      };
      await add(token + ' Taládro  doble', `${otherPrefix}-1`, 1, categories[0], 0);
      await add('Otro', token + ' ABC');
      await add(token + ' Mixto', token + ' MIX');
      await add(token + ' inactivo', token + ' INACTIVO', 0);
      await add(token + ' categoria inactiva', token + ' CAT-INACTIVA', 1, categories[1]);
      for (const suffix of ['%', '_', '!', '\\', "' OR 1=1 --", 'X']) {
        await add(token + suffix, token + suffix);
      }
      // Coincidencias por nombre y por código fuera de la categoría detectan un OR mal agrupado.
      await add(token + ' externo', `${otherPrefix}-2`, 1, categories[4]);
      await add('Externo', token + ' externo', 1, categories[4]);
      const visible = fixtures.filter(p => p.active && [categories[0], categories[4]].includes(p.category));
      for (const [search, expected] of [
        [token.toUpperCase(), visible],
        ['  ' + token + ' taladro  doble  ', [fixtures[0]]],
        [token + ' abc', [fixtures[1]]],
        [token + ' mix', [fixtures[2]]],
        [token + ' missing', []],
        ...['%', '_', '!', '\\', "' OR 1=1 --"].map(suffix => [token + suffix,
          visible.filter(p => p.nombre === token + suffix)]),
        ["' OR 1=1 -- " + token, []],
      ]) {
        for (const categoria of [undefined, ...categories]) {
          const filtered = expected.filter(p => categoria === undefined || p.category === categoria);
          const pages = Math.ceil(filtered.length / 2);
          for (const page of [...Array.from({ length: pages + 2 }, (_, n) => n + 1), 1000000]) {
            const response = await fetch(url + '?' + new URLSearchParams({ busqueda: search, page: String(page), limit: '2',
              ...(categoria === undefined ? {} : { categoria: String(categoria) }) }));
            assert.equal(response.status, 200);
            const { data } = await response.json();
            assert.deepEqual(data.productos, filtered.slice((page - 1) * 2, page * 2).map(p => ({
              id: p.id, nombre: p.nombre, codigo: p.codigo,
              categoria: { id: p.category, nombre: prefix }, disponible: p.stock > 0,
              precio: null, estadoPrecio: 'PENDIENTE_DEFINICION',
            })));
            assert.deepEqual(data.pagination, { page, limit: 2, total: filtered.length, totalPages: pages,
              hasNext: page < pages, hasPrevious: page > 1 && page - 1 <= pages });
          }
        }
      }
      for (const query of ['busqueda=', 'busqueda=%20', 'busqueda=a&busqueda=b',
        'busqueda[]=a', 'busqueda[x]=a', 'busqueda=%00', 'busqueda=' + 'a'.repeat(201),
        'busqueda=a&categoria=0', 'busqueda=%00&categoria=' + categories[0],
        'busqueda=a&categoria=' + categories[0] + '&limit=101']) {
        assert.equal((await fetch(url + '?' + query)).status, 400);
      }
    });

    for (const categoria of [undefined, categories[0]]) {
      for (const busqueda of [undefined, prefix]) {
        await t.test(`inserción concurrente conserva snapshot, categoría ${categoria}, búsqueda ${busqueda}`, async t => {
          const reader = await pool.getConnection();
          const writer = await pool.getConnection();
          let inserted;
          const originalQuery = reader.query.bind(reader);
          try {
            t.mock.method(reader, 'query', async (...args) => {
              const result = await originalQuery(...args);
              const sql = typeof args[0] === 'string' ? args[0] : args[0].sql;
              if (sql.includes('COUNT(*)')) inserted = await addProduct(writer, categories[0], 1, 5);
              return result;
            });
            const connectionMock = t.mock.method(pool, 'getConnection', async () => reader);
            const snapshot = await findCatalogPage({ page: 1, limit: 100, offset: 0, categoria, busqueda });
            connectionMock.mock.restore();
            assert.ok(!snapshot.rows.some(p => p.id_producto === inserted));
            const [now] = await writer.query(`SELECT COUNT(*) AS total FROM PRODUCTO p
              INNER JOIN CATEGORIA c ON p.id_categoria = c.id_categoria WHERE p.activo = 1 AND c.activo = 1
              ${categoria === undefined ? '' : 'AND p.id_categoria = ?'}
              ${busqueda === undefined ? '' : 'AND (p.nombre LIKE ? OR p.codigo LIKE ?)'}`,
              [...(categoria === undefined ? [] : [categoria]),
                ...(busqueda === undefined ? [] : ['%' + prefix + '%', '%' + prefix + '%'])]);
            assert.equal(Number(now.total), snapshot.total + 1);
            if (categoria !== undefined) assert.ok(snapshot.rows.every(p => p.id_categoria === categoria));
          } finally {
            t.mock.restoreAll();
            writer.release();
          }
        });
      }
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    try {
      for (const id of products) await pool.query('DELETE FROM PRODUCTO WHERE id_producto = ?', [id]);
      for (const id of categories) await pool.query('DELETE FROM CATEGORIA WHERE id_categoria = ?', [id]);
    } finally { await pool.end(); }
  }
});