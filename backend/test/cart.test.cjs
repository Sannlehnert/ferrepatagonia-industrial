const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { app } = require('../dist/app');
const { dataSource } = require('../dist/config/database.config');
const { signToken } = require('../dist/services/token.service');

describe('Task #245 — Persistencia y Modelo del Carrito', () => {
    let server;
    let url;
    let client1Cookie;
    let client2Cookie;
    let adminCookie;

    before(async () => {
        // Inicializar DataSource si no estuviera abierto
        if (dataSource && !dataSource.isInitialized) {
            await dataSource.initialize();
        }

        // Levantar servidor Express en puerto dinámico efímero
        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        url = `http://127.0.0.1:${server.address().port}`;

        // Generar tokens JWT para fixture según esquema del proyecto
        const token1 = signToken({ id: 1, rol: 'CLIENTE', exp: Math.floor(Date.now() / 1000) + 7200 });
        client1Cookie = `jwt_token=${token1}`;

        const token2 = signToken({ id: 2, rol: 'CLIENTE', exp: Math.floor(Date.now() / 1000) + 7200 });
        client2Cookie = `jwt_token=${token2}`;

        const tokenAdmin = signToken({ id: 4, rol: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 7200 });
        adminCookie = `jwt_token=${tokenAdmin}`;
    });

    after(async () => {
        // Cerrar servidor HTTP
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }

        // Liberar conexiones de base de datos para no dejar el event loop bloqueado
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

    test('Cliente recupera su carrito inicial vacío de forma aislada', async () => {
        // Asegurar que el carrito del cliente 1 comience limpio para la aserción
        const [u1] = await dataSource.query('SELECT id_cliente FROM USUARIO WHERE id_usuario = 1');
        if (u1?.id_cliente) {
            const [c1] = await dataSource.query('SELECT id_carrito FROM CARRITO WHERE id_cliente = ?', [u1.id_cliente]);
            if (c1) {
                await dataSource.query('DELETE FROM ITEM_CARRITO WHERE id_carrito = ?', [c1.id_carrito]);
            }
        }

        const res1 = await fetch(`${url}/api/carrito`, {
            headers: { Cookie: client1Cookie }
        });

        assert.equal(res1.status, 200);
        const data1 = await res1.json();
        assert.equal(data1.total_items, 0);
        assert.deepEqual(data1.items, []);

        // El cliente 2 debe acceder a su propio carrito
        const res2 = await fetch(`${url}/api/carrito`, {
            headers: { Cookie: client2Cookie }
        });

        assert.equal(res2.status, 200);
        const data2 = await res2.json();
        assert.notEqual(data1.id_carrito, data2.id_carrito);
    });

    test('Persistencia entre sesiones y detección de producto inactivo', async () => {
        const [usuario1] = await dataSource.query('SELECT id_cliente FROM USUARIO WHERE id_usuario = 1');
        const idCliente = usuario1.id_cliente;

        let [cartRow] = await dataSource.query('SELECT id_carrito FROM CARRITO WHERE id_cliente = ?', [idCliente]);
        if (!cartRow) {
            await dataSource.query('INSERT INTO CARRITO (id_cliente) VALUES (?)', [idCliente]);
            [cartRow] = await dataSource.query('SELECT id_carrito FROM CARRITO WHERE id_cliente = ?', [idCliente]);
        }
        const cartId = cartRow.id_carrito;

        // Limpiar items previos
        await dataSource.query('DELETE FROM ITEM_CARRITO WHERE id_carrito = ?', [cartId]);

        // 1. Insertar item con producto 1
        await dataSource.query(
            'INSERT INTO ITEM_CARRITO (id_carrito, id_producto, cantidad) VALUES (?, 1, 2)',
            [cartId]
        );

        // 2. Desactivar producto 2 temporalmente y agregarlo al carrito
        await dataSource.query('UPDATE PRODUCTO SET activo = 0 WHERE id_producto = 2');
        await dataSource.query(
            'INSERT INTO ITEM_CARRITO (id_carrito, id_producto, cantidad) VALUES (?, 2, 1)',
            [cartId]
        );

        // 3. Simular consulta HTTP tras reconexión
        const res = await fetch(`${url}/api/carrito`, {
            headers: { Cookie: client1Cookie }
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.items.length, 2);

        const itemActivo = data.items.find((i) => i.id_producto === 1);
        const itemInactivo = data.items.find((i) => i.id_producto === 2);

        assert.ok(itemActivo);
        assert.ok(itemInactivo);
        assert.equal(itemActivo.disponible, true);
        assert.equal(itemInactivo.disponible, false);
        assert.equal(itemInactivo.motivo_no_disponible, 'INACTIVO');
        assert.equal(data.tiene_incompatibles, true);

        // Limpieza de datos temporales
        await dataSource.query('UPDATE PRODUCTO SET activo = 1 WHERE id_producto = 2');
        await dataSource.query('DELETE FROM ITEM_CARRITO WHERE id_carrito = ?', [cartId]);
    });
});