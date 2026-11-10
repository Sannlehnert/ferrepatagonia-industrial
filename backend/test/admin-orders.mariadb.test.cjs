require('./helpers/test-env.cjs');
const assert = require('node:assert/strict');
const { test, describe, before, after } = require('node:test');
const { once } = require('node:events');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const dbConfig = require('../dist/config/database.config');
const dataSource = dbConfig.dataSource;
const tokenService = require('../dist/services/token.service');
const authCookieMod = require('../dist/config/auth-cookie.config');
const { authenticate, authorizeRoles } = require('../dist/middlewares/auth.middleware');
const { adminOrderRouter } = require('../dist/routes/adminOrder.routes');

const AUTH_COOKIE_NAME =
    authCookieMod.AUTH_COOKIE_NAME ||
    authCookieMod.COOKIE_NAME ||
    authCookieMod.SESSION_COOKIE_NAME ||
    Object.values(authCookieMod).find(v => typeof v === 'string') ||
    'token';

function createTestAccessToken(payload) {
    const fullPayload = {
        sub: payload.id,
        id: payload.id,
        userId: payload.id,
        email: payload.email,
        rol: payload.rol,
        tipoCliente: payload.tipoCliente ?? null,
    };

    const candidateFn =
        tokenService.signAccessToken ||
        tokenService.generateAccessToken ||
        tokenService.signToken ||
        tokenService.createAccessToken ||
        tokenService.issueAccessToken ||
        Object.entries(tokenService).find(
            ([name, fn]) => typeof fn === 'function' && !/verify|decode|parse/i.test(name),
        )?.[1];

    if (typeof candidateFn === 'function') {
        try {
            const token = candidateFn(fullPayload);
            const decoded = jwt.decode(token);
            if (decoded && (decoded.id === payload.id || decoded.sub === payload.id) && decoded.rol === payload.rol) {
                return token;
            }
        } catch {
            // Fallback directo a jwt.sign
        }
    }

    return jwt.sign(fullPayload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

describe('Task #277 — Integración MariaDB: Permisos, Transición y Preservación Financiera', () => {
    let server;
    let baseUrl;
    let testOrderId;
    let testProductId;
    let testAccountId;
    let testMovementId;
    let adminCookie;
    let clientCookie;

    function assertDisposableDatabaseGuard() {
        const profile = process.env.CC260_TEST_PROFILE;
        const dbName = process.env.DB_NAME || '';
        const host = process.env.DB_HOST || '127.0.0.1';

        if (!profile || profile === 'undefined' || profile.trim() === '') {
            throw new Error('ABORT: Falta acreditación de perfil descartable en CC260_TEST_PROFILE.');
        }

        if (dbName === 'ferrepatagonia_dev' || dbName === 'ferrepatagonia' || dbName === 'mysql') {
            throw new Error(`ABORT: Base de datos "${dbName}" pertenece a un entorno protegido o de desarrollo.`);
        }

        if (!dbName.startsWith('test_') && !dbName.startsWith('cc260_') && !dbName.startsWith('admin_orders_')) {
            throw new Error(`ABORT: Base de datos "${dbName}" carece de prefijo descartable válido.`);
        }

        if (host !== '127.0.0.1' && host !== 'localhost') {
            throw new Error(`ABORT: Host "${host}" no corresponde a una interfaz loopback local.`);
        }
    }

    before(async () => {
        assertDisposableDatabaseGuard();

        if (!dataSource.isInitialized) {
            if (typeof dbConfig.initializeDatabase === 'function') {
                await dbConfig.initializeDatabase();
            } else {
                await dataSource.initialize();
            }
        }

        const app = express();
        app.use(cookieParser());
        app.use(express.json());
        app.use('/api/admin/pedidos', authenticate, authorizeRoles('ADMIN'), adminOrderRouter);

        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        baseUrl = `http://127.0.0.1:${server.address().port}/api/admin/pedidos`;

        // 1. Cliente EMPRESA aprobado (satisface chk_cliente_aprobacion_tipo)
        const resCli = await dataSource.query(`
            INSERT INTO CLIENTE (
                tipo_cliente, nombre_razon_social, cuit, doc_cliente, email,
                telefono, direccion, estado_aprobacion_empresa, es_fiel, activo
            ) VALUES (
                'EMPRESA', 'Metalúrgica Test SA', '30-99887766-5', NULL, 'adminorders@test.com',
                '2994000001', 'Parque Industrial Lote 1', 'APROBADA', 0, 1
            )
        `);
        const clientId = Number(resCli.insertId);

        // 2. Usuarios ADMIN y CLIENTE vinculados y activos en BD
        const resAdminUser = await dataSource.query(`
            INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo)
            VALUES (NULL, 'admin@ferrepatagonia.test', 'hash_dummy', 'ADMIN', 1)
        `);
        const adminUserId = Number(resAdminUser.insertId);

        const resClientUser = await dataSource.query(`
            INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo)
            VALUES (?, 'cliente@ferrepatagonia.test', 'hash_dummy', 'CLIENTE', 1)
        `, [clientId]);
        const clientUserId = Number(resClientUser.insertId);

        adminCookie = `${AUTH_COOKIE_NAME}=${createTestAccessToken({
            id: adminUserId,
            email: 'admin@ferrepatagonia.test',
            rol: 'ADMIN',
            tipoCliente: null,
        })}`;
        clientCookie = `${AUTH_COOKIE_NAME}=${createTestAccessToken({
            id: clientUserId,
            email: 'cliente@ferrepatagonia.test',
            rol: 'CLIENTE',
            tipoCliente: 'EMPRESA',
        })}`;

        // 3. Categoría (columna: 'activo') y Producto (precio y stock válidos)
        const catCheck = await dataSource.query('SELECT id_categoria FROM CATEGORIA LIMIT 1');
        let categoryId = catCheck[0]?.id_categoria;
        if (!categoryId) {
            const resCat = await dataSource.query(`
                INSERT INTO CATEGORIA (nombre, descripcion, activo)
                VALUES ('General', 'Herramientas y maquinaria', 1)
            `);
            categoryId = Number(resCat.insertId);
        }

        const resProd = await dataSource.query(`
            INSERT INTO PRODUCTO (id_categoria, codigo, nombre, descripcion, precio, stock, activo)
            VALUES (?, 'SKU-P277', 'Rotomartillo Industrial', 'Herramienta de impacto', 350.00, 25, 1)
        `, [categoryId]);
        testProductId = Number(resProd.insertId);

        // 4. Cuenta Corriente
        const resCc = await dataSource.query(`
            INSERT INTO CUENTA_CORRIENTE (
                id_cliente, limite_credito, habilitada, cobertura, plazo_dias
            ) VALUES (?, 5000.00, 1, 'COMPLETA', 30)
        `, [clientId]);
        testAccountId = Number(resCc.insertId);

        // 5. Pedido confirmado con 2 unidades (total: 700.00 USD)
        const resPed = await dataSource.query(`
            INSERT INTO PEDIDO (
                id_cliente, estado, modalidad_pago, subtotal, descuento, total, moneda_total, evidencia_total_usd
            ) VALUES (?, 'CONFIRMADO', 'CUENTA_CORRIENTE', 700.00, 0.00, 700.00, 'USD', 'FER17:TEST')
        `, [clientId]);
        testOrderId = Number(resPed.insertId);

        await dataSource.query(`
            INSERT INTO DETALLE_PEDIDO (id_pedido, id_producto, cantidad, precio_unitario, descuento, subtotal)
            VALUES (?, ?, 2, 350.00, 0.00, 700.00)
        `, [testOrderId, testProductId]);

        // 6. Movimiento de Cuenta Corriente (cargo del pedido confirmado)
        const resMcc = await dataSource.query(`
            INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE (
                id_cuenta_corriente, id_pedido, tipo_movimiento, origen, estado,
                moneda, monto, observaciones
            ) VALUES (
                ?, ?, 'CARGO', 'PEDIDO_CONFIRMADO', 'ACREDITADO',
                'USD', 700.00, 'Cargo pedido #277'
            )
        `, [testAccountId, testOrderId]);
        testMovementId = Number(resMcc.insertId);

        // 7. Registro de confirmación de pedido CC (vinculación formal id_pedido <-> id_cargo)
        await dataSource.query(`
            INSERT INTO CONFIRMACION_PEDIDO_CC (
                id_cliente, clave, estado, id_pedido, id_cargo, http_status, respuesta_json
            ) VALUES (
                ?, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'CONFIRMADO', ?, ?, 201, '{"status":"ok"}'
            )
        `, [clientId, testOrderId, testMovementId]);
    });

    after(async () => {
        if (server) {
            if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
            await new Promise(r => server.close(r));
        }
        if (typeof dbConfig.destroyDatabase === 'function') {
            await dbConfig.destroyDatabase();
        } else if (dataSource?.isInitialized) {
            await dataSource.destroy();
        }
    });

    test('Permisos HTTP: 401 anónimo, 403 CLIENTE y 200 ADMIN', async () => {
        const anon = await fetch(`${baseUrl}/${testOrderId}`);
        assert.equal(anon.status, 401);

        const client = await fetch(`${baseUrl}/${testOrderId}`, {
            headers: { Cookie: clientCookie },
        });
        assert.equal(client.status, 403);

        const admin = await fetch(`${baseUrl}/${testOrderId}`, {
            headers: { Cookie: adminCookie },
        });
        assert.equal(admin.status, 200);
        const json = await admin.json();
        assert.equal(json.data.idPedido, testOrderId);
        assert.equal(json.data.estado, 'CONFIRMADO');
        assert.equal(json.data.cargoCuentaCorrienteId, testMovementId);
        assert.equal(json.data.claveConfirmacion, undefined, 'P3: claveConfirmacion no debe existir en DTO admin');
    });

    test('Transición autorizada CONFIRMADO -> EN_PREPARACION y preservación financiera estricta', async () => {
        const [orderBefore] = await dataSource.query(
            'SELECT subtotal, descuento, total, moneda_total, modalidad_pago, id_cliente FROM PEDIDO WHERE id_pedido = ?',
            [testOrderId],
        );
        const [stockBefore] = await dataSource.query(
            'SELECT stock FROM PRODUCTO WHERE id_producto = ?',
            [testProductId],
        );
        const [accountBefore] = await dataSource.query(
            'SELECT limite_credito, habilitada, cobertura, plazo_dias FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?',
            [testAccountId],
        );
        const [movementBefore] = await dataSource.query(
            'SELECT monto, estado, tipo_movimiento FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_movimiento_cuenta = ?',
            [testMovementId],
        );

        const patchRes = await fetch(`${baseUrl}/${testOrderId}/estado`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Cookie: adminCookie,
            },
            body: JSON.stringify({ estado: 'EN_PREPARACION' }),
        });

        assert.equal(patchRes.status, 200);
        const patchJson = await patchRes.json();
        assert.equal(patchJson.data.estado, 'EN_PREPARACION');

        const [orderAfter] = await dataSource.query(
            'SELECT estado, subtotal, descuento, total, moneda_total, modalidad_pago, id_cliente FROM PEDIDO WHERE id_pedido = ?',
            [testOrderId],
        );
        const [stockAfter] = await dataSource.query(
            'SELECT stock FROM PRODUCTO WHERE id_producto = ?',
            [testProductId],
        );
        const [accountAfter] = await dataSource.query(
            'SELECT limite_credito, habilitada, cobertura, plazo_dias FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?',
            [testAccountId],
        );
        const [movementAfter] = await dataSource.query(
            'SELECT monto, estado, tipo_movimiento FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_movimiento_cuenta = ?',
            [testMovementId],
        );
        const [movementsCount] = await dataSource.query(
            'SELECT COUNT(*) AS total FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?',
            [testAccountId],
        );

        // Estado del pedido actualizado
        assert.equal(orderAfter.estado, 'EN_PREPARACION');

        // Preservación estricta de importes y moneda
        assert.equal(Number(orderAfter.subtotal), Number(orderBefore.subtotal));
        assert.equal(Number(orderAfter.descuento), Number(orderBefore.descuento));
        assert.equal(Number(orderAfter.total), Number(orderBefore.total));
        assert.equal(orderAfter.moneda_total, orderBefore.moneda_total);
        assert.equal(orderAfter.modalidad_pago, orderBefore.modalidad_pago);
        assert.equal(orderAfter.id_cliente, orderBefore.id_cliente);

        // Inmutabilidad de stock, cuenta corriente y cargos asociados
        assert.equal(Number(stockAfter.stock), Number(stockBefore.stock));
        assert.equal(Number(accountAfter.limite_credito), Number(accountBefore.limite_credito));
        assert.equal(Number(accountAfter.habilitada), Number(accountBefore.habilitada));
        assert.equal(accountAfter.cobertura, accountBefore.cobertura);
        assert.equal(Number(accountAfter.plazo_dias), Number(accountBefore.plazo_dias));
        assert.equal(Number(movementAfter.monto), Number(movementBefore.monto));
        assert.equal(movementAfter.estado, movementBefore.estado);
        assert.equal(movementAfter.tipo_movimiento, movementBefore.tipo_movimiento);
        assert.equal(Number(movementsCount.total), 1);
    });

    test('Rechazo de transiciones prohibidas (409 Conflict)', async () => {
        const invalidRes = await fetch(`${baseUrl}/${testOrderId}/estado`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Cookie: adminCookie,
            },
            body: JSON.stringify({ estado: 'CONFIRMADO' }),
        });

        assert.equal(invalidRes.status, 409);
    });
});