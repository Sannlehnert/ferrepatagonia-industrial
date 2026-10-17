const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { once } = require('node:events');
process.env.JWT_SECRET = 'catalog-test-secret-only';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_NAME = 'catalog_test';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
const { pool } = require('../dist/config/database.config');
const repository = require('../dist/repositories/catalog.repository');
const { parseCatalogPagination } = require('../dist/validators/catalog.validator');
const { app } = require('../dist/app');
let server, url;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = `http://127.0.0.1:${server.address().port}/api/catalogo`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  await pool.end();
});

const row = { id_producto: 7, nombre: 'Taladro', codigo: 'T-7', id_categoria: 2,
  categoria_nombre: 'Herramientas', disponible: 1, precio: '999.99', stock: 15,
  descripcion: 'privado', activo: 1 };
for (const cookie of [undefined, 'jwt_token=invalido']) {
  test(`público con cookie ${cookie}: contrato exacto y precio no publicado`, async t => {
    const stub = t.mock.method(repository, 'findCatalogPage', async () => ({ rows: [row], total: 1 }));
    const response = await fetch(url, { headers: cookie ? { Cookie: cookie } : {} });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(stub.mock.calls[0].arguments, [{ page: 1, limit: 20, offset: 0 }]);
    assert.deepEqual(await response.json(), { data: {
      productos: [{ id: 7, nombre: 'Taladro', codigo: 'T-7', categoria: { id: 2, nombre: 'Herramientas' },
        precio: null, estadoPrecio: 'PENDIENTE_DEFINICION', disponible: true }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNext: false, hasPrevious: false },
    } });
  });
}
for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=1e2', 'page=01', 'page=', 'page=%20',
  'page=%2B1', 'page=1000001', 'page=9007199254740992', 'page=1&page=2', 'page[]=1',
  'page[x]=1', 'limit=0', 'limit=-1', 'limit=101', 'limit=1.5', 'limit=1&limit=2',
  'limit=', 'limit=abc', 'limit=01', 'limit=1e2', 'q=taladro',
  'categoria=0', 'categoria=-1', 'categoria=', 'categoria=01', 'categoria=1.5',
  'categoria=1e2', 'categoria=%20', 'categoria=%2B1', 'categoria=abc',
  'categoria=2147483648', 'categoria=9007199254740992', 'categoria=1&categoria=2',
  'categoria[]=1', 'categoria[id]=1', 'categoria=1%20OR%201=1',
  'page=1%20OR%201=1']) {
  test(`400 sin consultar BD: ${query}`, async t => {
    const stub = t.mock.method(repository, 'findCatalogPage', async () => { throw Error('no ejecutar'); });
    const response = await fetch(`${url}?${query}`);
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(await response.json()), ['message']);
    assert.equal(stub.mock.callCount(), 0);
  });
}
for (const [page, limit, total, length, next, previous] of [
  [1, 20, 0, 0, false, false], [1, 2, 3, 2, true, false],
  [2, 2, 3, 1, false, true], [3, 2, 3, 0, false, true],
  [4, 2, 3, 0, false, false], [1000000, 2, 3, 0, false, false],
  [2, 20, 0, 0, false, false], [3, 20, 0, 0, false, false],
  [1000000, 100, 0, 0, false, false],
]) {
  test(`página ${page}, límite ${limit}, total ${total}`, async t => {
    const stub = t.mock.method(repository, 'findCatalogPage', async () => ({
      rows: Array.from({ length }, (_, i) => ({ ...row, id_producto: i + 1, disponible: 0 })), total,
    }));
    const response = await fetch(`${url}?page=${page}&limit=${limit}`);
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.productos.length, length);
    assert.ok(data.productos.every(p => p.disponible === false));
    assert.deepEqual(data.pagination, { page, limit, total, totalPages: Math.ceil(total / limit),
      hasNext: next, hasPrevious: previous });
    assert.deepEqual(stub.mock.calls[0].arguments, [{ page, limit, offset: (page - 1) * limit }]);
  });
}
test('validador rechaza objetos y arrays, y admite límites mínimos', () => {
  for (const value of [null, [], {}, 1, true, ['1'], 'Infinity']) {
    assert.equal(parseCatalogPagination({ page: value }), null);
    assert.equal(parseCatalogPagination({ categoria: value }), null);
  }
  assert.deepEqual(parseCatalogPagination({ page: '1', limit: '1' }), { page: 1, limit: 1, offset: 0 });
  assert.deepEqual(parseCatalogPagination({ categoria: '2147483647' }),
    { page: 1, limit: 20, offset: 0, categoria: 2147483647 });
});

