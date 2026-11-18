const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
require('./helpers/integration-lifecycle.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');

test('catálogo público real en MariaDB', { skip: !process.env.CATALOG_TEST_DATABASE }, async t => {
  const { env } = require('../dist/config/env.config');
  assert.equal(env.db.database, process.env.CATALOG_TEST_DATABASE, 'Confirmar base de desarrollo');
  const { pool } = require('../dist/config/catalog-snapshot.config');
  const { app } = require('../dist/app');
  const { findCatalogPage } = require('../dist/repositories/catalog.repository');
  const prefix = `catalog-${randomUUID()}`;
  const categories = [], products = [];
  const productCodes = new Map();
  const evidenceProducts = [], users = [], clients = [], lists = [];
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

    const readDuringWrite = async (subtest, options, write) => {
      const writer = await pool.getConnection();
      try {
        const reader = await pool.getConnection();
        const query = reader.query.bind(reader);
        subtest.mock.method(reader, 'query', async (...args) => {
          const rows = await query(...args);
          if (typeof args[0] !== 'string' && args[0].sql.includes('COUNT(*)')) await write(writer);
          return rows;
        });
        subtest.mock.method(pool, 'getConnection', async () => reader);
        return await findCatalogPage(options);
      } finally {
        subtest.mock.restoreAll();
        writer.release();
      }
    };

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
          codigo VARCHAR(255), imagen VARCHAR(2048), stock INT, activo TINYINT
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

    await t.test('orden configurable: predeterminado, nombre asc/desc, desempate y paginación estable', async () => {
      const orderCategory = Number((await pool.query(
        'INSERT INTO CATEGORIA (nombre, activo) VALUES (?, 1)', [`${prefix}-orden`])).insertId);
      categories.push(orderCategory);
      const inactiveOrderCategory = Number((await pool.query(
        'INSERT INTO CATEGORIA (nombre, activo) VALUES (?, 0)', [`${prefix}-orden-inactiva`])).insertId);
      categories.push(inactiveOrderCategory);

      const ordered = [];
      const addOrdered = async (nombre, { category = orderCategory, active = 1, stock = 1 } = {}) => {
        const codigo = `${prefix}-orden-${ordered.length + 1}`;
        const result = await pool.query(`INSERT INTO PRODUCTO
          (id_categoria, codigo, nombre, precio, stock, activo) VALUES (?, ?, ?, 1234.56, ?, ?)`,
          [category, codigo, nombre, stock, active]);
        const id = Number(result.insertId);
        products.push(id);
        ordered.push({ id, nombre, category, active, stock });
      };
      await addOrdered('Alfa');
      await addOrdered('Bravo');
      await addOrdered('Bravo');
      await addOrdered('Charlie', { stock: 0 });
      await addOrdered('Delta');
      await addOrdered('Echo');
      await addOrdered('AAA producto inactivo', { active: 0 });
      await addOrdered('AAA categoría inactiva', { category: inactiveOrderCategory });
      // Coincide por nombre y por búsqueda, pero fuera de la categoría solicitada.
      await addOrdered('Bravo externo', { category: categories[4] });

      const visible = ordered.filter(p => p.active && p.category === orderCategory);
      const defaultExpected = visible.map(p => p.id).sort((a, b) => a - b);
      const dbOrder = async direction => (await pool.query(`
        SELECT p.id_producto FROM PRODUCTO p
        INNER JOIN CATEGORIA c ON c.id_categoria = p.id_categoria
        WHERE p.id_categoria = ? AND p.activo = 1 AND c.activo = 1
        ORDER BY p.nombre ${direction}, p.id_producto ASC`, [orderCategory]))
        .map(p => Number(p.id_producto));
      const nameAscExpected = await dbOrder('ASC');
      const nameDescExpected = await dbOrder('DESC');
      const bravoIds = visible.filter(p => p.nombre === 'Bravo').map(p => p.id).sort((a, b) => a - b);
      assert.equal(bravoIds.length, 2);
      assert.deepEqual(nameAscExpected.filter(id => bravoIds.includes(id)), bravoIds);
      assert.deepEqual(nameDescExpected.filter(id => bravoIds.includes(id)), bravoIds);

      for (const [label, orden, expected] of [
        ['predeterminado omitido', undefined, defaultExpected],
        ['predeterminado explícito', 'predeterminado', defaultExpected],
        ['nombre ascendente', 'nombre_asc', nameAscExpected],
        ['nombre descendente', 'nombre_desc', nameDescExpected],
      ]) {
        const totalPages = Math.ceil(expected.length / 2);
        const collected = [];
        for (const page of [...Array.from({ length: totalPages + 2 }, (_, i) => i + 1), 1000000]) {
          const response = await fetch(url + '?' + new URLSearchParams({
            categoria: String(orderCategory), limit: '2', page: String(page),
            ...(orden === undefined ? {} : { orden }),
          }));
          assert.equal(response.status, 200, label);
          const { data } = await response.json();
          assert.deepEqual(data.productos.map(p => p.id), expected.slice((page - 1) * 2, page * 2), label);
          assert.deepEqual(data.pagination, { page, limit: 2, total: expected.length, totalPages,
            hasNext: page < totalPages, hasPrevious: page > 1 && page <= totalPages + 1 }, label);
          for (const product of data.productos) {
            assert.ok(!product.nombre.startsWith('AAA'), 'no expone inactivos');
            assert.equal(product.precio, null);
            assert.equal(product.estadoPrecio, 'PENDIENTE_DEFINICION');
            if (product.id === visible.find(p => p.nombre === 'Charlie').id) {
              assert.equal(product.disponible, false);
            }
          }
          collected.push(...data.productos.map(p => p.id));
        }
        assert.deepEqual(collected, expected, label);
        assert.equal(collected.length, expected.length, label);
      }

      for (const orden of ['nombre_asc', 'nombre_desc']) {
        const expected = [];
        for (const page of [1, 2]) {
          const response = await fetch(url + '?' + new URLSearchParams({
            busqueda: 'ravo', categoria: String(orderCategory), orden,
            limit: '1', page: String(page),
          }));
          assert.equal(response.status, 200);
          const { data } = await response.json();
          assert.equal(data.pagination.total, 2);
          assert.equal(data.pagination.totalPages, 2);
          assert.equal(data.pagination.hasNext, page === 1);
          assert.equal(data.pagination.hasPrevious, page === 2);
          expected.push(...data.productos.map(p => p.id));
        }
        assert.deepEqual(expected, bravoIds, 'empate y búsqueda conservan desempate por id');
      }

      const empty = await fetch(url + '?' + new URLSearchParams({
        categoria: String(categories[2]), orden: 'nombre_desc', limit: '2', page: '2',
      }));
      assert.equal(empty.status, 200);
      assert.deepEqual(await empty.json(), { data: { productos: [], pagination: {
        page: 2, limit: 2, total: 0, totalPages: 0, hasNext: false, hasPrevious: false } } });

      for (const query of ['orden=', 'orden=nombre', 'orden=NOMBRE_ASC',
        'orden=PRECIO_ASC', 'orden=precio', 'orden=id_asc', 'orden=nombre%20asc',
        'orden=precio_asc&orden=precio_desc', 'orden=precio_asc&lista=1', 'orden[]=precio_desc',
        'orden=nombre_asc&orden=nombre_desc', 'orden=nombre_asc&orden=nombre_asc',
        'orden[]=nombre_asc', 'orden[x]=nombre_asc',
        'orden=nombre_asc&categoria=0', 'orden=nombre_asc&page=0']) {
        const response = await fetch(url + '?' + query);
        assert.equal(response.status, 400, query);
        assert.deepEqual(Object.keys(await response.json()), ['message'], query);
      }
    });

    await t.test('precio público FER-17 antes de paginar, sin evidencia sintética ni listas de cliente', async t => {
      const category = Number((await pool.query(
        'INSERT INTO CATEGORIA (nombre, activo) VALUES (?, 1)', [`${prefix}-precio`])).insertId);
      categories.push(category);
      const list = Number((await pool.query(
        'INSERT INTO LISTA_PRECIO (nombre, porcentaje_descuento) VALUES (?, 70.00)', [`${prefix}-privada`])).insertId);
      lists.push(list);
      const client = Number((await pool.query(`INSERT INTO CLIENTE
        (tipo_cliente, nombre_razon_social, es_fiel, activo, id_lista_precio) VALUES ('PARTICULAR', ?, 0, 1, ?)`,
      [prefix, list])).insertId);
      clients.push(client);
      const admin = Number((await pool.query(`INSERT INTO USUARIO (email, password_hash, rol, activo)
        VALUES (?, 'test', 'ADMIN', 1)`, [`${prefix}-admin@example.test`])).insertId);
      users.push(admin);
      const customer = Number((await pool.query(`INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo)
        VALUES (?, ?, 'test', 'CLIENTE', 1)`, [client, `${prefix}-cliente@example.test`])).insertId);
      users.push(customer);

      const addPrice = async (label, base, { special = null, verified = base, active = 1, stock = 1,
        evidence = ' Catálogo USD de prueba ', actor = admin, valid = 1, synthetic = 0,
        at = '2020-01-01 00:00:00', categoria = category, matches = true } = {}) => {
        const result = await pool.query(`INSERT INTO PRODUCTO
          (id_categoria, codigo, nombre, precio, descuento_especial_pct, stock, activo)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [categoria, `${prefix}-${matches ? 'ranking-' : ''}${label}`, label, base, special, stock, active]);
        const id = Number(result.insertId);
        products.push(id);
        if (verified !== null) {
          await pool.query(`INSERT INTO PRECIO_USD_EVIDENCIA
            (id_producto, precio_verificado, evidencia, id_admin, verificado_utc, valida, sintetica)
            VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, verified, evidence, actor, at, valid, synthetic]);
          evidenceProducts.push(id);
        }
        return id;
      };
      const missing = await addPrice('sin-base', null);
      const regular = await addPrice('normal', '80.00');
      const finalZero = await addPrice('final-cero', '0.01', { special: '99.99' });
      const promotion = await addPrice('especial', '120.00', { special: '50.00', stock: 0 });
      const rounded = await addPrice('medio-centavo', '2.01', { special: '50.00' });
      const unverified = await addPrice('legacy', '0.02', { verified: null });
      const tied = await addPrice('empate', '1.01');
      const synthetic = await addPrice('sintetico', '900.00', { synthetic: 1 });
      const zero = await addPrice('base-cero', '0.00');
      const stale = await addPrice('obsoleto', '950.00', { verified: '999.00' });
      const revoked = await addPrice('revocado', '0.02', { valid: 0 });
      const future = await addPrice('futuro', '0.03', { at: '2999-01-01 00:00:00' });
      const blank = await addPrice('en-blanco', '0.04', { evidence: '\t\u00a0\ufeff' });
      const wrongRole = await addPrice('rol-no-admin', '0.05', { actor: customer });
      await addPrice('no-coincide', '0.01', { matches: false });
      await addPrice('inactivo', '0.01', { active: 0 });
      await addPrice('categoria-inactiva', '0.01', { categoria: categories[1] });
      await addPrice('otra-categoria', '0.01', { categoria: categories[4] });

      const unavailable = [missing, finalZero, unverified, synthetic, zero, stale, revoked, future, blank, wrongRole];
      const { signToken } = require('../dist/services/token.service');
      const headers = { 'Content-Type': 'application/json',
        Cookie: `jwt_token=${signToken({ id: customer, rol: 'CLIENTE' })}` };
      const quote = async (path, ids) => {
        const response = await fetch(url.replace(/catalogo$/, path), {
          method: 'POST', headers,
          body: JSON.stringify({ moneda: 'USD', productos: ids.map(productoId => ({ productoId, cantidad: 1 })) }),
        });
        assert.equal(response.status, 200, path);
        return (await response.json()).data.productos;
      };
      const quoted = await quote('precios', [rounded, tied, promotion, regular, ...unavailable]);
      assert.deepEqual(quoted.slice(0, 4).map(line => line.precioUnitarioUSD), ['1.01', '1.01', '60.00', '80.00']);
      assert.deepEqual(quoted.slice(4).map(line => line.estadoPrecio), ['PRECIO_AUSENTE', 'FINAL_CERO',
        'BASE_NO_VERIFICADA', 'DEFINIDO', 'BASE_CERO', ...Array(5).fill('BASE_NO_VERIFICADA')]);
      assert.equal(quoted.find(line => line.productoId === synthetic).evidenciaBaseUSD.synthetic, true);
      const personal = await quote('precios/mios', [promotion, regular]);
      assert.deepEqual(personal.map(line => line.precioUnitarioUSD), ['36.00', '24.00']);

      const limit = 3;
      for (const [orden, ranked] of [
        ['precio_asc', [rounded, tied, promotion, regular]],
        ['precio_desc', [regular, promotion, rounded, tied]],
      ]) {
        const expected = [...ranked, ...unavailable];
        const totalPages = Math.ceil(expected.length / limit);
        for (let page = 1; page <= totalPages + 1; page++) {
          const pageUrl = url + '?' + new URLSearchParams({
            orden, categoria: String(category), busqueda: 'ranking-', page: String(page), limit: String(limit),
          });
          const response = await fetch(pageUrl);
          assert.equal(response.status, 200, orden);
          const body = await response.json();
          assert.deepEqual(body.data.productos.map(p => p.id), expected.slice((page - 1) * limit, page * limit));
          assert.deepEqual(body.data.pagination, { page, limit, total: expected.length, totalPages,
            hasNext: page < totalPages, hasPrevious: page > 1 });
          for (const product of body.data.productos) {
            assert.deepEqual(Object.keys(product).sort(),
              ['categoria', 'codigo', 'disponible', 'estadoPrecio', 'id', 'nombre', 'precio']);
            assert.equal(product.precio, null);
            if (product.id === promotion) assert.equal(product.disponible, false);
          }
          const withSession = await fetch(pageUrl, { headers: { Cookie: headers.Cookie } });
          assert.equal(withSession.status, 200);
          assert.equal(withSession.headers.get('set-cookie'), null);
          assert.deepEqual(await withSession.json(), body);
        }
      }

      const page = { page: 1, limit: 2, offset: 0, categoria: category, busqueda: 'ranking-', orden: 'precio_asc' };
      const snapshot = await readDuringWrite(t, page, writer => writer.query(
        'UPDATE PRECIO_USD_EVIDENCIA SET valida = 0 WHERE id_producto = ?', [rounded]));
      assert.equal(snapshot.total, 14);
      assert.deepEqual(snapshot.rows.map(p => p.id_producto), [rounded, tied]);
      const fresh = await findCatalogPage(page);
      assert.equal(fresh.total, 14);
      assert.deepEqual(fresh.rows.map(p => p.id_producto), [tied, promotion]);
    });

    for (const [orden, renamed, deactivated, before, after] of [
      ['nombre_asc', 'Aardvark', 'Delta', ['Charlie', 'Delta'], ['Bravo', 'Echo']],
      ['nombre_desc', 'Zulu', 'Bravo', ['Charlie', 'Bravo'], ['Delta', 'Alfa']],
    ]) {
      await t.test(`TOCTOU ${orden}: renombre y desactivación confirmados entre COUNT y página 2`, async t => {
        const category = Number((await pool.query(
          'INSERT INTO CATEGORIA (nombre, activo) VALUES (?, 1)', [`${prefix}-${orden}`])).insertId);
        categories.push(category);
        const ids = new Map();
        for (const nombre of ['Alfa', 'Bravo', 'Charlie', 'Delta', 'Echo']) {
          const id = await addProduct(pool, category, 1, 1);
          await pool.query('UPDATE PRODUCTO SET nombre = ? WHERE id_producto = ?', [nombre, id]);
          ids.set(nombre, id);
        }
        const page = { page: 2, limit: 2, offset: 2, categoria: category, busqueda: prefix, orden };
        const snapshot = await readDuringWrite(t, page, writer => writer.query(`UPDATE PRODUCTO
          SET nombre = CASE WHEN id_producto = ? THEN ? ELSE nombre END,
              activo = CASE WHEN id_producto = ? THEN 0 ELSE activo END
          WHERE id_producto IN (?, ?)`,
        [ids.get('Charlie'), renamed, ids.get(deactivated), ids.get('Charlie'), ids.get(deactivated)]));
        assert.equal(snapshot.total, 5);
        assert.deepEqual(snapshot.rows.map(p => [p.id_producto, p.nombre]), before.map(name => [ids.get(name), name]));
        const fresh = await findCatalogPage(page);
        assert.equal(fresh.total, 4);
        assert.deepEqual(fresh.rows.map(p => [p.id_producto, p.nombre]), after.map(name => [ids.get(name), name]));
      });
    }

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
      for (const id of evidenceProducts) await pool.query('DELETE FROM PRECIO_USD_EVIDENCIA WHERE id_producto = ?', [id]);
      for (const id of products) await pool.query('DELETE FROM PRODUCTO WHERE id_producto = ?', [id]);
      for (const id of categories) await pool.query('DELETE FROM CATEGORIA WHERE id_categoria = ?', [id]);
      for (const id of users) await pool.query('DELETE FROM USUARIO WHERE id_usuario = ?', [id]);
      for (const id of clients) await pool.query('DELETE FROM CLIENTE WHERE id_cliente = ?', [id]);
      for (const id of lists) await pool.query('DELETE FROM LISTA_PRECIO WHERE id_lista_precio = ?', [id]);
    } finally { await pool.end(); }
  }
});
