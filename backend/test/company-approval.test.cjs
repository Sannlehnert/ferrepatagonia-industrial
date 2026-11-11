require('./helpers/integration-lifecycle.cjs');

const assert = require('node:assert/strict');
const { describe, test, before, after } = require('node:test');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { app } = require('../dist/app');
const db = require('../dist/config/database.config');
const dataSource = db.dataSource;
const { pool } = require('../dist/config/catalog-snapshot.config');
const { env } = require('../dist/config/env.config');
const { authCookieName } = require('../dist/config/auth-cookie.config');
const { signToken } = require('../dist/services/token.service');
const { ClienteSchema, UsuarioSchema, CuentaCorrienteSchema } = require('../dist/entities/active.schemas');

after(() => pool.end());

describe('Task #278 — Aprobación y rechazo de cuentas empresariales', () => {
    let server;
    let baseUrl;
    const createdUserIds = [];
    const createdClienteIds = [];
    const createdCategoryIds = [];
    const createdProductIds = [];
    const createdCartIds = [];
    const APP_ORIGIN = env.httpSecurity?.publicOrigin || env.appPublicOrigin || 'http://localhost:5173';

    async function request(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'Origin': APP_ORIGIN,
            'Connection': 'close',
            ...(options.headers || {}),
        };

        if (options.token) {
            headers['Cookie'] = `${authCookieName}=${options.token}`;
        }

        return fetch(`${baseUrl}${endpoint}`, {
            ...options,
            headers,
        });
    }

    async function createTestAdmin() {
        const timestamp = Date.now() + Math.floor(Math.random() * 100000);
        const email = `admin-${timestamp}@ferrepatagonia.com`;
        const userRepo = dataSource.getRepository(UsuarioSchema);
        const user = await userRepo.save({
            email,
            password_hash: '$2b$10$abcdefghijklmnopqrstuu',
            rol: 'ADMIN',
            activo: 1,
            id_cliente: null,
        });
        const id = Number(user.id_usuario);
        createdUserIds.push(id);
        return { user, token: signToken({ id, rol: 'ADMIN' }) };
    }

    async function createTestClient(tipoCliente, estadoInicial = null) {
        const timestamp = Date.now() + Math.floor(Math.random() * 100000);
        const clienteRepo = dataSource.getRepository(ClienteSchema);
        const userRepo = dataSource.getRepository(UsuarioSchema);

        const cliente = await clienteRepo.save({
            tipo_cliente: tipoCliente,
            nombre_razon_social: `Cliente Test ${timestamp}`,
            doc_cliente: tipoCliente === 'PARTICULAR' ? '12345678' : null,
            cuit: tipoCliente === 'EMPRESA' ? '30-12345678-9' : null,
            email: `client-${timestamp}@test.com`,
            estado_aprobacion_empresa: tipoCliente === 'EMPRESA' ? (estadoInicial || 'PENDIENTE') : null,
            es_fiel: 0,
            activo: 1,
        });
        createdClienteIds.push(cliente.id_cliente);

        const user = await userRepo.save({
            email: `client-${timestamp}@test.com`,
            password_hash: '$2b$10$abcdefghijklmnopqrstuu',
            rol: 'CLIENTE',
            activo: 1,
            id_cliente: cliente.id_cliente,
        });
        const id = Number(user.id_usuario);
        createdUserIds.push(id);

        return { cliente, user, token: signToken({ id, rol: 'CLIENTE' }) };
    }

    async function createCheckoutFixture(options = {}) {
        const {
            estadoEmpresa = 'APROBADA',
            precio = '25.00',
            stock = 10,
            cantidad = 2,
            limiteCredito = '1000.00',
            habilitada = 1,
        } = options;

        const timestamp = Date.now() + Math.floor(Math.random() * 100000);
        const admin = await createTestAdmin();

        const clientInsert = await dataSource.query(`
            INSERT INTO CLIENTE (
                tipo_cliente, nombre_razon_social, cuit, email,
                estado_aprobacion_empresa, es_fiel, activo
            ) VALUES ('EMPRESA', ?, ?, ?, ?, 0, 1)
        `, [
            `Empresa Checkout ${timestamp}`,
            `30-${String(timestamp).slice(-8)}-9`,
            `empresa-checkout-${timestamp}@test.com`,
            estadoEmpresa,
        ]);
        const clientId = Number(clientInsert.insertId);
        createdClienteIds.push(clientId);

        const userInsert = await dataSource.query(`
            INSERT INTO USUARIO (
                id_cliente, email, password_hash, rol, activo
            ) VALUES (?, ?, '$2b$10$abcdefghijklmnopqrstuu', 'CLIENTE', 1)
        `, [clientId, `empresa-checkout-${timestamp}@test.com`]);
        const userId = Number(userInsert.insertId);
        createdUserIds.push(userId);
        const token = signToken({ id: userId, rol: 'CLIENTE' });

        const ccInsert = await dataSource.query(`
            INSERT INTO CUENTA_CORRIENTE (
                id_cliente, limite_credito, habilitada, cobertura,
                plazo_dias, moneda_limite, evidencia_limite, evidencia_plazo,
                evidencia_cobertura, cobertura_desde_utc, origen_datos
            ) VALUES (
                ?, ?, ?, 'COMPLETA', 30, 'USD',
                'FIXTURE TEST', 'FIXTURE TEST', 'FIXTURE TEST',
                UTC_TIMESTAMP(3) - INTERVAL 1 DAY, 'DEMO'
            )
        `, [clientId, limiteCredito, habilitada]);
        const accountId = Number(ccInsert.insertId);

        const catInsert = await dataSource.query(`
            INSERT INTO CATEGORIA (nombre, activo)
            VALUES (?, 1)
        `, [`Cat Checkout ${timestamp}`]);
        const categoryId = Number(catInsert.insertId);
        createdCategoryIds.push(categoryId);

        const codigo = `PROD-${timestamp}`;
        const prodInsert = await dataSource.query(`
            INSERT INTO PRODUCTO (
                id_categoria, codigo, nombre, precio, stock, activo
            ) VALUES (?, ?, ?, ?, ?, 1)
        `, [categoryId, codigo, `Producto ${timestamp}`, precio, stock]);
        const productId = Number(prodInsert.insertId);
        createdProductIds.push(productId);

        await dataSource.query(`
            INSERT INTO PRECIO_USD_EVIDENCIA (
                id_producto, precio_verificado, evidencia, id_admin,
                verificado_utc, valida, sintetica
            ) VALUES (?, ?, 'Evidencia Test', ?, UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE, 1, 0)
        `, [productId, precio, admin.user.id_usuario]);

        const cartInsert = await dataSource.query(`
            INSERT INTO CARRITO (id_cliente) VALUES (?)
        `, [clientId]);
        const cartId = Number(cartInsert.insertId);
        createdCartIds.push(cartId);

        await dataSource.query(`
            INSERT INTO ITEM_CARRITO (id_carrito, id_producto, cantidad)
            VALUES (?, ?, ?)
        `, [cartId, productId, cantidad]);

        return {
            admin,
            clientId,
            userId,
            token,
            accountId,
            categoryId,
            productId,
            cartId,
        };
    }

    before(async () => {
        assert.equal(process.env.NODE_ENV, 'test');
        if (!dataSource.isInitialized) {
            await dataSource.initialize();
        }
        const [identity] = await dataSource.query('SELECT DATABASE() AS name');
        assert.match(identity.name, /^admin_products_test_[a-f0-9]{32}$/);

        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api`;
    });

    after(async () => {
        try {
            if (dataSource.isInitialized) {
                await dataSource.query('SET FOREIGN_KEY_CHECKS = 0').catch(() => {});
                if (createdClienteIds.length > 0) {
                    const cIds = createdClienteIds.map(Number).join(',');
                    await dataSource.query(`DELETE FROM DETALLE_PEDIDO_CC_PRECIO WHERE id_detalle_pedido IN (SELECT id_detalle_pedido FROM DETALLE_PEDIDO WHERE id_pedido IN (SELECT id_pedido FROM PEDIDO WHERE id_cliente IN (${cIds})))`).catch(() => {});
                    await dataSource.query(`DELETE FROM DETALLE_PEDIDO WHERE id_pedido IN (SELECT id_pedido FROM PEDIDO WHERE id_cliente IN (${cIds}))`).catch(() => {});
                    await dataSource.query(`DELETE FROM CONFIRMACION_PEDIDO_CC WHERE id_cliente IN (${cIds})`).catch(() => {});
                    await dataSource.query(`DELETE FROM PAGO WHERE id_pedido IN (SELECT id_pedido FROM PEDIDO WHERE id_cliente IN (${cIds}))`).catch(() => {});
                    await dataSource.query(`DELETE FROM PEDIDO WHERE id_cliente IN (${cIds})`).catch(() => {});
                    await dataSource.query(`DELETE FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente IN (SELECT id_cuenta_corriente FROM CUENTA_CORRIENTE WHERE id_cliente IN (${cIds}))`).catch(() => {});
                    await dataSource.query(`DELETE FROM ITEM_CARRITO WHERE id_carrito IN (SELECT id_carrito FROM CARRITO WHERE id_cliente IN (${cIds}))`).catch(() => {});
                    await dataSource.query(`DELETE FROM CARRITO WHERE id_cliente IN (${cIds})`).catch(() => {});
                    await dataSource.query(`DELETE FROM USUARIO WHERE id_cliente IN (${cIds})`).catch(() => {});
                    await dataSource.query(`DELETE FROM CUENTA_CORRIENTE WHERE id_cliente IN (${cIds})`).catch(() => {});
                    await dataSource.query(`DELETE FROM CLIENTE WHERE id_cliente IN (${cIds})`).catch(() => {});
                }
                if (createdProductIds.length > 0) {
                    const pIds = createdProductIds.map(Number).join(',');
                    await dataSource.query(`DELETE FROM PRECIO_USD_EVIDENCIA WHERE id_producto IN (${pIds})`).catch(() => {});
                    await dataSource.query(`DELETE FROM PRODUCTO WHERE id_producto IN (${pIds})`).catch(() => {});
                }
                if (createdCategoryIds.length > 0) {
                    const catIds = createdCategoryIds.map(Number).join(',');
                    await dataSource.query(`DELETE FROM CATEGORIA WHERE id_categoria IN (${catIds})`).catch(() => {});
                }
                if (createdUserIds.length > 0) {
                    const uIds = createdUserIds.map(Number).join(',');
                    await dataSource.query(`DELETE FROM USUARIO WHERE id_usuario IN (${uIds})`).catch(() => {});
                }
                await dataSource.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
            }
        } finally {
            if (server) {
                if (typeof server.closeAllConnections === 'function') {
                    server.closeAllConnections();
                }
                await new Promise((resolve) => server.close(resolve));
            }
        }
    });

    test('401 cuando no hay sesión autenticada', async () => {
        const res = await request('/admin/clientes/1/estado-empresa', {
            method: 'PATCH',
            body: JSON.stringify({ estado: 'APROBADA' }),
        });
        assert.equal(res.status, 401);
    });

    test('403 cuando el usuario autenticado tiene rol CLIENTE', async () => {
        const { token } = await createTestClient('PARTICULAR');
        const res = await request('/admin/clientes/1/estado-empresa', {
            method: 'PATCH',
            token,
            body: JSON.stringify({ estado: 'APROBADA' }),
        });
        assert.equal(res.status, 403);
    });

    test('404 cuando el ID de cliente no existe', async () => {
        const { token } = await createTestAdmin();
        const res = await request('/admin/clientes/9999999/estado-empresa', {
            method: 'PATCH',
            token,
            body: JSON.stringify({ estado: 'APROBADA' }),
        });
        assert.equal(res.status, 404);
    });

    test('400 cuando el cliente es de tipo PARTICULAR (no admite aprobación de empresa)', async () => {
        const { token } = await createTestAdmin();
        const { cliente } = await createTestClient('PARTICULAR');

        const res = await request(`/admin/clientes/${cliente.id_cliente}/estado-empresa`, {
            method: 'PATCH',
            token,
            body: JSON.stringify({ estado: 'APROBADA' }),
        });
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.match(data.message, /empresa/i);
    });

    test('400 ante un estado inválido', async () => {
        const { token } = await createTestAdmin();
        const { cliente } = await createTestClient('EMPRESA', 'PENDIENTE');

        const res = await request(`/admin/clientes/${cliente.id_cliente}/estado-empresa`, {
            method: 'PATCH',
            token,
            body: JSON.stringify({ estado: 'ESTADO_INEXISTENTE' }),
        });
        assert.equal(res.status, 400);
    });

    test('200 aprueba exitosamente una empresa y no altera es_fiel ni cuenta corriente', async () => {
        const { token } = await createTestAdmin();
        const { cliente } = await createTestClient('EMPRESA', 'PENDIENTE');

        const res = await request(`/admin/clientes/${cliente.id_cliente}/estado-empresa`, {
            method: 'PATCH',
            token,
            body: JSON.stringify({ estado: 'APROBADA' }),
        });
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.data.cliente.estadoAprobacionEmpresa, 'APROBADA');
        assert.equal(json.data.cliente.email, cliente.email);
        assert.equal(typeof json.data.cliente.fechaRegistro, 'string');
        assert.ok(!Number.isNaN(Date.parse(json.data.cliente.fechaRegistro)));

        const clienteRepo = dataSource.getRepository(ClienteSchema);
        const saved = await clienteRepo.findOne({ where: { id_cliente: cliente.id_cliente } });
        assert.equal(saved.estado_aprobacion_empresa, 'APROBADA');
        assert.equal(saved.es_fiel, 0);

        const ccRepo = dataSource.getRepository(CuentaCorrienteSchema);
        const cc = await ccRepo.findOne({ where: { id_cliente: cliente.id_cliente } });
        assert.equal(cc, null);
    });

    test('200 rechaza exitosamente una empresa', async () => {
        const { token } = await createTestAdmin();
        const { cliente } = await createTestClient('EMPRESA', 'PENDIENTE');

        const res = await request(`/admin/clientes/${cliente.id_cliente}/estado-empresa`, {
            method: 'PATCH',
            token,
            body: JSON.stringify({ estado: 'RECHAZADA' }),
        });
        assert.equal(res.status, 200);

        const clienteRepo = dataSource.getRepository(ClienteSchema);
        const saved = await clienteRepo.findOne({ where: { id_cliente: cliente.id_cliente } });
        assert.equal(saved.estado_aprobacion_empresa, 'RECHAZADA');
    });

    test('TOCTOU y concurrencia: mutaciones simultáneas serializan con FOR UPDATE, son idempotentes y mantienen aislamiento financiero', async () => {
        const [adminA, adminB] = await Promise.all([createTestAdmin(), createTestAdmin()]);
        const { cliente } = await createTestClient('EMPRESA', 'PENDIENTE');

        const [resA, resB] = await Promise.all([
            request(`/admin/clientes/${cliente.id_cliente}/estado-empresa`, {
                method: 'PATCH',
                token: adminA.token,
                body: JSON.stringify({ estado: 'APROBADA' }),
            }),
            request(`/admin/clientes/${cliente.id_cliente}/estado-empresa`, {
                method: 'PATCH',
                token: adminB.token,
                body: JSON.stringify({ estado: 'RECHAZADA' }),
            }),
        ]);

        assert.equal(resA.status, 200);
        assert.equal(resB.status, 200);

        const [jsonA, jsonB] = await Promise.all([resA.json(), resB.json()]);
        assert.equal(jsonA.data.cliente.estadoAprobacionEmpresa, 'APROBADA');
        assert.equal(jsonB.data.cliente.estadoAprobacionEmpresa, 'RECHAZADA');

        const clienteRepo = dataSource.getRepository(ClienteSchema);
        const afterRace = await clienteRepo.findOne({ where: { id_cliente: cliente.id_cliente } });
        assert.ok(
            afterRace.estado_aprobacion_empresa === 'APROBADA' ||
            afterRace.estado_aprobacion_empresa === 'RECHAZADA',
        );
        assert.equal(afterRace.es_fiel, 0);

        // Ráfaga idempotente concurrente al mismo estado
        const [idem1, idem2] = await Promise.all([
            request(`/admin/clientes/${cliente.id_cliente}/estado-empresa`, {
                method: 'PATCH',
                token: adminA.token,
                body: JSON.stringify({ estado: 'APROBADA' }),
            }),
            request(`/admin/clientes/${cliente.id_cliente}/estado-empresa`, {
                method: 'PATCH',
                token: adminB.token,
                body: JSON.stringify({ estado: 'APROBADA' }),
            }),
        ]);
        assert.equal(idem1.status, 200);
        assert.equal(idem2.status, 200);

        const afterIdem = await clienteRepo.findOne({ where: { id_cliente: cliente.id_cliente } });
        assert.equal(afterIdem.estado_aprobacion_empresa, 'APROBADA');
        assert.equal(afterIdem.es_fiel, 0);

        const ccRepo = dataSource.getRepository(CuentaCorrienteSchema);
        const cc = await ccRepo.findOne({ where: { id_cliente: cliente.id_cliente } });
        assert.equal(cc, null);
    });

    test('H-02.1 Empresa no aprobada (PENDIENTE o RECHAZADA) es rechazada deterministamente al intentar confirmar pedido a crédito (HTTP 403)', async () => {
        // Caso 1: PENDIENTE
        const fPendiente = await createCheckoutFixture({ estadoEmpresa: 'PENDIENTE' });
        const eligPendiente = await request('/pedidos/cuenta-corriente/eligibilidad', { token: fPendiente.token });
        assert.equal(eligPendiente.status, 200);
        const jsonPendiente = await eligPendiente.json();
        assert.equal(jsonPendiente.data.elegible, false);
        assert.equal(jsonPendiente.data.codigo, 'EMPRESA_NO_HABILITADA');
        assert.equal(jsonPendiente.data.cotizacion, null);

        const postPendiente = await request('/pedidos/cuenta-corriente', {
            method: 'POST',
            token: fPendiente.token,
            headers: { 'Idempotency-Key': randomUUID() },
            body: JSON.stringify({ cotizacion: 'a'.repeat(40) }),
        });
        assert.equal(postPendiente.status, 403);
        const postPendienteJson = await postPendiente.json();
        assert.equal(postPendienteJson.code, 'EMPRESA_NO_HABILITADA');

        // Caso 2: RECHAZADA
        const fRechazada = await createCheckoutFixture({ estadoEmpresa: 'RECHAZADA' });
        const eligRechazada = await request('/pedidos/cuenta-corriente/eligibilidad', { token: fRechazada.token });
        assert.equal(eligRechazada.status, 200);
        const jsonRechazada = await eligRechazada.json();
        assert.equal(jsonRechazada.data.elegible, false);
        assert.equal(jsonRechazada.data.codigo, 'EMPRESA_NO_HABILITADA');
        assert.equal(jsonRechazada.data.cotizacion, null);

        const postRechazada = await request('/pedidos/cuenta-corriente', {
            method: 'POST',
            token: fRechazada.token,
            headers: { 'Idempotency-Key': randomUUID() },
            body: JSON.stringify({ cotizacion: 'a'.repeat(40) }),
        });
        assert.equal(postRechazada.status, 403);
        const postRechazadaJson = await postRechazada.json();
        assert.equal(postRechazadaJson.code, 'EMPRESA_NO_HABILITADA');
    });

    test('H-02.2 Empresa aprobada (APROBADA) confirma pedido a crédito exitosamente (HTTP 201)', async () => {
        const f = await createCheckoutFixture({ estadoEmpresa: 'APROBADA', precio: '25.00', cantidad: 2 });
        const eligRes = await request('/pedidos/cuenta-corriente/eligibilidad', { token: f.token });
        assert.equal(eligRes.status, 200);
        const eligJson = await eligRes.json();
        assert.equal(eligJson.data.elegible, true);
        assert.equal(typeof eligJson.data.cotizacion, 'string');
        const cotizacion = eligJson.data.cotizacion;

        const confirmKey = randomUUID();
        const confirmRes = await request('/pedidos/cuenta-corriente', {
            method: 'POST',
            token: f.token,
            headers: { 'Idempotency-Key': confirmKey },
            body: JSON.stringify({ cotizacion }),
        });
        assert.equal(confirmRes.status, 201);
        const confirmJson = await confirmRes.json();
        assert.ok(confirmJson.data.pedidoId > 0);
        assert.equal(confirmJson.data.estado, 'CONFIRMADO');

        // Constatar registros en MariaDB
        const [orders] = await dataSource.query('SELECT COUNT(*) AS c FROM PEDIDO WHERE id_cliente = ?', [f.clientId]);
        assert.equal(Number(orders.c), 1);

        const [movements] = await dataSource.query('SELECT COUNT(*) AS c FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?', [f.accountId]);
        assert.equal(Number(movements.c), 1);

        const [attempts] = await dataSource.query('SELECT estado, id_pedido, id_cargo FROM CONFIRMACION_PEDIDO_CC WHERE id_cliente = ? AND clave = ?', [f.clientId, confirmKey]);
        assert.equal(attempts.estado, 'CONFIRMADO');
        assert.equal(Number(attempts.id_pedido), confirmJson.data.pedidoId);
        assert.ok(Number(attempts.id_cargo) > 0);
    });

    test('H-02.3 Carrera concurrente y serialización TOCTOU: Rechazo administrativo (FOR UPDATE) vs Checkout a crédito (LOCK IN SHARE MODE)', async () => {
        // Escenario A: Ráfaga concurrente directa con Promise.all
        const f1 = await createCheckoutFixture({ estadoEmpresa: 'APROBADA', precio: '15.00', cantidad: 1 });
        const elig1 = await request('/pedidos/cuenta-corriente/eligibilidad', { token: f1.token });
        const cotizacion1 = (await elig1.json()).data.cotizacion;

        const [orderRes1, rejectRes1] = await Promise.all([
            request('/pedidos/cuenta-corriente', {
                method: 'POST',
                token: f1.token,
                headers: { 'Idempotency-Key': randomUUID() },
                body: JSON.stringify({ cotizacion: cotizacion1 }),
            }),
            request(`/admin/clientes/${f1.clientId}/estado-empresa`, {
                method: 'PATCH',
                token: f1.admin.token,
                body: JSON.stringify({ estado: 'RECHAZADA' }),
            }),
        ]);

        assert.equal(rejectRes1.status, 200);
        assert.ok([201, 403].includes(orderRes1.status));
        const [afterRace1] = await dataSource.query('SELECT estado_aprobacion_empresa FROM CLIENTE WHERE id_cliente = ?', [f1.clientId]);
        assert.equal(afterRace1.estado_aprobacion_empresa, 'RECHAZADA');

        // Escenario B: Serialización forzada de bloqueos a nivel MariaDB
        // Una transacción administrativa sostiene FOR UPDATE sobre CLIENTE y muta a RECHAZADA.
        // El checkout concurrente (LOCK IN SHARE MODE) debe esperar en InnoDB y, al despertar tras el COMMIT,
        // leer el estado RECHAZADA y ser rechazado con HTTP 403 sin confirmar pedido.
        const f2 = await createCheckoutFixture({ estadoEmpresa: 'APROBADA', precio: '30.00', cantidad: 1 });
        const elig2 = await request('/pedidos/cuenta-corriente/eligibilidad', { token: f2.token });
        const cotizacion2 = (await elig2.json()).data.cotizacion;

        const conn = await pool.getConnection();
        try {
            await conn.query('START TRANSACTION');
            // Adquirir bloqueo exclusivo FOR UPDATE sobre el CLIENTE
            await conn.query('SELECT * FROM CLIENTE WHERE id_cliente = ? FOR UPDATE', [f2.clientId]);
            await conn.query("UPDATE CLIENTE SET estado_aprobacion_empresa = 'RECHAZADA' WHERE id_cliente = ?", [f2.clientId]);

            let checkoutFinished = false;
            const checkoutPromise = request('/pedidos/cuenta-corriente', {
                method: 'POST',
                token: f2.token,
                headers: { 'Idempotency-Key': randomUUID() },
                body: JSON.stringify({ cotizacion: cotizacion2 }),
            }).then(r => {
                checkoutFinished = true;
                return r;
            });

            // Dar un tiempo prudente para que el checkout llegue a lockAccountOrderContext y quede esperando el lock
            await new Promise(r => setTimeout(r, 200));
            assert.equal(checkoutFinished, false, 'El checkout debe esperar a que se libere el bloqueo FOR UPDATE en MariaDB');

            // El admin confirma su transacción, liberando el lock FOR UPDATE
            await conn.query('COMMIT');

            const orderRes2 = await checkoutPromise;
            assert.equal(orderRes2.status, 403);
            const orderJson2 = await orderRes2.json();
            assert.equal(orderJson2.code, 'EMPRESA_NO_HABILITADA');

            // Constatar que NO se confirmó ningún pedido
            const [orders2] = await dataSource.query('SELECT COUNT(*) AS c FROM PEDIDO WHERE id_cliente = ?', [f2.clientId]);
            assert.equal(Number(orders2.c), 0);
        } finally {
            conn.release();
        }
    });

    test('H-02.4 Aislamiento e inmutabilidad financiera: ningún pedido rechazado por estado empresarial genera movimientos ni altera cuenta corriente', async () => {
        const f = await createCheckoutFixture({ estadoEmpresa: 'PENDIENTE', precio: '50.00', cantidad: 2, limiteCredito: '500.00' });

        // Estado inicial de la cuenta corriente
        const [ccBefore] = await dataSource.query('SELECT limite_credito, habilitada, cobertura, plazo_dias, moneda_limite FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?', [f.accountId]);

        // Consulta de elegibilidad rechazada: constatar 0 registros en CONFIRMACION_PEDIDO_CC
        const eligRes = await request('/pedidos/cuenta-corriente/eligibilidad', { token: f.token });
        assert.equal(eligRes.status, 200);
        const [attemptsAfterElig] = await dataSource.query('SELECT COUNT(*) AS c FROM CONFIRMACION_PEDIDO_CC WHERE id_cliente = ?', [f.clientId]);
        assert.equal(Number(attemptsAfterElig.c), 0);

        // Intento de confirmación con estado no aprobado
        const orderRes = await request('/pedidos/cuenta-corriente', {
            method: 'POST',
            token: f.token,
            headers: { 'Idempotency-Key': randomUUID() },
            body: JSON.stringify({ cotizacion: 'a'.repeat(40) }),
        });
        assert.equal(orderRes.status, 403);

        // 1. Constatar 0 inserciones en MOVIMIENTO_CUENTA_CORRIENTE
        const [movements] = await dataSource.query('SELECT COUNT(*) AS c FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?', [f.accountId]);
        assert.equal(Number(movements.c), 0);

        // 2. Constatar 0 pedidos en PEDIDO
        const [orders] = await dataSource.query('SELECT COUNT(*) AS c FROM PEDIDO WHERE id_cliente = ?', [f.clientId]);
        assert.equal(Number(orders.c), 0);

        // 3. Constatar 0 registros confirmados en CONFIRMACION_PEDIDO_CC (ni id_pedido ni id_cargo asociados)
        const [confirmedAttempts] = await dataSource.query(
            "SELECT COUNT(*) AS c FROM CONFIRMACION_PEDIDO_CC WHERE id_cliente = ? AND (estado = 'CONFIRMADO' OR id_pedido IS NOT NULL OR id_cargo IS NOT NULL)",
            [f.clientId],
        );
        assert.equal(Number(confirmedAttempts.c), 0);

        // 4. Constatar inmutabilidad estricta en CUENTA_CORRIENTE
        const [ccAfter] = await dataSource.query('SELECT limite_credito, habilitada, cobertura, plazo_dias, moneda_limite FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?', [f.accountId]);
        assert.deepEqual(ccAfter, ccBefore);

        // 5. Constatar que el carrito no fue alterado ni vaciado
        const cartRows = await dataSource.query('SELECT cantidad FROM ITEM_CARRITO WHERE id_carrito = ?', [f.cartId]);
        assert.equal(cartRows.length, 1);
        assert.equal(Number(cartRows[0].cantidad), 2);
    });
});