for (const total of [0, 3]) {
  test(`HTTP propaga categoría y paginación con total ${total}`, async t => {
    const stub = t.mock.method(repository, 'findCatalogPage', async () => ({
      rows: total ? [{ ...row, disponible: 0 }] : [], total,
    }));
    const response = await fetch(`${url}?categoria=2&page=2&limit=2`);
    assert.equal(response.status, 200);
    assert.deepEqual(stub.mock.calls[0].arguments, [{ page: 2, limit: 2, offset: 2, categoria: 2 }]);
    const { data } = await response.json();
    assert.deepEqual(data.pagination, { page: 2, limit: 2, total, totalPages: Math.ceil(total / 2),
      hasNext: false, hasPrevious: total > 0 });
    assert.equal(data.productos.length, total ? 1 : 0);
    for (const product of data.productos) {
      assert.equal(product.disponible, false);
      assert.equal(product.precio, null);
      assert.equal(product.estadoPrecio, 'PENDIENTE_DEFINICION');
    }
  });
}

for (const categoria of [undefined, 2, 2147483647]) {
  test(`COUNT y SELECT comparten predicado y parámetros: categoría ${categoria}`, async t => {
    const queries = [];
    t.mock.method(pool, 'getConnection', async () => ({
      query: async (query, values) => {
        if (typeof query === 'string') return [];
        queries.push({ sql: query.sql, values });
        return query.sql.includes('COUNT(*)') ? [{ total: 0n }] : [];
      },
      commit: async () => {}, release: () => {},
    }));
    await repository.findCatalogPage({ page: 3, limit: 2, offset: 4, categoria });
    const [count, select] = queries;
    const predicate = sql => sql.match(/WHERE\s+(.+?)\s*(?:ORDER BY|$)/s)[1].trim();
    assert.equal(predicate(count.sql), predicate(select.sql));
    assert.equal(predicate(count.sql), 'p.activo = 1 AND c.activo = 1'
      + (categoria === undefined ? '' : ' AND p.id_categoria = ?'));
    assert.deepEqual(count.values, categoria === undefined ? [] : [categoria]);
    assert.deepEqual(select.values, [...count.values, 2, 4]);
  });
}
test('error interno no filtra detalles ni adopta status del driver', async t => {
  t.mock.method(repository, 'findCatalogPage', async () => { throw Object.assign(Error('SQL secreto'), { status: 401 }); });
  t.mock.method(console, 'error', () => {});
  const response = await fetch(url);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { message: 'Error interno del servidor.' });
});

for (const failAt of [null, 'acquire', 'isolation', 'start', 'count', 'rows', 'commit', 'rollback']) {
  test(`repositorio: snapshot, parámetros y limpieza (${failAt})`, async t => {
    const events = [];
    const connection = {
      query: async (query, values) => {
        const sql = typeof query === 'string' ? query : query.sql;
        const step = sql.startsWith('SET') ? 'isolation' : sql.startsWith('START') ? 'start'
          : sql.includes('COUNT(*)') ? 'count' : 'rows';
        events.push(step);
        if (step === failAt || (failAt === 'rollback' && step === 'rows')) throw Error('fallo');
        if (step === 'start') assert.match(sql, /WITH CONSISTENT SNAPSHOT, READ ONLY/);
        if (['count', 'rows'].includes(step)) {
          assert.match(sql, /p\.activo = 1 AND c\.activo = 1/);
          assert.doesNotMatch(sql, /precio/);
        }
        if (step === 'rows') {
          assert.match(sql, /ORDER BY p\.id_producto ASC/);
          assert.match(sql, /LIMIT \? OFFSET \?/);
          assert.deepEqual(values, [2, 4]);
          return [row];
        }
        return step === 'count' ? [{ total: 5n }] : [];
      },
      commit: async () => { events.push('commit'); if (failAt === 'commit') throw Error('fallo'); },
      rollback: async () => { events.push('rollback'); if (failAt === 'rollback') throw Error('fallo'); },
      release: () => events.push('release'), destroy: () => events.push('destroy'),
    };
    t.mock.method(pool, 'getConnection', async () => { if (failAt === 'acquire') throw Error('fallo'); return connection; });
    const action = () => repository.findCatalogPage({ page: 3, limit: 2, offset: 4 });
    if (failAt) {
      await assert.rejects(action, /fallo/);
      if (failAt === 'acquire') assert.deepEqual(events, []);
      else {
        assert.deepEqual(events.slice(-2), ['rollback', 'destroy']);
        assert.ok(!events.includes('release'));
      }
    } else {
      assert.deepEqual(await action(), { rows: [row], total: 5 });
      assert.deepEqual(events, ['isolation', 'start', 'count', 'rows', 'commit', 'release']);
    }
  });
}
