const { fetchFromBrowser: fetch } = require('./helpers/browser-request.cjs');
require('./helpers/integration-lifecycle.cjs');
require('dotenv/config'); // Carga el .env automáticamente
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAuthUser } = require('./helpers/auth-user.cjs');
const { once } = require('node:events');

// Esta suite altera índices y ejecuta UPDATE sobre toda PRODUCTO. Fallar antes
// de importar el pool o enviar HTTP si no se confirmó una base desechable.
assert.match(process.env.ADMIN_PRODUCTS_TEST_DATABASE || '', /^admin_products_test_[a-f0-9]{32}$/,
    'Use test/helpers/run-admin-products-mariadb.cjs: se requiere una base desechable');
assert.equal(process.env.DB_NAME, process.env.ADMIN_PRODUCTS_TEST_DATABASE);

const RUN_ID = Date.now();
const TEST_PREFIX = `TEST-RUN-${RUN_ID}-SKU-`;

let BASE_URL;

const createdProductIds = [];
const authUsers = [];

// Helper para ejecutar el archivo SQL de migración eliminando directivas DELIMITER de cliente CLI
const runMigrationSql = async (pool) => {
    const sqlPath = path.resolve(__dirname, '../../database/migrate-uq-producto-codigo.sql');
    const rawSql = fs.readFileSync(sqlPath, 'utf8');
    const blockMatch = rawSql.match(/BEGIN NOT ATOMIC[\s\S]*?END\s*(?=\/\/)/);
    assert.ok(blockMatch, 'No se encontró el bloque BEGIN NOT ATOMIC en migrate-uq-producto-codigo.sql');
    await pool.query(blockMatch[0]);
};

