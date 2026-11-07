const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mariadb = require('mariadb');
const { app } = require('../dist/app');
const { dataSource, destroyDatabase } = require('../dist/config/database.config');
const { cartAdmission } = require('../dist/services/cart.admission');
const users = require('../dist/repositories/usuario.repository');
const { signToken } = require('../dist/services/token.service');
const { fetchFromBrowser } = require('./helpers/browser-request.cjs');

describe('#246 — operaciones HTTP con Passport, TypeORM y MariaDB', () => {
  let server, base, a, b, admin, category, inactiveCategory, list, p, q;
  const password = 'CartOnly-fixture-123!';
  const sql = (statement, values) => dataSource.query(statement, values);
  const insert = async (statement, values) => (await sql(statement, values)).insertId;
  const session = (id, rol) => 'jwt_token=' + signToken({ id, rol });
  const request = (method, path, actor, body) => fetchFromBrowser(base + path, {
    method,
    headers: {
      ...(actor ? { Cookie: actor.cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const get = async (actor = a) => {
    const res = await request('GET', '/carrito', actor);
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.match(res.headers.get('vary'), /Cookie/);
    return res.json();
  };
  const add = (productoId, cantidad, actor = a) =>
    request('POST', '/carrito/items', actor, { productoId, cantidad });
  const patch = (productoId, cantidad, actor = a) =>
    request('PATCH', '/carrito/items/' + productoId, actor, { cantidad });
  const remove = (productoId, actor = a) => request('DELETE', '/carrito/items/' + productoId, actor);
  const success = async pending => {
    const res = await pending;
    assert.equal(res.status, 204, await res.clone().text());
    assert.equal(await res.text(), '');
  };
  const fails = async (pending, status, code) => {
    const res = await pending;
    assert.equal(res.status, status, await res.clone().text());
    const error = await res.json();
    if (code) assert.equal(error.code, code);
    assert.equal(typeof error.message, 'string');
    assert.doesNotMatch(JSON.stringify(error), /INSERT INTO|SQLSTATE|ER_DUP_ENTRY|test secret/i);
  };

  async function evidence(id, price) {
    await sql(`INSERT INTO PRECIO_USD_EVIDENCIA
      (id_producto, precio_verificado, evidencia, id_admin, verificado_utc, valida, sintetica)
      VALUES (?, ?, 'fixture-246', ?, UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE, 1, 1)
      ON DUPLICATE KEY UPDATE precio_verificado = VALUES(precio_verificado)`, [id, price, admin.id]);
  }

  async function product(code, { stock = 10, price = '100.00', special = null, active = 1,
    categoryId = category, verified = true } = {}) {
    const id = await insert(`INSERT INTO PRODUCTO (codigo, nombre, id_categoria, precio, stock, activo, descuento_especial_pct)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [code, code, categoryId, price, stock, active, special]);
    if (verified && price !== null) await evidence(id, price);
    return id;
  }

  async function client(email, listId = null, active = 1) {
    const clientId = await insert(`INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, es_fiel, activo, id_lista_precio)
      VALUES ('PARTICULAR', ?, 0, ?, ?)`, [email, active, listId]);
    const id = await insert(`INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo)
      VALUES (?, ?, ?, 'CLIENTE', 1)`, [clientId, email, await bcrypt.hash(password, 4)]);
    return { email, id, clientId, cookie: session(id, 'CLIENTE') };
  }

  async function assertStock(id, expected) {
    assert.equal((await sql('SELECT stock FROM PRODUCTO WHERE id_producto = ?', [id]))[0].stock, expected);
  }

  before(async () => {
    assert.match(process.env.CART_TEST_DATABASE ?? '', /^cart_test_[a-f0-9]{32}$/);
    assert.equal(process.env.DB_NAME, process.env.CART_TEST_DATABASE);
    assert.equal(process.env.DB_HOST, '127.0.0.1');
    await dataSource.initialize();
    assert.equal((await sql('SELECT DATABASE() AS db'))[0].db, process.env.CART_TEST_DATABASE);
    const id = await insert("INSERT INTO USUARIO (email, password_hash, rol, activo) VALUES ('admin-246@example.test', 'hash', 'ADMIN', 1)");
    admin = { id, cookie: session(id, 'ADMIN') };
    category = await insert("INSERT INTO CATEGORIA (nombre, activo) VALUES ('Cart 246', 1)");
    inactiveCategory = await insert("INSERT INTO CATEGORIA (nombre, activo) VALUES ('Cart 246 disabled', 0)");
    list = await insert("INSERT INTO LISTA_PRECIO (nombre, porcentaje_descuento, activa) VALUES ('Cart 246 list', 10, 1)");
    a = await client('a-246@example.test', list);
    b = await client('b-246@example.test');
    p = await product('cart-246-a', { price: '10.01', special: '20.00' });
    q = await product('cart-246-b', { price: '2.35', special: '5.00' });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = 'http://127.0.0.1:' + server.address().port + '/api';
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await destroyDatabase();
  });

  test('POST inserta, establece cantidad al repetir y conserva una sola fila', async () => {
    await success(add(p, 2));
    const first = await get();
    assert.equal(first.items[0].cantidad, 2);
    const id = first.items[0].id_item_carrito;
    await success(add(p, 2));
    await success(add(p, 3));
    const snapshot = await get();
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0].id_item_carrito, id);
    assert.equal(snapshot.items[0].cantidad, 3);
    await assertStock(p, 10);
  });

  test('PATCH reemplaza la cantidad y DELETE repetido es idempotente', async () => {
    await success(patch(p, 5));
    await success(patch(p, 5));
    assert.equal((await get()).items[0].cantidad, 5);
    await success(remove(p));
    await success(remove(p));
    await success(remove(2147483647));
    const empty = await get();
    assert.deepEqual(empty.items, []);
    assert.equal(empty.totalUSD, '0.00');
    assert.equal(empty.estado_total, 'DEFINIDO');
    await assertStock(p, 10);
    await fails(patch(p, 1), 404, 'ITEM_INEXISTENTE');
  });

  test('el carrito persiste con logout y nuevo login HTTP', async () => {
    const login = async () => {
      const res = await request('POST', '/auth/login', null, { email: a.email, password });
      assert.equal(res.status, 200);
      const cookie = res.headers.get('set-cookie').split(';', 1)[0];
      assert.match(cookie, /^jwt_token=.+/);
      return { cookie };
    };
    const first = await login();
    const initial = await get(first);
    assert.deepEqual(initial.items, []);
    await success(add(p, 2, first));
    await success(add(q, 1, first));
    const added = await get(first);
    assert.equal(added.id_carrito, initial.id_carrito);
    assert.equal(added.items.find(item => item.id_producto === q).cantidad, 1);
    await success(patch(q, 3, first));
    assert.equal((await get(first)).items.find(item => item.id_producto === q).cantidad, 3);
    await success(remove(q, first));
    const before = await get(first);
    assert.deepEqual(before.items.map(({ id_producto, cantidad }) => [id_producto, cantidad]), [[p, 2]]);
    const logout = await request('POST', '/auth/logout', first);
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /jwt_token=;/);
    await fails(request('GET', '/carrito'), 401);
    const next = await get(await login());
    assert.deepEqual(next, before);
  });

  for (const invalid of [0, -1, 1.5, 2147483648, '2', null]) {
    test('POST y PATCH rechazan cantidad ' + JSON.stringify(invalid), async () => {
      await fails(add(p, invalid), 422, 'CANTIDAD_INVALIDA');
      await fails(patch(p, invalid), 422, 'CANTIDAD_INVALIDA');
      assert.equal((await get()).items.find(item => item.id_producto === p).cantidad, 2);
    });
  }

  test('valida stock para alta y actualización sin persistir intentos inválidos', async () => {
    await fails(add(q, 11), 422, 'STOCK_INSUFICIENTE');
    await fails(patch(p, 11), 422, 'STOCK_INSUFICIENTE');
    assert.deepEqual((await get()).items.map(({ id_producto, cantidad }) => [id_producto, cantidad]), [[p, 2]]);
    await assertStock(p, 10);
  });

  for (const [code, options] of [
    ['PRODUCTO_INACTIVO', { active: 0 }],
    ['PRODUCTO_INACTIVO', { inactiveCategory: true }],
    ['PRECIO_AUSENTE', { price: null }],
    ['BASE_CERO', { price: '0.00' }],
    ['BASE_NO_VERIFICADA', { verified: false }],
    ['FINAL_CERO', { price: '0.01', special: '99.99' }],
    ['IMPORTE_FUERA_DE_RANGO', { price: '9999999999.99' }],
  ]) {
    test('POST rechaza ' + code + ' con opciones ' + JSON.stringify(options), async () => {
      const id = await product('invalid-246-' + code + (options.inactiveCategory ? '-category' : ''), {
        ...options, categoryId: options.inactiveCategory ? inactiveCategory : category,
      });
      await fails(add(id, 2), 422, code);
      assert.equal((await get()).items.some(item => item.id_producto === id), false);
    });
  }

  test('rechaza IDs fuera de rango y distingue producto inexistente', async () => {
    for (const id of [0, -1, 2147483648, 1.5, '1']) await fails(add(id, 1), 400, 'SOLICITUD_INVALIDA');
    for (const id of ['01', '0', '1.5', '2147483648']) await fails(patch(id, 1), 400, 'SOLICITUD_INVALIDA');
    await fails(add(2147483647, 1), 404, 'PRODUCTO_INEXISTENTE');
  });

  test('visitante, ADMIN, sesión alterada, usuario y cliente desactivados', async () => {
    const disabled = await client('disabled-246@example.test', null, 0);
    const inactiveUser = await client('inactive-246@example.test');
    await sql('UPDATE USUARIO SET activo = 0 WHERE id_usuario = ?', [inactiveUser.id]);
    for (const [method, path, body] of [
      ['GET', '/carrito'], ['POST', '/carrito/items', { productoId: p, cantidad: 1 }],
      ['PATCH', '/carrito/items/' + p, { cantidad: 1 }], ['DELETE', '/carrito/items/' + p],
    ]) {
      await fails(request(method, path, null, body), 401);
      await fails(request(method, path, { cookie: a.cookie + 'invalid' }, body), 401);
      await fails(request(method, path, admin, body), 403);
      await fails(request(method, path, inactiveUser, body), 401);
      await fails(request(method, path, disabled, body), 403, 'NO_AUTORIZADO');
    }
  });

  test('campos extra, cuerpos inesperados y query se rechazan; B opera sólo sobre su carrito', async () => {
    const first = await get();
    for (const field of ['clienteId', 'idCarrito', 'precio', 'precioUnitarioUSD', 'descuento',
      'subtotal', 'total', 'id_lista_precio', 'stock']) {
      await fails(request('POST', '/carrito/items', b, { productoId: p, cantidad: 1, [field]: 1 }), 400, 'SOLICITUD_INVALIDA');
    }
    await fails(request('POST', '/carrito/items', b, { productoId: p }), 400, 'SOLICITUD_INVALIDA');
    await fails(request('PATCH', '/carrito/items/' + p, b, { cantidad: 1, productoId: p }), 400, 'SOLICITUD_INVALIDA');
    await fails(request('DELETE', '/carrito/items/' + p, b, {}), 400, 'SOLICITUD_INVALIDA');
    await fails(request('DELETE', '/carrito/items/' + p + '?idCarrito=' + first.id_carrito, b), 400, 'SOLICITUD_INVALIDA');
    await fails(patch(p, 1, b), 404, 'ITEM_INEXISTENTE');
    await success(remove(p, b));
    await success(add(p, 1, b));
    const second = await get(b);
    assert.notEqual(second.id_carrito, first.id_carrito);
    assert.notEqual(second.items[0].id_item_carrito, first.items[0].id_item_carrito);
    assert.equal(second.items[0].cantidad, 1);
    assert.deepEqual(await get(), first);
  });

  test('POST y PATCH rechazan precios y totales del cliente y conservan la cotización del servidor', async () => {
    const actor = await client('tampered-total-246@example.test', list);
    const priceFields = ['total', 'totalUSD', 'precio', 'precioUnitarioUSD', 'subtotal',
      'subtotalUSD', 'descuentoAplicado', 'moneda', 'ivaIncluido'];

    for (const field of priceFields) {
      await fails(request('POST', '/carrito/items', actor, {
        productoId: p, cantidad: 2, [field]: '0.01',
      }), 400, 'SOLICITUD_INVALIDA');
    }
    assert.deepEqual((await get(actor)).items, []);

    await success(add(p, 2, actor));
    for (const field of priceFields) {
      await fails(request('PATCH', '/carrito/items/' + p, actor, {
        cantidad: 3, [field]: '0.01',
      }), 400, 'SOLICITUD_INVALIDA');
    }

    const snapshot = await get(actor);
    assert.deepEqual(snapshot.items.map(({ id_producto, cantidad }) => [id_producto, cantidad]), [[p, 2]]);
    assert.equal(snapshot.items[0].precio.subtotalUSD, '16.02');
    assert.equal(snapshot.totalUSD, '16.02');
  });

  test('protección de origen productiva rechaza mutación cross-origin', async () => {
    await fails(fetch(base + '/carrito/items/' + p, {
      method: 'DELETE', headers: { Origin: 'https://untrusted.example', Cookie: a.cookie },
    }), 403);
    assert.equal((await get()).items[0].cantidad, 2);
  });

  test('lista activa, especial mayor y HALF_UP unitario antes de sumar exacto', async () => {
    await success(add(q, 3));
    const snapshot = await get();
    assert.equal(snapshot.regla, 'FER17-v1');
    assert.equal(snapshot.moneda, 'USD');
    assert.equal(snapshot.ivaIncluido, true);
    assert.equal(snapshot.estado_total, 'DEFINIDO');
    assert.equal(snapshot.totalUSD, '22.38');
    assert.deepEqual(snapshot.items.map(item => item.precio), [
      { estadoPrecio: 'DEFINIDO', precioComprable: true, precioUnitarioUSD: '8.01', subtotalUSD: '16.02',
        descuentoAplicado: '20.00', origenDescuento: 'ESPECIAL_PUBLICO', datosSinteticos: true },
      { estadoPrecio: 'DEFINIDO', precioComprable: true, precioUnitarioUSD: '2.12', subtotalUSD: '6.36',
        descuentoAplicado: '10.00', origenDescuento: 'LISTA', datosSinteticos: true },
    ]);
  });

  test('sin lista se conserva el especial público y la lista inactiva audita una sola vez', async () => {
    await success(add(q, 3, b));
    const readB = await get(b);
    assert.equal(readB.items.find(item => item.id_producto === q).precio.precioUnitarioUSD, '2.23');
    assert.equal(readB.totalUSD, '14.70');
    await sql('UPDATE LISTA_PRECIO SET activa = 0 WHERE id_lista_precio = ?', [list]);
    try {
      assert.equal((await get()).totalUSD, '22.71');
      await get();
      const [row] = await sql('SELECT COUNT(*) AS n FROM FER17_LISTA_INACTIVA_EVENTO WHERE id_cliente = ?', [a.clientId]);
      assert.equal(Number(row.n), 1);
    } finally {
      await sql('UPDATE LISTA_PRECIO SET activa = 1 WHERE id_lista_precio = ?', [list]);
    }
  });

  test('cambios de stock y precio preservan líneas y anulan total hasta corregirlas', async () => {
    await sql('UPDATE PRODUCTO SET stock = 1 WHERE id_producto = ?', [p]);
    let snapshot = await get();
    assert.equal(snapshot.totalUSD, null);
    assert.equal(snapshot.estado_total, 'ITEMS_INCOMPATIBLES');
    assert.equal(snapshot.items[0].motivo_no_disponible, 'SIN_STOCK');
    assert.equal(snapshot.items[0].precio.precioComprable, true);
    assert.equal(snapshot.tiene_incompatibles, true);
    await success(patch(p, 1));
    await sql('UPDATE PRODUCTO SET precio = 12.51 WHERE id_producto = ?', [p]);
    snapshot = await get();
    assert.equal(snapshot.items[0].disponible, true);
    assert.equal(snapshot.items[0].precio.estadoPrecio, 'BASE_NO_VERIFICADA');
    assert.equal(snapshot.items[0].precio.precioUnitarioUSD, null);
    assert.equal(snapshot.totalUSD, null);
    assert.equal(snapshot.items[1].precio.subtotalUSD, '6.36');
    await fails(patch(p, 1), 422, 'BASE_NO_VERIFICADA');
    await evidence(p, '12.51');
    assert.equal((await get()).totalUSD, '16.37');
    await sql('UPDATE PRODUCTO SET stock = 10 WHERE id_producto = ?', [p]);
  });

  test('se puede eliminar un ítem inactivo y sin precio desde un carrito con otros productos', async () => {
    await sql('UPDATE PRODUCTO SET activo = 0, precio = NULL WHERE id_producto = ?', [p]);
    const snapshot = await get();
    assert.equal(snapshot.items[0].motivo_no_disponible, 'INACTIVO');
    assert.equal(snapshot.items[0].precio, null);
    assert.equal(snapshot.total_items, 3);
    assert.equal(snapshot.totalUSD, null);
    await fails(patch(p, 1), 422, 'PRODUCTO_INACTIVO');
    await success(remove(p));
    assert.equal((await get()).totalUSD, '6.36');
    await assertStock(p, 10);
  });

  test('línea y total que exceden el máximo FER-17 quedan visibles', async () => {
    const fresh = await client('overflow-246@example.test');
    const expensive = await product('cart-246-expensive', { price: '6000000000.00' });
    const other = await product('cart-246-expensive-2', { price: '5000000000.00' });
    await success(add(expensive, 1, fresh));
    await success(add(other, 1, fresh));
    let snapshot = await get(fresh);
    assert.equal(snapshot.totalUSD, null);
    assert.equal(snapshot.estado_total, 'IMPORTE_FUERA_DE_RANGO');
    assert.ok(snapshot.items.every(item => item.precio.precioComprable));
    await sql('UPDATE ITEM_CARRITO SET cantidad = 2 WHERE id_item_carrito = ?', [snapshot.items[0].id_item_carrito]);
    snapshot = await get(fresh);
    assert.equal(snapshot.estado_total, 'ITEMS_INCOMPATIBLES');
    assert.equal(snapshot.items[0].error_precio, 'IMPORTE_FUERA_DE_RANGO');
    assert.equal(snapshot.items[1].precio.subtotalUSD, '5000000000.00');
  });

  test('acepta el máximo INT y representa el subtotal exacto', async () => {
    const fresh = await client('max-246@example.test');
    const id = await product('cart-246-max', { price: '0.01', stock: 2147483647 });
    await success(add(id, 2147483647, fresh));
    const snapshot = await get(fresh);
    assert.equal(snapshot.total_items, 2147483647);
    assert.equal(snapshot.items[0].precio.subtotalUSD, '21474836.47');
    assert.equal(snapshot.totalUSD, '21474836.47');
    await assertStock(id, 2147483647);
  });

  test('cotiza más de 100 ítems del mismo carrito sin recortar cantidades', async () => {
    const fresh = await client('wide-246@example.test');
    const { id_carrito } = await get(fresh);
    const ids = [];
    for (let i = 0; i < 101; i++) {
      ids.push(await product('wide-246-' + i, { price: '0.01' }));
    }
    const placeholders = ids.map(() => '(?, ?, 3)').join(', ');
    await sql('INSERT INTO ITEM_CARRITO (id_carrito, id_producto, cantidad) VALUES ' + placeholders,
      ids.flatMap(id => [id_carrito, id]));
    const snapshot = await get(fresh);
    assert.equal(snapshot.items.length, 101);
    assert.equal(snapshot.total_items, 303);
    assert.ok(snapshot.items.every(item => item.precio.subtotalUSD === '0.03'));
    assert.equal(snapshot.totalUSD, '3.03');
  });

  test('dos POST simultáneos en carrito nuevo crean un carrito y una línea, con unicidad física', async () => {
    const fresh = await client('race-246@example.test');
    await Promise.all([success(add(q, 2, fresh)), success(add(q, 2, fresh))]);
    const snapshot = await get(fresh);
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0].cantidad, 2);
    await assert.rejects(sql('INSERT INTO CARRITO (id_cliente) VALUES (?)', [fresh.clientId]), { code: 'ER_DUP_ENTRY' });
    await assert.rejects(sql('INSERT INTO ITEM_CARRITO (id_carrito, id_producto, cantidad) VALUES (?, ?, 2)',
      [snapshot.id_carrito, q]), { code: 'ER_DUP_ENTRY' });
    await assertStock(q, 10);
  });

  test('PATCH simultáneos se serializan y conservan una cantidad absoluta', async () => {
    await Promise.all([success(patch(q, 4)), success(patch(q, 7))]);
    const snapshot = await get();
    assert.equal(snapshot.items.length, 1);
    assert.ok([4, 7].includes(snapshot.items[0].cantidad));
  });

  test('POST y DELETE simultáneos dejan un estado serial válido, sin alterar stock', async () => {
    await Promise.all([success(add(q, 6)), success(remove(q))]);
    const snapshot = await get();
    assert.ok(snapshot.items.length <= 1);
    if (snapshot.items.length) assert.equal(snapshot.items[0].cantidad, 6);
    await assertStock(q, 10);
  });

  async function changeWhileAdding(actor, id, statement, values, errorCode) {
    const writer = dataSource.createQueryRunner();
    await writer.startTransaction();
    let pending;
    try {
      await writer.query(statement, values);
      pending = add(id, 2, actor);
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const rows = await sql('SHOW FULL PROCESSLIST');
        if (rows.some(row => row.Info?.includes('LOCK IN SHARE MODE'))) { blocked = true; break; }
        await delay(20);
      }
      assert.equal(blocked, true, 'la mutación HTTP debe esperar el bloqueo real en InnoDB');
      await writer.commitTransaction();
      await fails(pending, 422, errorCode);
    } finally {
      if (writer.isTransactionActive) await writer.rollbackTransaction();
      await writer.release();
      if (pending) await pending;
    }
    assert.equal((await get(actor)).items.length, 0);
  }

  test('espera cambio concurrente de stock y valida el valor comprometido', async () => {
    const fresh = await client('stock-race-246@example.test');
    const id = await product('cart-246-stock-race');
    await changeWhileAdding(fresh, id, 'UPDATE PRODUCTO SET stock = 1 WHERE id_producto = ?', [id], 'STOCK_INSUFICIENTE');
    await assertStock(id, 1);
  });

  test('espera baja concurrente de categoría y rechaza la escritura', async () => {
    const fresh = await client('active-race-246@example.test');
    const cat = await insert("INSERT INTO CATEGORIA (nombre, activo) VALUES ('Cart 246 lock', 1)");
    const id = await product('cart-246-active-race', { categoryId: cat });
    await changeWhileAdding(fresh, id, 'UPDATE CATEGORIA SET activo = 0 WHERE id_categoria = ?', [cat], 'PRODUCTO_INACTIVO');
  });

  // The observer also owns the row lock, outside the five-connection application pool.
  async function withLockedProduct(id, work) {
    const writer = await mariadb.createConnection({
      host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.CART_TEST_DATABASE,
      user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    });
    try {
      await writer.beginTransaction();
      await writer.query('SELECT id_producto FROM PRODUCTO WHERE id_producto = ? FOR UPDATE', [id]);
      await work(writer);
    } finally {
      try { await writer.rollback(); }
      finally { await writer.end(); }
    }
  }

  const lockQueries = async writer => (await writer.query('SHOW FULL PROCESSLIST'))
    .filter(row => row.Info?.includes('LOCK IN SHARE MODE'));

  async function waitForCatalogLocks(writer, count = 1) {
    const deadline = performance.now() + 1500;
    do {
      if ((await lockQueries(writer)).length === count) return;
      await delay(10);
    } while (performance.now() < deadline);
    assert.fail('No se observaron ' + count + ' esperas reales de catálogo');
  }

  test('un deadlock real de InnoDB revierte el primer intento y confirma una sola línea', async t => {
    const actor = await client('deadlock-246@example.test');
    const cart = await get(actor);
    const products = [q];
    for (let i = 0; i < 8; i++) products.push(await product('deadlock-246-' + i));

    const original = dataSource.createQueryRunner.bind(dataSource);
    let deadlocks = 0;
    const probe = t.mock.method(dataSource, 'createQueryRunner', (...args) => {
      const runner = original(...args);
      const query = runner.query.bind(runner);
      runner.query = async (...params) => {
        try { return await query(...params); }
        catch (error) {
          if (error.driverError?.errno === 1213) deadlocks++;
          throw error;
        }
      };
      return runner;
    });

    let pending;
    try {
      await withLockedProduct(q, async writer => {
        // Give the competing transaction more weight so InnoDB rolls back
        // the cart request, which is still taking locks and has made no writes.
        const placeholders = products.map(() => '?').join(', ');
        await writer.query(`UPDATE PRODUCTO SET stock = stock - 1 WHERE id_producto IN (${placeholders})`, products);
        pending = add(q, 2, actor);
        await waitForCatalogLocks(writer);
        // The cart holds the user and waits on q. Asking for the user while
        // holding q completes the cycle. The helper then rolls back the writer.
        await writer.query('SELECT id_usuario FROM USUARIO WHERE id_usuario = ? FOR UPDATE', [actor.id]);
      });
      await success(pending);
      assert.equal(deadlocks, 1);
      const snapshot = await get(actor);
      assert.equal(snapshot.id_carrito, cart.id_carrito);
      assert.deepEqual(snapshot.items.map(({ id_producto, cantidad }) => [id_producto, cantidad]), [[q, 2]]);
      await assertStock(q, 10);
    } finally {
      if (pending) await pending;
      probe.mock.restore();
    }
  });

  // Pause after taking a real TypeORM connection and before running A's session
  // SELECT. Passport and MariaDB still handle identity and resources normally.
  function pausePassport(t, actor) {
    const reached = new EventTarget();
    const unblock = Promise.withResolvers();
    const original = dataSource.createQueryRunner.bind(dataSource);
    let connected = 0;
    const mock = t.mock.method(dataSource, 'createQueryRunner', (...args) => {
      const runner = original(...args);
      const query = runner.query.bind(runner);
      runner.query = async (sql, params, ...rest) => {
        if (sql.includes('FROM `USUARIO`') && sql.includes('LEFT JOIN `CLIENTE`')
            && params?.length === 1 && params[0] === actor.id) {
          await runner.connect();
          if (++connected === 3) reached.dispatchEvent(new Event('full'));
          await unblock.promise;
        }
        return query(sql, params, ...rest);
      };
      return runner;
    });
    return { reached, connected: () => connected, release: unblock.resolve, restore: () => mock.mock.restore() };
  }

  test('P1: 12 ráfagas de 24 JWT distintos mantienen disponible Passport para otro cliente', async t => {
    assert.equal(dataSource.options.extra.connectionLimit, 5);
    const actor = await client('passport-burst-246@example.test');
    await success(add(q, 2, actor));
    const expected = await get(actor);
    const other = await get(b);
    assert.notEqual(expected.id_carrito, other.id_carrito);
    for (let round = 1; round <= 12; round++) {
      const probe = pausePassport(t, actor);
      const full = once(probe.reached, 'full', { signal: AbortSignal.timeout(1500) });
      const rejected = new EventTarget();
      const overflow = once(rejected, 'full', { signal: AbortSignal.timeout(1500) });
      let finished = 0;
      const tokens = Array.from({ length: 24 }, () => jwt.sign({ id: actor.id, rol: 'CLIENTE' },
        process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '2h', jwtid: randomUUID() }));
      assert.equal(new Set(tokens).size, 24);
      const requests = tokens.map(token => request('GET', '/carrito', { cookie: 'jwt_token=' + token }).then(res => {
        if (++finished === 21) rejected.dispatchEvent(new Event('full'));
        return res;
      }));
      try {
        await Promise.all([full, overflow]);
        const auth = await request('GET', '/auth/me', b);
        assert.equal(auth.status, 200, await auth.clone().text());
        assert.equal((await auth.json()).user.id, b.id);
        assert.equal(probe.connected(), 3, 'tres conexiones reales en Passport');
        assert.equal(finished, 21, 'los tres GET admitidos siguen restaurando su sesión');
        probe.release();
        let ok = 0, conflicts = 0;
        for (const response of await Promise.all(requests)) {
          if (response.status === 200) {
            ok++;
            assert.deepEqual(await response.json(), expected);
          } else {
            conflicts++;
            await fails(response, 409, 'CONFLICTO_CARRITO');
          }
        }
        assert.equal(ok, 3);
        assert.equal(conflicts, 21);
        t.diagnostic(`Ronda ${round}: A 200=${ok}, 409=${conflicts}, 500=0; B=200`);
      } finally {
        probe.release();
        await Promise.allSettled(requests);
        probe.restore();
      }
      assert.deepEqual(await get(actor), expected);
      assert.deepEqual(await get(b), other);
      const runners = Array.from({ length: 5 }, () => dataSource.createQueryRunner());
      try {
        const connections = await Promise.allSettled(runners.map(runner => runner.connect()));
        assert.deepEqual(connections.map(connection => connection.status), Array(5).fill('fulfilled'));
      } finally {
        await Promise.all(runners.map(runner => runner.release()));
      }
    }
  });

  test('P1: una desconexión en Passport conserva la conexión y el cupo hasta que termine la consulta', async t => {
    const actor = await client('passport-abort-246@example.test');
    const probe = pausePassport(t, actor);
    const full = once(probe.reached, 'full', { signal: AbortSignal.timeout(1500) });
    const cancellation = new AbortController();
    const signalReady = Promise.withResolvers();
    const original = cartAdmission.run.bind(cartAdmission);
    const mock = t.mock.method(cartAdmission, 'run', (signal, identify, work) => {
      signalReady.resolve(signal);
      return original(signal, identify, work);
    });
    const first = assert.rejects(fetch(base + '/carrito', {
      signal: cancellation.signal, headers: { Cookie: actor.cookie },
    }), { name: 'AbortError' });
    const serverSignal = await signalReady.promise;
    const others = [request('GET', '/carrito', actor), request('GET', '/carrito', actor)];
    try {
      await full;
      const closed = once(serverSignal, 'abort', { signal: AbortSignal.timeout(1000) });
      cancellation.abort();
      await Promise.all([first, closed]);
      await fails(request('GET', '/carrito', actor), 409, 'CONFLICTO_CARRITO');
      assert.equal(probe.connected(), 3);
      assert.equal((await request('GET', '/auth/me', b)).status, 200);
      probe.release();
      for (const response of await Promise.all(others)) assert.equal(response.status, 200);
    } finally {
      cancellation.abort();
      probe.release();
      await Promise.allSettled([first, ...others]);
      mock.mock.restore();
      probe.restore();
    }
    assert.deepEqual((await get(actor)).items, []);
  });

  test('P1: los errores de Passport liberan el cupo y conservan el error HTTP de autenticación', async t => {
    const original = users.findUsuarioById;
    const mock = t.mock.method(users, 'findUsuarioById', async id => {
      if (id === a.id) throw new Error('test secret');
      return original(id);
    });
    try {
      for (let i = 0; i < 4; i++) await fails(request('GET', '/carrito', a), 500);
      assert.equal((await request('GET', '/auth/me', b)).status, 200);
    } finally {
      mock.mock.restore();
    }
    assert.equal((await request('GET', '/carrito', a)).status, 200);
  });

  test('P1: un POST bloqueado y cuatro GET de A dejan libre la autenticación y el carrito de B', async t => {
    assert.equal(dataSource.options.extra.connectionLimit, 5);
    const actor = await client('admission-p1-246@example.test');
    const otherBefore = await get(b);
    let post;
    try {
      await withLockedProduct(q, async writer => {
        post = add(q, 2, actor);
        await waitForCatalogLocks(writer);
        const allArrived = new EventTarget();
        const arrived = once(allArrived, 'ready', { signal: AbortSignal.timeout(1000) });
        const authenticated = once(allArrived, 'authenticated', { signal: AbortSignal.timeout(1000) });
        const original = cartAdmission.run.bind(cartAdmission);
        let seen = 0;
        let verified = 0;
        let completed = 0;
        const mock = t.mock.method(cartAdmission, 'run', (signal, identify, work) => {
          const result = original(signal, async () => {
            const identity = await identify();
            if (identity?.id === actor.id && ++verified === 2) allArrived.dispatchEvent(new Event('authenticated'));
            return identity;
          }, work);
          if (++seen === 4) allArrived.dispatchEvent(new Event('ready'));
          return result;
        });
        const reads = Array.from({ length: 4 }, () => request('GET', '/carrito', actor).then(res => {
          completed++;
          return res;
        }));
        try {
          await Promise.all([arrived, authenticated]);
          const auth = await request('GET', '/auth/me', b);
          assert.equal(auth.status, 200, await auth.clone().text());
          assert.equal((await auth.json()).user.id, b.id);
          assert.ok(completed < 4, 'B se autentica mientras A aún tiene GET pendientes');
          assert.deepEqual(await get(b), otherBefore);
          await Promise.all(reads.map(read => fails(read, 409, 'CONFLICTO_CARRITO')));
          assert.equal((await lockQueries(writer)).length, 1, 'el POST sigue esperando');
        } finally {
          mock.mock.restore();
          await Promise.allSettled(reads);
        }
      });
      await success(post);
    } finally {
      if (post) await post;
    }
    const snapshot = await get(actor);
    assert.deepEqual(snapshot.items.map(item => [item.id_producto, item.cantidad]), [[q, 2]]);
    await success(patch(q, 3, actor));
    assert.equal((await get(actor)).items[0].cantidad, 3);
    await success(remove(q, actor));
    assert.deepEqual((await get(actor)).items, []);
    assert.deepEqual(await get(b), otherBefore);
    await assertStock(q, 10);
  });

  test('P1: el cuarto cliente recibe 409 antes de Passport con tres transacciones activas', async () => {
    const actors = [];
    for (let i = 0; i < 4; i++) actors.push(await client('admission-global-' + i + '-246@example.test'));
    for (const actor of actors.slice(0, 3)) await success(add(q, 1, actor));
    const posts = [];
    try {
      await withLockedProduct(q, async writer => {
        for (const actor of actors.slice(0, 3)) {
          posts.push(add(q, 2, actor));
          await waitForCatalogLocks(writer, posts.length);
        }
        await fails(request('GET', '/carrito', actors[3]), 409, 'CONFLICTO_CARRITO');
        assert.equal((await lockQueries(writer)).length, 3);
        const auth = await request('GET', '/auth/me', actors[3]);
        assert.equal(auth.status, 200, await auth.clone().text());
        assert.deepEqual(await sql('SELECT id_carrito FROM CARRITO WHERE id_cliente = ?', [actors[3].clientId]), []);
      });
      await Promise.all(posts.map(success));
    } finally {
      await Promise.allSettled(posts);
    }
    assert.deepEqual((await get(actors[3])).items, []);
    for (const actor of actors.slice(0, 3)) assert.equal((await get(actor)).items[0].cantidad, 2);
  });

  test('P1: desconectar un GET en cola cancela su espera antes de ejecutar SQL', async t => {
    const actor = await client('admission-cancel-246@example.test');
    const controller = new AbortController();
    const waiting = Promise.withResolvers();
    const original = cartAdmission.run.bind(cartAdmission);
    let executed = false;
    let post;
    try {
      await withLockedProduct(q, async writer => {
        post = add(q, 2, actor);
        await waitForCatalogLocks(writer);
        const mock = t.mock.method(cartAdmission, 'run', (signal, identify, work) => {
          return original(signal, async () => {
            const identity = await identify();
            waiting.resolve(signal);
            return identity;
          }, async identity => {
            executed = true;
            return work(identity);
          });
        });
        try {
          const response = assert.rejects(fetch(base + '/carrito', {
            signal: controller.signal, headers: { Cookie: actor.cookie },
          }), { name: 'AbortError' });
          const serverSignal = await Promise.race([
            waiting.promise, response.then(() => assert.fail('el GET terminó antes de entrar en admisión')),
          ]);
          const closed = once(serverSignal, 'abort', { signal: AbortSignal.timeout(1000) });
          controller.abort();
          await Promise.all([response, closed]);
        } finally {
          mock.mock.restore();
        }
      });
      await success(post);
    } finally {
      controller.abort();
      if (post) await post;
    }
    assert.equal(executed, false);
    assert.equal((await get(actor)).items[0].cantidad, 2);
  });

  test('P2: esperar el timeout real del producto devuelve 409, revierte y libera la admisión', async () => {
    const actor = await client('lock-timeout-246@example.test');
    await withLockedProduct(q, async writer => {
      const post = add(q, 2, actor);
      try {
        await waitForCatalogLocks(writer);
        // Keep the independent lock until MariaDB ends the application's wait.
        await fails(post, 409, 'CONFLICTO_CARRITO');
        assert.deepEqual(await sql('SELECT id_carrito FROM CARRITO WHERE id_cliente = ?', [actor.clientId]), []);
        await assertStock(q, 10);
      } finally {
        await post;
      }
    });
    const empty = await get(actor);
    assert.deepEqual(empty.items, []);
    assert.equal(empty.totalUSD, '0.00');
    await success(add(q, 2, actor));
    assert.equal((await get(actor)).items[0].cantidad, 2);
    await assertStock(q, 10);
  });

  for (const [scope, status, code] of [
    ['LOCK IN SHARE MODE', 409, 'CONFLICTO_CARRITO'],
    ['PRECIO_USD_EVIDENCIA', 500, 'ERROR_INTERNO'],
  ]) {
    test('P2: clasifica errno 1969 anidado según el contexto ' + scope, async t => {
      const actor = await client('statement-' + status + '-246@example.test');
      const original = dataSource.createQueryRunner.bind(dataSource);
      let injected = 0;
      const mock = t.mock.method(dataSource, 'createQueryRunner', (...args) => {
        const runner = original(...args);
        const query = runner.query.bind(runner);
        runner.query = async (statement, ...params) => {
          if (statement.includes(scope)) {
            injected++;
            throw new Error('test secret', { cause: { driverError: { errno: 1969 } } });
          }
          return query(statement, ...params);
        };
        return runner;
      });
      try {
        await fails(add(q, 2, actor), status, code);
        assert.equal(injected, 1);
        assert.deepEqual(await sql('SELECT id_carrito FROM CARRITO WHERE id_cliente = ?', [actor.clientId]), []);
      } finally {
        mock.mock.restore();
      }
      assert.deepEqual((await get(actor)).items, []);
    });
  }

  test('P2: pérdida del acuse de COMMIT conserva resultado incierto aunque la causa parezca un lock', async t => {
    const actor = await client('unknown-commit-246@example.test');
    const original = dataSource.createQueryRunner.bind(dataSource);
    let commits = 0;
    const mock = t.mock.method(dataSource, 'createQueryRunner', (...args) => {
      const runner = original(...args);
      const commit = runner.commitTransaction.bind(runner);
      runner.commitTransaction = async () => {
        await commit();
        commits++;
        throw new Error('test secret', { cause: { driverError: { code: 'ER_LOCK_WAIT_TIMEOUT' } } });
      };
      return runner;
    });
    try {
      await fails(add(q, 2, actor), 500, 'DATABASE_OUTCOME_UNKNOWN');
      assert.equal(commits, 1);
    } finally {
      mock.mock.restore();
    }
    const snapshot = await get(actor);
    assert.deepEqual(snapshot.items.map(item => [item.id_producto, item.cantidad]), [[q, 2]]);
    await assertStock(q, 10);
  });

  test('P2: un rollback sin confirmación prevalece sobre el código de contención original', async t => {
    const actor = await client('unknown-rollback-246@example.test');
    const original = dataSource.createQueryRunner.bind(dataSource);
    let rollbacks = 0;
    const mock = t.mock.method(dataSource, 'createQueryRunner', (...args) => {
      const runner = original(...args);
      if (args[1] === undefined) return runner;
      const query = runner.query.bind(runner);
      runner.query = async (statement, ...params) => {
        if (statement.includes('INSERT INTO ITEM_CARRITO')) {
          throw new Error('test secret', { cause: { driverError: { errno: 1205 } } });
        }
        return query(statement, ...params);
      };
      runner.rollbackTransaction = async () => {
        rollbacks++;
        throw new Error('test secret');
      };
      return runner;
    });
    try {
      await fails(add(q, 2, actor), 500, 'DATABASE_OUTCOME_UNKNOWN');
      assert.equal(rollbacks, 1);
    } finally {
      mock.mock.restore();
    }
    assert.deepEqual(await sql('SELECT id_carrito FROM CARRITO WHERE id_cliente = ?', [actor.clientId]), []);
    assert.deepEqual((await get(actor)).items, []);
    await success(add(q, 2, actor));
    assert.equal((await get(actor)).items[0].cantidad, 2);
  });

  for (const [sqlstate, errno, status, code] of [
    ['45000', 1644, 500, 'ERROR_INTERNO'],
    ['23000', 1062, 409, 'CONFLICTO_CARRITO'],
  ]) {
    test('revierte carrito, ítem y auditoría ante error SQL ' + errno, async () => {
      const fresh = await client('rollback-' + errno + '-246@example.test', list);
      await sql('UPDATE LISTA_PRECIO SET activa = 0 WHERE id_lista_precio = ?', [list]);
      await sql(`CREATE TRIGGER fail_cart_246 BEFORE INSERT ON ITEM_CARRITO
        FOR EACH ROW SIGNAL SQLSTATE '${sqlstate}' SET MYSQL_ERRNO = ${errno}, MESSAGE_TEXT = 'test secret'`);
      try {
        await fails(add(q, 2, fresh), status, code);
        assert.deepEqual(await sql('SELECT id_carrito FROM CARRITO WHERE id_cliente = ?', [fresh.clientId]), []);
        assert.deepEqual(await sql('SELECT id_evento FROM FER17_LISTA_INACTIVA_EVENTO WHERE id_cliente = ?', [fresh.clientId]), []);
      } finally {
        await sql('DROP TRIGGER fail_cart_246');
        await sql('UPDATE LISTA_PRECIO SET activa = 1 WHERE id_lista_precio = ?', [list]);
      }
      await success(add(q, 2, fresh));
      assert.equal((await get(fresh)).items[0].cantidad, 2);
    });
  }
});
