const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { app } = require('../dist/app');
const { dataSource } = require('../dist/config/database.config');
const { signToken } = require('../dist/services/token.service');

describe('Task #245 — Persistencia y Modelo del Carrito (H01, H02, H03)', () => {
    let server;
    let url;
    let client1Cookie;
    let client2Cookie;
    let adminCookie;

    let idCategoriaTest;
    let idProductoStockSuficiente;
    let idProductoStockBajo;
    let idProductoInactivo;
    let idCliente1;
    let idCliente2;
    let idUsuario1;
    let idUsuario2;
    let idUsuarioAdmin;

    const PREFIX = `TEST_CART_${Date.now()}_`;

    before(async () => {
        assert.match(process.env.CART_TEST_DATABASE ?? '', /^cart_test_[a-f0-9]{32}$/);
        assert.equal(process.env.DB_NAME, process.env.CART_TEST_DATABASE);
        assert.equal(process.env.DB_HOST, '127.0.0.1');
        if (dataSource && !dataSource.isInitialized) {
            await dataSource.initialize();
        }

        // H03: Candado defensivo. Solo se ejecuta sobre bases descartables efímeras
        const [dbInfo] = await dataSource.query('SELECT DATABASE() AS db_name');
        assert.equal(dbInfo?.db_name, process.env.CART_TEST_DATABASE);

        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        url = `http://127.0.0.1:${server.address().port}`;

        // Fixture: Categoría de prueba
        const catRes = await dataSource.query(
            'INSERT INTO CATEGORIA (nombre, activo) VALUES (?, 1)',
            [`${PREFIX}CAT`]
        );
        idCategoriaTest = catRes.insertId;

        // Fixtures: Productos aislados
        const p1 = await dataSource.query(
            'INSERT INTO PRODUCTO (codigo, nombre, id_categoria, precio, stock, activo) VALUES (?, ?, ?, 150.00, 10, 1)',
            [`${PREFIX}SKU1`, 'Prod Stock Suficiente', idCategoriaTest]
        );
        idProductoStockSuficiente = p1.insertId;

        const p2 = await dataSource.query(
            'INSERT INTO PRODUCTO (codigo, nombre, id_categoria, precio, stock, activo) VALUES (?, ?, ?, 250.00, 1, 1)',
            [`${PREFIX}SKU2`, 'Prod Stock Insuficiente', idCategoriaTest]
        );
        idProductoStockBajo = p2.insertId;

        const p3 = await dataSource.query(
            'INSERT INTO PRODUCTO (codigo, nombre, id_categoria, precio, stock, activo) VALUES (?, ?, ?, 350.00, 5, 0)',
            [`${PREFIX}SKU3`, 'Prod Inactivo', idCategoriaTest]
        );
        idProductoInactivo = p3.insertId;

        // Fixtures: Clientes aislados
        const c1 = await dataSource.query(
            'INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, es_fiel, activo) VALUES ("PARTICULAR", ?, 0, 1)',
            [`${PREFIX}Cliente1`]
        );
        idCliente1 = c1.insertId;

        const c2 = await dataSource.query(
            'INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, es_fiel, activo) VALUES ("PARTICULAR", ?, 0, 1)',
            [`${PREFIX}Cliente2`]
        );
        idCliente2 = c2.insertId;

        // Fixtures: Usuarios clientes
        const u1 = await dataSource.query(
            'INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo) VALUES (?, ?, "hash_test", "CLIENTE", 1)',
            [idCliente1, `${PREFIX}u1@test.com`]
        );
        idUsuario1 = u1.insertId;

        const u2 = await dataSource.query(
            'INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo) VALUES (?, ?, "hash_test", "CLIENTE", 1)',
            [idCliente2, `${PREFIX}u2@test.com`]
        );
        idUsuario2 = u2.insertId;

        // Fixture: Usuario ADMIN real persistido para validar el 403
        const uAdmin = await dataSource.query(
            'INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo) VALUES (NULL, ?, "hash_test", "ADMIN", 1)',
            [`${PREFIX}admin@test.com`]
        );
        idUsuarioAdmin = uAdmin.insertId;

        // Credenciales JWT vinculadas a usuarios existentes en la base efímera
        client1Cookie = `jwt_token=${signToken({ id: idUsuario1, rol: 'CLIENTE', exp: Math.floor(Date.now() / 1000) + 7200 })}`;
        client2Cookie = `jwt_token=${signToken({ id: idUsuario2, rol: 'CLIENTE', exp: Math.floor(Date.now() / 1000) + 7200 })}`;
        adminCookie = `jwt_token=${signToken({ id: idUsuarioAdmin, rol: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 7200 })}`;
    });

    after(async () => {
        try {
            if (dataSource && dataSource.isInitialized) {
                await dataSource.query('DELETE FROM ITEM_CARRITO WHERE id_producto IN (?, ?, ?)', [
                    idProductoStockSuficiente,
                    idProductoStockBajo,
                    idProductoInactivo
                ]);
                await dataSource.query('DELETE FROM CARRITO WHERE id_cliente IN (?, ?)', [idCliente1, idCliente2]);
                await dataSource.query('DELETE FROM USUARIO WHERE id_usuario IN (?, ?, ?)', [
                    idUsuario1,
                    idUsuario2,
                    idUsuarioAdmin
                ]);
                await dataSource.query('DELETE FROM CLIENTE WHERE id_cliente IN (?, ?)', [idCliente1, idCliente2]);
                await dataSource.query('DELETE FROM PRODUCTO WHERE id_producto IN (?, ?, ?)', [
                    idProductoStockSuficiente,
                    idProductoStockBajo,
                    idProductoInactivo
                ]);
                await dataSource.query('DELETE FROM CATEGORIA WHERE id_categoria = ?', [idCategoriaTest]);
            }
        } catch {}

        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }

        const db = require('../dist/config/database.config');
        if (typeof db.destroyDatabase === 'function') {
            await db.destroyDatabase();
        } else if (db.dataSource && db.dataSource.isInitialized) {
            await db.dataSource.destroy();
        }
    });

    test('Rechaza con 401 si el usuario no está autenticado', async () => {
        const res = await fetch(`${url}/api/carrito`);
        assert.equal(res.status, 401);
    });

    test('Rechaza con 403 si un usuario ADMIN intenta consultar carrito', async () => {
        const res = await fetch(`${url}/api/carrito`, {
            headers: { Cookie: adminCookie }
        });
        assert.equal(res.status, 403);
    });

    test('Auditoría H01: dos primeras consultas simultáneas del mismo cliente devuelven 200 con idéntico ID', async () => {
        const [resA, resB] = await Promise.all([
            fetch(`${url}/api/carrito`, { headers: { Cookie: client2Cookie } }),
            fetch(`${url}/api/carrito`, { headers: { Cookie: client2Cookie } })
        ]);

        assert.equal(resA.status, 200, 'La primera solicitud concurrente debe responder 200');
        assert.equal(resB.status, 200, 'La segunda solicitud concurrente debe responder 200');

        const dataA = await resA.json();
        const dataB = await resB.json();

        assert.equal(dataA.id_carrito, dataB.id_carrito, 'Ambas consultas deben recibir el mismo carrito');
        assert.equal(dataA.total_items, 0);
        assert.deepEqual(dataA.items, []);
    });

    test('Auditoría H02: cantidad 3 con stock 1 responde disponible: false y SIN_STOCK', async () => {
        const cartRows = await dataSource.query('SELECT id_carrito FROM CARRITO WHERE id_cliente = ?', [idCliente1]);
        let cartId = cartRows[0]?.id_carrito;
        if (!cartId) {
            const created = await dataSource.query('INSERT INTO CARRITO (id_cliente) VALUES (?)', [idCliente1]);
            cartId = created.insertId;
        }

        await dataSource.query('DELETE FROM ITEM_CARRITO WHERE id_carrito = ?', [cartId]);

        // 1. Ítem con stock suficiente (cantidad 2, stock 10)
        await dataSource.query(
            'INSERT INTO ITEM_CARRITO (id_carrito, id_producto, cantidad) VALUES (?, ?, 2)',
            [cartId, idProductoStockSuficiente]
        );

        // 2. H02: Ítem con stock insuficiente (cantidad 3, stock 1)
        await dataSource.query(
            'INSERT INTO ITEM_CARRITO (id_carrito, id_producto, cantidad) VALUES (?, ?, 3)',
            [cartId, idProductoStockBajo]
        );

        // 3. Ítem con producto inactivo
        await dataSource.query(
            'INSERT INTO ITEM_CARRITO (id_carrito, id_producto, cantidad) VALUES (?, ?, 1)',
            [cartId, idProductoInactivo]
        );

        const res = await fetch(`${url}/api/carrito`, {
            headers: { Cookie: client1Cookie }
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.items.length, 3);

        const itemOk = data.items.find((i) => i.id_producto === idProductoStockSuficiente);
        const itemSinStock = data.items.find((i) => i.id_producto === idProductoStockBajo);
        const itemInactivo = data.items.find((i) => i.id_producto === idProductoInactivo);

        assert.ok(itemOk);
        assert.equal(itemOk.disponible, true);
        assert.equal(itemOk.motivo_no_disponible, undefined);

        assert.ok(itemSinStock);
        assert.equal(itemSinStock.disponible, false, 'disponible debe ser false si stock < cantidad');
        assert.equal(itemSinStock.motivo_no_disponible, 'SIN_STOCK');

        assert.ok(itemInactivo);
        assert.equal(itemInactivo.disponible, false);
        assert.equal(itemInactivo.motivo_no_disponible, 'INACTIVO');

        assert.equal(data.tiene_incompatibles, true);
    });

    test('Persistencia entre sesiones: recupera items tras nueva conexión', async () => {
        const res = await fetch(`${url}/api/carrito`, {
            headers: { Cookie: client1Cookie }
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.items.length, 3);
    });
});