describe('Admin Products Endpoints (#197)', () => {
    let adminCookie = '';
    let clientCookie = '';
    let server;
    let categoryCreated = false;
    let fixtureProductId;

    before(async () => {
        const { pool } = require('../dist/config/catalog-snapshot.config.js');
        const { app } = require('../dist/app.js');
        const [identity] = await pool.query('SELECT DATABASE() AS name');
        assert.equal(identity.name, process.env.ADMIN_PRODUCTS_TEST_DATABASE);
        const admin = await createAuthUser(pool); authUsers.push(admin); adminCookie = admin.cookie;
        const client = await createAuthUser(pool, 'CLIENTE'); authUsers.push(client); clientCookie = client.cookie;
        const [count] = await pool.query('SELECT COUNT(*) AS total FROM CATEGORIA');
        assert.equal(Number(count.total), 0, 'Se requiere esquema nuevo, sin seed ni datos compartidos');
        await pool.query("INSERT INTO CATEGORIA (id_categoria, nombre, activo) VALUES (1, 'Test #197', 1)");
        categoryCreated = true;
        const fixture = await pool.query(
            "INSERT INTO PRODUCTO (id_categoria, codigo, nombre, precio, stock, activo) VALUES (1, ?, 'Validation fixture', 1, 1, 1)",
            [`${TEST_PREFIX}VALIDATION`]);
        fixtureProductId = Number(fixture.insertId);
        createdProductIds.push(fixtureProductId);
        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        BASE_URL = `http://127.0.0.1:${server.address().port}/api`;
    });

    it('should return 401 when unauthenticated', async () => {
        const res = await fetch(`${BASE_URL}/admin/productos`);
        assert.equal(res.status, 401);
    });

    it('should return 403 when authenticated as CLIENTE', async () => {
        const res = await fetch(`${BASE_URL}/admin/productos`, {
            headers: { Cookie: clientCookie }
        });
        assert.equal(res.status, 403);
    });

    it('should list all products for ADMIN', async () => {
        const res = await fetch(`${BASE_URL}/admin/productos`, {
            headers: { Cookie: adminCookie }
        });
        assert.equal(res.status, 200);

        const body = await res.json();
        assert.equal(Array.isArray(body), true);
    });

    it('paginates in MariaDB with stable ordering and literal name/SKU matches', async () => {
        const { pool } = require('../dist/config/catalog-snapshot.config.js');
        const list = async (query, cookie = adminCookie) => fetch(
            `${BASE_URL}/admin/productos?${query}`, { headers: { Cookie: cookie } });
        const readPage = async (query) => {
            const res = await list(query);
            assert.equal(res.status, 200);
            return res.json();
        };
        const readIds = body => body.data.map(product => product.id_producto);
        const search = 'busqueda=' + encodeURIComponent(TEST_PREFIX + 'PAGE%_');

        for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=1000001', 'page=1&page=2',
            'limit=0', 'limit=101', 'limit=01', 'busqueda=%20', 'busqueda=%00',
            'busqueda=' + 'x'.repeat(201), 'busqueda[]=x', 'sort=name']) {
            assert.equal((await list(query)).status, 400, query);
        }
        assert.equal((await list('page=1', '')).status, 401);
        assert.equal((await list('page=1', clientCookie)).status, 403);

        const empty = { data: [], page: 1, limit: 20, total: 0, totalPages: 0 };
        assert.deepEqual(await readPage(search), empty);

        const fixtures = [];
        try {
            await pool.query('DELETE FROM PRODUCTO WHERE id_producto = ?', [fixtureProductId]);
            assert.deepEqual(await readPage('page=2'), empty);
        } finally {
            await pool.query(
                "INSERT INTO PRODUCTO (id_producto, id_categoria, codigo, nombre, precio, stock, activo) VALUES (?, 1, ?, 'Validation fixture', 1, 1, 1)",
                [fixtureProductId, `${TEST_PREFIX}VALIDATION`]);
        }

        try {
            for (let index = 1; index <= 8; index++) {
                const marker = index === 8 ? 'PAGEax' : 'PAGE%_';
                const sku = index === 1 ? `${TEST_PREFIX}BY-NAME` : `${TEST_PREFIX}${marker}${index}`;
                const name = index === 1 ? `Nombre ${TEST_PREFIX}${marker}` : 'Prueba de paginación';
                const row = await pool.query(
                    'INSERT INTO PRODUCTO (id_categoria, codigo, nombre, precio, stock, activo) VALUES (1, ?, ?, 1, 1, ?)',
                    [sku, name, index % 2]);
                fixtures.push(Number(row.insertId));
            }
            const expected = fixtures.slice(0, 7).reverse();
            const first = await readPage(`limit=3&${search}`);
            const middle = await readPage(`page=2&limit=3&${search}`);
            const last = await readPage(`page=3&limit=3&${search}`);
            assert.deepEqual([first.page, middle.page, last.page], [1, 2, 3]);
            for (const body of [first, middle, last]) {
                assert.deepEqual([body.limit, body.total, body.totalPages], [3, 7, 3]);
            }
            assert.deepEqual([readIds(first), readIds(middle), readIds(last)],
                [expected.slice(0, 3), expected.slice(3, 6), expected.slice(6)]);
            assert.ok(first.data.some(product => !product.activo));
            assert.deepEqual(await readPage(`page=1000000&limit=3&${search}`), last);
        } finally {
            for (const id of fixtures) await pool.query('DELETE FROM PRODUCTO WHERE id_producto = ?', [id]);
        }
    });

    it('reports the base price evidence state without verifying saved prices', async () => {
        const { pool } = require('../dist/config/catalog-snapshot.config.js');
        const inserted = await pool.query(
            "INSERT INTO PRODUCTO (id_categoria, codigo, nombre, precio, stock, activo) VALUES (1, ?, 'Evidence fixture', 150, 5, 1)",
            [`${TEST_PREFIX}EVIDENCE`]);
        const id = Number(inserted.insertId);
        createdProductIds.push(id);
        const admin = authUsers.find(user => user.rol === 'ADMIN');
        const state = async () => {
            const response = await fetch(`${BASE_URL}/admin/productos`, { headers: { Cookie: adminCookie } });
            assert.equal(response.status, 200);
            return (await response.json()).find(product => product.id_producto === id).estado_precio_base;
        };
        try {
            assert.equal(await state(), 'NO_VERIFICADO');
            await pool.query(`INSERT INTO PRECIO_USD_EVIDENCIA
                (id_producto, precio_verificado, evidencia, id_admin, verificado_utc, valida, sintetica)
                VALUES (?, 150, 'test evidence', ?, UTC_TIMESTAMP(), 1, 0)`, [id, admin.id]);
            assert.equal(await state(), 'VERIFICADO');
            await pool.query('UPDATE PRODUCTO SET activo=0 WHERE id_producto=?', [id]);
            assert.equal(await state(), 'VERIFICADO');
            await pool.query('UPDATE PRODUCTO SET activo=1, precio=160 WHERE id_producto=?', [id]);
            assert.equal(await state(), 'NO_VERIFICADO');
            await pool.query('UPDATE PRECIO_USD_EVIDENCIA SET precio_verificado=160, valida=1, verificado_utc=UTC_TIMESTAMP() + INTERVAL 1 DAY WHERE id_producto=?', [id]);
            assert.equal(await state(), 'NO_VERIFICADO');
            await pool.query('UPDATE PRECIO_USD_EVIDENCIA SET verificado_utc=UTC_TIMESTAMP(), evidencia=CHAR(9) WHERE id_producto=?', [id]);
            assert.equal(await state(), 'NO_VERIFICADO');
            await pool.query('UPDATE PRECIO_USD_EVIDENCIA SET evidencia=? WHERE id_producto=?', [' \tFactura 123\n ', id]);
            assert.equal(await state(), 'VERIFICADO');
            await pool.query("UPDATE PRECIO_USD_EVIDENCIA SET evidencia='test evidence', valida=0 WHERE id_producto=?", [id]);
            assert.equal(await state(), 'NO_VERIFICADO');
            await pool.query('UPDATE PRECIO_USD_EVIDENCIA SET valida=1, sintetica=1 WHERE id_producto=?', [id]);
            assert.equal(await state(), 'SINTETICO');
            await pool.query('UPDATE PRODUCTO SET precio=0 WHERE id_producto=?', [id]);
            assert.equal(await state(), 'BASE_CERO');
            await pool.query('UPDATE PRODUCTO SET precio=NULL WHERE id_producto=?', [id]);
            assert.equal(await state(), 'SIN_PRECIO');
        } finally {
            await pool.query('DELETE FROM PRECIO_USD_EVIDENCIA WHERE id_producto=?', [id]);
        }
    });

    it('should return 400 on invalid product creation data, missing body, or fields exceeding max length', async () => {
        const res = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: {
                Cookie: adminCookie,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id_categoria: 1,
                codigo: '',
                nombre: 'Producto Inválido',
                precio: -50,
                stock: -1
            })
        });
        assert.equal(res.status, 400);

        const emptyPostRes = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: {
                Cookie: adminCookie,
                'Content-Type': 'application/json'
            }
        });
        assert.equal(emptyPostRes.status, 400);

        const emptyPutRes = await fetch(`${BASE_URL}/admin/productos/${fixtureProductId}`, {
            method: 'PUT',
            headers: {
                Cookie: adminCookie,
                'Content-Type': 'application/json'
            }
        });
        assert.equal(emptyPutRes.status, 400);

        const tooLongRes = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: {
                Cookie: adminCookie,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id_categoria: 1,
                codigo: 'A'.repeat(101),
                nombre: 'B'.repeat(201),
                precio: 100,
                stock: 10
            })
        });
        assert.equal(tooLongRes.status, 400);
    });

    it('should create and update a product as ADMIN', async () => {
        const createRes = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: {
                Cookie: adminCookie,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id_categoria: 1,
                codigo: `${TEST_PREFIX}1`,
                nombre: 'Taladro Test 197',
                precio: 1500.50,
                stock: 10,
                activo: true
            })
        });

        const createdBody = await createRes.json();
        if (createdBody && createdBody.id_producto) {
            createdProductIds.push(createdBody.id_producto);
        }
        assert.equal(createRes.status, 201, `Fallo creacion: ${createdBody.message || ''}`);
        const createdId = createdBody.id_producto;

        const updateRes = await fetch(`${BASE_URL}/admin/productos/${createdId}`, {
            method: 'PUT',
            headers: {
                Cookie: adminCookie,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                nombre: 'Taladro Test 197 Editado',
                precio: 1.239
            })
        });

        assert.equal(updateRes.status, 200, 'Fallo la actualizacion del producto');
        const updatedBody = await updateRes.json();
        assert.equal(updatedBody.nombre, 'Taladro Test 197 Editado');
        const { pool } = require('../dist/config/catalog-snapshot.config.js');
        const [persisted] = await pool.query('SELECT precio FROM PRODUCTO WHERE id_producto = ?', [createdId]);
        assert.equal(Number(persisted.precio), 1.24);
        assert.equal(updatedBody.precio, persisted.precio);
        const readRes = await fetch(`${BASE_URL}/admin/productos/${createdId}`, { headers: { Cookie: adminCookie } });
        assert.equal(readRes.status, 200);
        assert.equal((await readRes.json()).precio, persisted.precio);
    });

    it('should soft-delete (deactivate) a product idempotently', async () => {
        const createRes = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_categoria: 1,
                codigo: `${TEST_PREFIX}DEACT`,
                nombre: 'Producto a desactivar',
                precio: 100,
                stock: 5,
                activo: true
            })
        });
        const createdBody = await createRes.json();
        if (createdBody && createdBody.id_producto) {
            createdProductIds.push(createdBody.id_producto);
        }
        assert.equal(createRes.status, 201, `Fallo creacion: ${createdBody.message || ''}`);
        const createdId = createdBody.id_producto;

        const deactRes1 = await fetch(`${BASE_URL}/admin/productos/${createdId}/desactivar`, {
            method: 'PATCH',
            headers: { Cookie: adminCookie }
        });
        assert.equal(deactRes1.status, 200, 'Fallo la primera desactivacion');

        const body1 = await deactRes1.json();
        assert.equal(Boolean(body1.product.activo), false, 'El producto sigue activo');

        const deactRes2 = await fetch(`${BASE_URL}/admin/productos/${createdId}/desactivar`, {
            method: 'PATCH',
            headers: { Cookie: adminCookie }
        });
        assert.equal(deactRes2.status, 200, 'Fallo la idempotencia');
    });

    it('should update product stock successfully', async () => {
        const createRes = await fetch(`${BASE_URL}/admin/productos`, {
            method: 'POST',
            headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_categoria: 1,
                codigo: `${TEST_PREFIX}STOCK`,
                nombre: 'Producto para Stock',
                precio: 100,
                stock: 5,
                activo: true
            })
        });
        const createdBody = await createRes.json();
        if (createdBody && createdBody.id_producto) {
            createdProductIds.push(createdBody.id_producto);
        }
        assert.equal(createRes.status, 201, `Fallo creacion: ${createdBody.message || ''}`);
        const createdId = createdBody.id_producto;

        const updateRes = await fetch(`${BASE_URL}/admin/productos/${createdId}/stock`, {
            method: 'PATCH',
            headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ stock: 25 })
        });

        assert.equal(updateRes.status, 200, 'Fallo la actualización de stock');
        const body = await updateRes.json();
        assert.equal(body.product.stock, 25);
    });

    it('should return 400 when updating with negative stock', async () => {
        const updateRes = await fetch(`${BASE_URL}/admin/productos/${fixtureProductId}/stock`, {
            method: 'PATCH',
            headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ stock: -10 })
        });

        assert.equal(updateRes.status, 400);
    });

    it('should return 400 when updating stock with invalid data types or out of range', async () => {
        const invalidStocks = [
            true,
            false,
            null,
            [5],
            '10',
            3000000000
        ];

        for (const badStock of invalidStocks) {
            const res = await fetch(`${BASE_URL}/admin/productos/${fixtureProductId}/stock`, {
                method: 'PATCH',
                headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
                body: JSON.stringify({ stock: badStock })
            });
            assert.equal(res.status, 400, `Falló validando el valor: ${JSON.stringify(badStock)}`);
        }
    });

    it('should return 400 when updating stock without a body', async () => {
        const res = await fetch(`${BASE_URL}/admin/productos/${fixtureProductId}/stock`, {
            method: 'PATCH',
            headers: { Cookie: adminCookie, 'Content-Type': 'application/json' }
        });
        assert.equal(res.status, 400);
    });

    it('should return persisted price precision (1.24 for 1.239) in fallback when post-INSERT SELECT fails', async (t) => {
        const repo = require('../dist/repositories/adminProduct.repository.js');
        const { createAdminProduct } = require('../dist/services/adminProduct.service.js');

        // Simulamos fallo del SELECT posterior al INSERT
        t.mock.method(repo, 'findById', async () => {
            throw new Error('Fallo simulado de lectura post-INSERT');
        });

        const fallbackResult = await createAdminProduct({
            id_categoria: 1,
            codigo: `${TEST_PREFIX}FALLBACK-PRICE`,
            nombre: 'Producto Fallback Decimal',
            precio: 1.239,
            stock: 4,
            activo: true
        });

        t.mock.restoreAll();

        if (fallbackResult && fallbackResult.id_producto) {
            createdProductIds.push(fallbackResult.id_producto);
        }

        const persistedRow = await repo.findById(fallbackResult.id_producto);
        assert.ok(persistedRow, 'El producto debe existir en MariaDB');
        assert.equal(Number(persistedRow.precio), 1.24);
        assert.equal(Number(fallbackResult.precio), Number(persistedRow.precio));
        assert.equal(fallbackResult.precio, persistedRow.precio);
    });

    it('migration should trim leading and trailing spaces in SKU, validate UNIQUE index definition, and be idempotent', async () => {
        const { pool } = require('../dist/config/catalog-snapshot.config.js');
        const baseLeadSku = `${TEST_PREFIX}MIG-LEAD`;
        const baseTrailSku = `${TEST_PREFIX}MIG-TRAIL`;
        const baseBothSku = `${TEST_PREFIX}MIG-BOTH`;

        // Insertamos directamente en SQL con espacios iniciales, finales y ambos
        const resLead = await pool.query(
            'INSERT INTO PRODUCTO (id_categoria, codigo, nombre, precio, stock, activo) VALUES (1, ?, ?, 10.00, 1, 1)',
            [`   ${baseLeadSku}`, 'Test Leading Spaces']
        );
        createdProductIds.push(Number(resLead.insertId));

        const resTrail = await pool.query(
            'INSERT INTO PRODUCTO (id_categoria, codigo, nombre, precio, stock, activo) VALUES (1, ?, ?, 10.00, 1, 1)',
            [`${baseTrailSku}    `, 'Test Trailing Spaces']
        );
        createdProductIds.push(Number(resTrail.insertId));

        const resBoth = await pool.query(
            'INSERT INTO PRODUCTO (id_categoria, codigo, nombre, precio, stock, activo) VALUES (1, ?, ?, 10.00, 1, 1)',
            [`  ${baseBothSku}   `, 'Test Both Spaces']
        );
        createdProductIds.push(Number(resBoth.insertId));

        // Ejecutamos la migración 2 veces seguidas (prueba de idempotencia)
        await runMigrationSql(pool);
        await runMigrationSql(pool);

        const rows = await pool.query(
            'SELECT id_producto, codigo, CHAR_LENGTH(codigo) AS len FROM PRODUCTO WHERE id_producto IN (?, ?, ?)',
            [Number(resLead.insertId), Number(resTrail.insertId), Number(resBoth.insertId)]
        );

        const byId = new Map(rows.map((r) => [r.id_producto, r]));
        assert.equal(byId.get(Number(resLead.insertId)).codigo, baseLeadSku);
        assert.equal(Number(byId.get(Number(resLead.insertId)).len), baseLeadSku.length);

        assert.equal(byId.get(Number(resTrail.insertId)).codigo, baseTrailSku);
        assert.equal(Number(byId.get(Number(resTrail.insertId)).len), baseTrailSku.length);

        assert.equal(byId.get(Number(resBoth.insertId)).codigo, baseBothSku);
        assert.equal(Number(byId.get(Number(resBoth.insertId)).len), baseBothSku.length);

        // Verificamos que si el índice uq_producto_codigo es reemplazado por un índice NO-UNIQUE, la migración lo corrige
        await pool.query('ALTER TABLE PRODUCTO DROP INDEX uq_producto_codigo');
        await pool.query('ALTER TABLE PRODUCTO ADD INDEX uq_producto_codigo (codigo)');

        await runMigrationSql(pool);

        const indexStats = await pool.query(
            `SELECT NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX, SUB_PART
                FROM INFORMATION_SCHEMA.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'PRODUCTO'
                    AND INDEX_NAME = 'uq_producto_codigo'`
        );
        assert.equal(indexStats.length, 1);
        assert.equal(Number(indexStats[0].NON_UNIQUE), 0);
        assert.equal(indexStats[0].COLUMN_NAME, 'codigo');
        assert.equal(Number(indexStats[0].SEQ_IN_INDEX), 1);
        assert.equal(indexStats[0].SUB_PART, null);
    });

    it('migration rejects blank and duplicate normalized SKUs before changing data or indexes', async () => {
        const { pool } = require('../dist/config/catalog-snapshot.config.js');
        const snapshot = async () => ({
            rows: Array.from(await pool.query('SELECT * FROM PRODUCTO ORDER BY id_producto')),
            indexes: Array.from(await pool.query('SHOW INDEX FROM PRODUCTO')),
        });
        const cases = [
            { codes: [''], message: /codigo nulo o vacio/ },
            { codes: ['   '], message: /codigo nulo o vacio/ },
            { codes: ['DUP', 'DUP'], message: /SKU duplicados/ },
            { codes: [' DUP', 'DUP '], message: /SKU duplicados/ },
            { codes: ['caf\u00e9', 'CAFE'], message: /SKU duplicados/ },
        ];
        for (const { codes, message } of cases) {
            const ids = [];
            await pool.query('ALTER TABLE PRODUCTO DROP INDEX uq_producto_codigo');
            try {
                // El centinela también debe conservar espacios al abortar.
                for (const codigo of [...codes, `${TEST_PREFIX} UNTRIMMED `]) {
                    const result = await pool.query(
                        "INSERT INTO PRODUCTO (id_categoria, codigo, nombre, precio, stock, activo) VALUES (1, ?, 'Migration rejection', 1, 1, 1)", [codigo]);
                    ids.push(Number(result.insertId));
                    createdProductIds.push(Number(result.insertId));
                }
                const before = await snapshot();
                await assert.rejects(runMigrationSql(pool), error => {
                    assert.equal(error.sqlState, '45000');
                    assert.match(error.message, message);
                    return true;
                });
                assert.deepEqual(await snapshot(), before, 'El rechazo no debe modificar filas ni índices');
            } finally {
                if (ids.length) await pool.query(`DELETE FROM PRODUCTO WHERE id_producto IN (${ids.map(() => '?').join(',')})`, ids);
                await runMigrationSql(pool);
            }
        }
    });

    it('#222: invalid DTOs leave MariaDB unchanged; partial null updates preserve omitted values', async () => {
        const { pool } = require('../dist/config/catalog-snapshot.config.js');
        const snapshot = async () => JSON.stringify(await pool.query('SELECT * FROM PRODUCTO ORDER BY id_producto'));
        const before = await snapshot();
        const valid = { nombre: 'DTO', codigo: `${TEST_PREFIX}DTO`, id_categoria: 1, precio: 1.239, stock: 0 };
        const send = (method, suffix, body) => fetch(`${BASE_URL}/admin/productos${suffix}`, {
            method, headers: { Cookie: adminCookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        for (const [method, suffix, body] of [
            ['POST', '', { ...valid, activo: 'false' }],
            ['POST', '', { ...valid, extra: 'ignored before #222' }],
            ['POST', '', { ...valid, id_categoria: 2147483647, stock: null }],
            ['PUT', `/${fixtureProductId}`, { nombre: null }],
            ['PUT', `/${fixtureProductId}`, { descripcion: {}, precio: 3 }],
            ['PUT', '/2147483647', { precio: '3' }],
            ['PATCH', `/${fixtureProductId}/stock`, { stock: '5' }],
            ['PATCH', `/${fixtureProductId}/stock`, { stock: 5, permisos: 'ADMIN' }],
        ]) assert.equal((await send(method, suffix, body)).status, 400);
        assert.equal(await snapshot(), before, 'No invalid input can change persisted products');
        assert.equal((await send('POST', '', { ...valid, id_categoria: 2147483647 })).status, 404);
        assert.equal((await send('PUT', '/2147483647', { nombre: 'valid' })).status, 404);
        const created = await send('POST', '', { ...valid, descripcion: 'before', imagen: 'before' });
        assert.equal(created.status, 201);
        const body = await created.json(); createdProductIds.push(body.id_producto);
        assert.equal(body.precio, '1.24');
        const cleared = await send('PUT', `/${body.id_producto}`, { descripcion: null, imagen: null });
        assert.equal(cleared.status, 200);
        const result = await cleared.json();
        assert.equal(result.descripcion, null); assert.equal(result.imagen, null);
        for (const key of ['nombre', 'codigo', 'precio', 'stock', 'id_categoria', 'activo']) assert.equal(result[key], body[key]);
    });

    it('H05: preserva precio NULL al actualizar unicamente el nombre del producto (#240)', async () => {
        const { pool } = require('../dist/config/catalog-snapshot.config.js');
        const testSku = `${TEST_PREFIX}H05-NULL`;

        const insertResult = await pool.query(
            "INSERT INTO PRODUCTO (id_categoria, codigo, nombre, precio, stock, activo) VALUES (1, ?, 'Producto Original Sin Precio', NULL, 10, 1)",
            [testSku]
        );
        const productId = Number(insertResult.insertId);
        createdProductIds.push(productId);

        const updateRes = await fetch(`${BASE_URL}/admin/productos/${productId}`, {
            method: 'PUT',
            headers: {
                Cookie: adminCookie,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id_categoria: 1,
                codigo: testSku,
                nombre: 'Producto Con Nombre Modificado',
                stock: 10,
                descripcion: null,
                imagen: null,
                activo: true
            })
        });

        assert.equal(updateRes.status, 200, 'La actualizacion debio responder 200 OK');
        const body = await updateRes.json();
        assert.equal(body.nombre, 'Producto Con Nombre Modificado');
        assert.equal(body.precio, null, 'El campo precio en la respuesta debe mantenerse en null');

        const [persisted] = await pool.query(
            'SELECT nombre, precio FROM PRODUCTO WHERE id_producto = ?',
            [productId]
        );
        assert.equal(persisted.nombre, 'Producto Con Nombre Modificado');
        assert.equal(persisted.precio, null, 'El precio en la base de datos debe ser NULL y no 0.00');
    });

    // Limpiar la BD exclusivamente por los IDs creados y cerrar conexión siempre
    after(async () => {
        const { pool } = require('../dist/config/catalog-snapshot.config.js');
        if (pool) {
            try {
                if (createdProductIds.length > 0) {
                    const placeholders = createdProductIds.map(() => '?').join(', ');
                    await pool.query(
                        `DELETE FROM PRODUCTO WHERE id_producto IN (${placeholders})`,
                        createdProductIds
                    );
                }
                if (categoryCreated) await pool.query('DELETE FROM CATEGORIA WHERE id_categoria = 1');
            } finally {
                try {
                    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
                } finally {
                    try { for (const user of authUsers) await user.destroy(); }
                    finally { await pool.end(); }
                }
            }
        }
    });
});