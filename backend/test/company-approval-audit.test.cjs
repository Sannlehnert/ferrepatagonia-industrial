require('./helpers/integration-lifecycle.cjs');

// En Linux/WSL el binario nativo de sharp instalado para Windows no carga.
// La auditoría no procesa imágenes: se reemplaza únicamente el módulo para
// permitir importar la app. En Windows se usa el sharp real.
try {
    require('sharp');
} catch {
    const sharpPath = require.resolve('sharp');
    require.cache[sharpPath] = {
        id: sharpPath,
        filename: sharpPath,
        loaded: true,
        exports: Object.assign(
            () => ({
                resize: () => ({}),
                webp: () => ({}),
                toBuffer: async () => Buffer.alloc(0),
                metadata: async () => ({ width: 100, height: 100 }),
            }),
            {
                resize: () => ({}),
                webp: () => ({}),
                toBuffer: async () => Buffer.alloc(0),
                metadata: async () => ({ width: 100, height: 100 }),
            },
        ),
    };
}

const assert = require('node:assert/strict');
const { describe, test, before, after } = require('node:test');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { app } = require('../dist/app');
const { dataSource } = require('../dist/config/database.config');
const { pool } = require('../dist/config/catalog-snapshot.config');
const { env } = require('../dist/config/env.config');
const { authCookieName } = require('../dist/config/auth-cookie.config');
const { signToken } = require('../dist/services/token.service');

after(() => pool.end());

describe('T-S7-03.1 — Registro empresarial y autorización comercial', () => {
    let server;
    let baseUrl;
    let adminUserId;
    let adminToken;
    let productId;
    let productPrice;

    const APP_ORIGIN = env.httpSecurity?.publicOrigin || env.appPublicOrigin || 'http://localhost:5173';

    async function apiRequest(endpoint, options = {}) {
        const headers = {
            'Origin': APP_ORIGIN,
            'Connection': 'close',
            ...(options.headers || {}),
        };

        if (options.body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }

        if (options.token) {
            headers['Cookie'] = `${authCookieName}=${options.token}`;
        }

        return fetch(`${baseUrl}${endpoint}`, {
            ...options,
            headers,
        });
    }

    function cuit() {
        const serial = String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
        return `30-${serial}-9`;
    }

    async function registerCompany(overrides = {}) {
        const email = `empresa-${randomUUID()}@patagonia-test.com`;
        const password = 'EmpresaPassword123!';
        const res = await apiRequest('/auth/register', {
            method: 'POST',
            body: JSON.stringify({
                tipoCliente: 'EMPRESA',
                nombreRazonSocial: 'Patagonia Industrial SRL',
                cuit: cuit(),
                email,
                password,
                telefono: '2966112233',
                direccion: 'Parque Industrial 500',
                ...overrides,
            }),
        });
        assert.equal(res.status, 201, 'El registro de empresa debe responder HTTP 201');
        const body = await res.json();
        return { email, password, userId: Number(body.data.user.id), body };
    }

    async function loginToken(email, password) {
        const res = await apiRequest('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
        assert.equal(res.status, 200, 'El login debe responder HTTP 200');
        const setCookie = res.headers.get('set-cookie');
        assert.ok(setCookie, 'El login debe emitir la cookie HttpOnly de sesión');
        return setCookie.split(';')[0].split('=')[1];
    }

    async function clientRowByEmail(email) {
        const [row] = await dataSource.query(
            'SELECT * FROM CLIENTE WHERE email = ?',
            [email],
        );
        assert.ok(row, 'La fila CLIENTE debe existir en MariaDB');
        return row;
    }

    async function createCreditAccount(clientId, overrides = {}) {
        const {
            limite = '2000.00',
            habilitada = 1,
            cobertura = 'COMPLETA',
            plazoDias = 30,
            monedaLimite = 'USD',
        } = overrides;
        const result = await dataSource.query(`
            INSERT INTO CUENTA_CORRIENTE (
                id_cliente, limite_credito, habilitada, cobertura,
                plazo_dias, moneda_limite, evidencia_limite, evidencia_plazo,
                evidencia_cobertura, cobertura_desde_utc, origen_datos
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3) - INTERVAL 1 DAY, 'DEMO')
        `, [
            clientId, limite, habilitada, cobertura, plazoDias, monedaLimite,
            'EVIDENCIA LIMITE TEST', 'EVIDENCIA PLAZO TEST', 'EVIDENCIA COBERTURA TEST',
        ]);
        return Number(result.insertId);
    }

    async function createCart(clientId, quantity = 1) {
        const cart = await dataSource.query(
            'INSERT INTO CARRITO (id_cliente) VALUES (?)',
            [clientId],
        );
        const cartId = Number(cart.insertId);
        await dataSource.query(
            'INSERT INTO ITEM_CARRITO (id_carrito, id_producto, cantidad) VALUES (?, ?, ?)',
            [cartId, productId, quantity],
        );
        return cartId;
    }

    async function approve(clientId, estado, token = adminToken) {
        return apiRequest(`/admin/clientes/${clientId}/estado-empresa`, {
            method: 'PATCH',
            token,
            body: JSON.stringify({ estado }),
        });
    }

    async function commercialEffects(clientId, accountId) {
        const [orders] = await dataSource.query(
            'SELECT COUNT(*) AS c FROM PEDIDO WHERE id_cliente = ?',
            [clientId],
        );
        const [movements] = accountId === null
            ? [{ c: 0 }]
            : await dataSource.query(
                'SELECT COUNT(*) AS c FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?',
                [accountId],
            );
        const [confirmed] = await dataSource.query(`
            SELECT COUNT(*) AS c FROM CONFIRMACION_PEDIDO_CC
            WHERE id_cliente = ?
              AND (estado = 'CONFIRMADO' OR id_pedido IS NOT NULL OR id_cargo IS NOT NULL)
        `, [clientId]);
        return {
            orders: Number(orders.c),
            movements: Number(movements.c),
            confirmed: Number(confirmed.c),
        };
    }

    before(async () => {
        assert.equal(process.env.NODE_ENV, 'test');
        if (!dataSource.isInitialized) {
            await dataSource.initialize();
        }

        const requiredTables = [
            'CATEGORIA', 'PRODUCTO', 'LISTA_PRECIO', 'COTIZACION', 'CLIENTE', 'USUARIO',
            'PEDIDO', 'DETALLE_PEDIDO', 'CUENTA_CORRIENTE', 'PAGO',
            'MOVIMIENTO_CUENTA_CORRIENTE', 'IMPUTACION_MOVIMIENTO_CUENTA',
            'PRECIO_USD_EVIDENCIA', 'FER17_CALENDARIO', 'FER17_COTIZACION_VERIFICACION',
            'FER17_LISTA_INACTIVA_EVENTO', 'CARRITO', 'ITEM_CARRITO',
            'CONFIRMACION_PEDIDO_CC', 'DETALLE_PEDIDO_CC_PRECIO', 'COMPROBANTE_PAGO',
            'SOLICITUD_CREDITO', 'EVENTO_CREDITO',
        ];
        const tables = await dataSource.query(`
            SELECT TABLE_NAME FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
        `);
        const tableNames = new Set(tables.map(row => row.TABLE_NAME));
        for (const table of requiredTables) {
            assert.ok(tableNames.has(table), `Falta la tabla ${table}`);
        }

        const triggers = await dataSource.query(`
            SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
            WHERE TRIGGER_SCHEMA = DATABASE()
            ORDER BY TRIGGER_NAME
        `);
        const triggerNames = new Set(triggers.map(row => row.TRIGGER_NAME));
        for (const trigger of [
            'fer260_cuenta_revision', 'fer260_imputacion_insert', 'fer260_imputacion_update',
        ]) {
            assert.ok(triggerNames.has(trigger), `Falta el trigger ${trigger}`);
        }

        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        baseUrl = `http://127.0.0.1:${server.address().port}/api`;

        const adminEmail = `admin-audit-${randomUUID()}@ferrepatagonia.test`;
        const adminInsert = await dataSource.query(`
            INSERT INTO USUARIO (email, password_hash, rol, activo, id_cliente)
            VALUES (?, ?, 'ADMIN', 1, NULL)
        `, [adminEmail, await bcrypt.hash('AdminPassword123!', 4)]);
        adminUserId = Number(adminInsert.insertId);
        adminToken = signToken({ id: adminUserId, rol: 'ADMIN' });

        // Producto con precio USD verificado y stock: los rechazos posteriores
        // deben provenir de la autorización, nunca de falta de producto o precio.
        productPrice = '100.00';
        const category = await dataSource.query(
            "INSERT INTO CATEGORIA (nombre, activo) VALUES ('Herramientas Auditoría', 1)",
        );
        const product = await dataSource.query(`
            INSERT INTO PRODUCTO (id_categoria, codigo, nombre, precio, stock, activo)
            VALUES (?, ?, 'Taladro Industrial Auditoría', ?, 500, 1)
        `, [Number(category.insertId), `PROD-AUDIT-${randomUUID().slice(0, 8)}`, productPrice]);
        productId = Number(product.insertId);

        await dataSource.query(`
            INSERT INTO PRECIO_USD_EVIDENCIA (
                id_producto, precio_verificado, evidencia, id_admin,
                verificado_utc, valida, sintetica
            ) VALUES (?, ?, 'Cotización auditada USD', ?, UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE, 1, 0)
        `, [productId, productPrice, adminUserId]);
    });

    after(async () => {
        if (server) {
            if (typeof server.closeAllConnections === 'function') {
                server.closeAllConnections();
            }
            await new Promise(resolve => server.close(resolve));
        }
    });

    // =========================================================================
    // ESCENARIO A — Empresa recién registrada
    // =========================================================================
    describe('A — Empresa recién registrada', () => {
        test('A.1 Registro público EMPRESA crea PENDIENTE, sin cuenta corriente ni crédito', async () => {
            const { email, userId, body } = await registerCompany();

            assert.equal(body.message, 'Registro exitoso');
            assert.equal(body.data.user.email, email);
            assert.equal(body.data.user.rol, 'CLIENTE');
            assert.equal(body.data.user.tipoCliente, 'EMPRESA');

            const [client] = await dataSource.query(`
                SELECT c.*, u.id_usuario, u.rol
                FROM CLIENTE c
                JOIN USUARIO u ON u.id_cliente = c.id_cliente
                WHERE u.id_usuario = ?
            `, [userId]);
            assert.ok(client, 'Debe existir la fila CLIENTE asociada al usuario');
            assert.equal(client.tipo_cliente, 'EMPRESA');
            assert.equal(client.estado_aprobacion_empresa, 'PENDIENTE');
            assert.equal(client.es_fiel, 0);
            assert.equal(client.activo, 1);
            assert.equal(client.rol, 'CLIENTE');

            const [accounts] = await dataSource.query(
                'SELECT COUNT(*) AS c FROM CUENTA_CORRIENTE WHERE id_cliente = ?',
                [client.id_cliente],
            );
            assert.equal(Number(accounts.c), 0, 'El registro no debe crear cuenta corriente ni crédito');
        });

        test('A.2 Registro público PARTICULAR deja estado_aprobacion_empresa en NULL', async () => {
            const email = `particular-${randomUUID()}@patagonia-test.com`;
            const res = await apiRequest('/auth/register', {
                method: 'POST',
                body: JSON.stringify({
                    tipoCliente: 'PARTICULAR',
                    nombreRazonSocial: 'Juan Pérez',
                    docCliente: '34567890',
                    email,
                    password: 'ParticularPass123!',
                }),
            });
            assert.equal(res.status, 201);
            const body = await res.json();
            assert.equal(body.data.user.tipoCliente, 'PARTICULAR');

            const client = await clientRowByEmail(email);
            assert.equal(client.tipo_cliente, 'PARTICULAR');
            assert.equal(client.estado_aprobacion_empresa, null);
        });

        test('A.3 La empresa pendiente inicia sesión y consulta SIN_CUENTA sin operaciones de crédito', async () => {
            const { email, password } = await registerCompany();
            const client = await clientRowByEmail(email);
            const token = await loginToken(email, password);

            const me = await apiRequest('/auth/me', { token });
            assert.equal(me.status, 200);
            const meBody = await me.json();
            assert.equal(meBody.user.email, email);
            assert.equal(meBody.user.rol, 'CLIENTE');

            for (const endpoint of ['/cuenta-corriente', '/cuenta-corriente/movimientos', '/cuenta-corriente/vencimientos']) {
                const res = await apiRequest(endpoint, { token });
                assert.equal(res.status, 200, `${endpoint} debe responder HTTP 200`);
                const body = await res.json();
                assert.equal(body.data.estado, 'SIN_CUENTA', `${endpoint} debe informar SIN_CUENTA`);
            }

            const eligibility = await apiRequest('/pedidos/cuenta-corriente/eligibilidad', { token });
            assert.equal(eligibility.status, 200);
            const eligibilityBody = await eligibility.json();
            assert.equal(eligibilityBody.data.elegible, false);
            assert.equal(eligibilityBody.data.codigo, 'CUENTA_NO_HABILITADA');
            assert.equal(eligibilityBody.data.cotizacion, null);

            assert.deepEqual(
                await commercialEffects(client.id_cliente, null),
                { orders: 0, movements: 0, confirmed: 0 },
            );
        });
    });

    // =========================================================================
    // ESCENARIO B — Empresa pendiente CON cuenta habilitada
    // =========================================================================
    describe('B — Empresa pendiente con cuenta corriente habilitada', () => {
        let clientId;
        let accountId;
        let cartId;
        let token;

        before(async () => {
            const { email, password } = await registerCompany();
            clientId = (await clientRowByEmail(email)).id_cliente;
            token = await loginToken(email, password);
            // La cuenta se crea por fixture: el registro no la crea (A.1).
            accountId = await createCreditAccount(clientId);
            cartId = await createCart(clientId, 1);
        });

        test('B.1 La elegibilidad se rechaza por aprobación, no por producto/stock/precio', async () => {
            const res = await apiRequest('/pedidos/cuenta-corriente/eligibilidad', { token });
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.data.elegible, false);
            assert.equal(body.data.codigo, 'EMPRESA_NO_HABILITADA');
            assert.equal(body.data.cotizacion, null);
            assert.equal(body.data.totalUSD, null);
        });

        test('B.2 Confirmar pedido a crédito devuelve 403 EMPRESA_NO_HABILITADA sin efectos persistentes', async () => {
            const res = await apiRequest('/pedidos/cuenta-corriente', {
                method: 'POST',
                token,
                headers: { 'Idempotency-Key': randomUUID() },
                body: JSON.stringify({ cotizacion: 'a'.repeat(40) }),
            });
            assert.equal(res.status, 403);
            const body = await res.json();
            assert.equal(body.code, 'EMPRESA_NO_HABILITADA');

            assert.deepEqual(
                await commercialEffects(clientId, accountId),
                { orders: 0, movements: 0, confirmed: 0 },
            );

            const items = await dataSource.query(
                'SELECT cantidad FROM ITEM_CARRITO WHERE id_carrito = ?',
                [cartId],
            );
            assert.equal(items.length, 1, 'El carrito rechazado no debe vaciarse');
            assert.equal(Number(items[0].cantidad), 1);
        });
    });

    // =========================================================================
    // ESCENARIO C — Empresa aprobada por ADMIN, sin crédito
    // =========================================================================
    describe('C — Empresa aprobada sin crédito', () => {
        let clientId;
        let token;

        before(async () => {
            const { email, password } = await registerCompany();
            clientId = (await clientRowByEmail(email)).id_cliente;
            token = await loginToken(email, password);
        });

        test('C.1 El ADMIN aprueba la empresa y la aprobación NO habilita crédito', async () => {
            const res = await approve(clientId, 'APROBADA');
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.data.cliente.estadoAprobacionEmpresa, 'APROBADA');

            const client = await clientRowByEmail((await dataSource.query(
                'SELECT email FROM CLIENTE WHERE id_cliente = ?', [clientId],
            ))[0].email);
            assert.equal(client.estado_aprobacion_empresa, 'APROBADA');

            const [accounts] = await dataSource.query(
                'SELECT COUNT(*) AS c FROM CUENTA_CORRIENTE WHERE id_cliente = ?',
                [clientId],
            );
            assert.equal(Number(accounts.c), 0, 'APROBADA no debe crear cuenta corriente');
        });

        test('C.2 Empresa aprobada sin cuenta no es elegible (CUENTA_NO_HABILITADA)', async () => {
            const res = await apiRequest('/pedidos/cuenta-corriente/eligibilidad', { token });
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.data.elegible, false);
            assert.equal(body.data.codigo, 'CUENTA_NO_HABILITADA');
            assert.equal(body.data.cotizacion, null);
        });

        test('C.3 Confirmar pedido a crédito devuelve 403 CUENTA_NO_HABILITADA y no crea pedido', async () => {
            const res = await apiRequest('/pedidos/cuenta-corriente', {
                method: 'POST',
                token,
                headers: { 'Idempotency-Key': randomUUID() },
                body: JSON.stringify({ cotizacion: 'b'.repeat(40) }),
            });
            assert.equal(res.status, 403);
            const body = await res.json();
            assert.equal(body.code, 'CUENTA_NO_HABILITADA');
            assert.deepEqual(
                await commercialEffects(clientId, null),
                { orders: 0, movements: 0, confirmed: 0 },
            );
        });
    });

    // =========================================================================
    // ESCENARIO D — Empresa aprobada con crédito habilitado
    // =========================================================================
    describe('D — Empresa aprobada con crédito habilitado', () => {
        let clientId;
        let accountId;
        let cartId;
        let token;

        before(async () => {
            const { email, password } = await registerCompany();
            clientId = (await clientRowByEmail(email)).id_cliente;
            token = await loginToken(email, password);
            const approval = await approve(clientId, 'APROBADA');
            assert.equal(approval.status, 200);
            accountId = await createCreditAccount(clientId);
            cartId = await createCart(clientId, 2);
        });

        test('D.1 La elegibilidad autorizada calcula total y crédito disponible', async () => {
            const res = await apiRequest('/pedidos/cuenta-corriente/eligibilidad', { token });
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.data.elegible, true);
            assert.equal(body.data.moneda, 'USD');
            assert.equal(body.data.totalUSD, '200.00');
            assert.equal(body.data.creditoDisponibleUSD, '2000.00');
            assert.equal(typeof body.data.cotizacion, 'string');
            assert.ok(body.data.cotizacion.length > 0);
        });

        test('D.2 La confirmación autorizada persiste pedido, cargo, stock y saldo', async () => {
            const [stockBefore] = await dataSource.query(
                'SELECT stock FROM PRODUCTO WHERE id_producto = ?',
                [productId],
            );

            const eligibility = await apiRequest('/pedidos/cuenta-corriente/eligibilidad', { token });
            const { cotizacion } = (await eligibility.json()).data;

            const confirmation = await apiRequest('/pedidos/cuenta-corriente', {
                method: 'POST',
                token,
                headers: { 'Idempotency-Key': randomUUID() },
                body: JSON.stringify({ cotizacion }),
            });
            assert.equal(confirmation.status, 201);
            const confirmed = await confirmation.json();
            assert.ok(confirmed.data.pedidoId > 0);
            assert.equal(confirmed.data.estado, 'CONFIRMADO');
            assert.equal(confirmed.data.modalidadPago, 'CUENTA_CORRIENTE');
            assert.equal(confirmed.data.totalUSD, '200.00');

            const [order] = await dataSource.query(
                'SELECT * FROM PEDIDO WHERE id_pedido = ?',
                [confirmed.data.pedidoId],
            );
            assert.ok(order);
            assert.equal(Number(order.id_cliente), clientId);
            assert.equal(order.modalidad_pago, 'CUENTA_CORRIENTE');
            assert.equal(order.moneda_total, 'USD');
            assert.equal(order.total, '200.00');

            const [movement] = await dataSource.query(`
                SELECT * FROM MOVIMIENTO_CUENTA_CORRIENTE
                WHERE id_cuenta_corriente = ? AND id_pedido = ?
            `, [accountId, confirmed.data.pedidoId]);
            assert.ok(movement, 'Debe existir el cargo en la cuenta corriente');
            assert.equal(movement.tipo_movimiento, 'CARGO');
            assert.equal(movement.estado, 'ACREDITADO');
            assert.equal(movement.monto, '200.00');

            const [stockAfter] = await dataSource.query(
                'SELECT stock FROM PRODUCTO WHERE id_producto = ?',
                [productId],
            );
            assert.equal(Number(stockAfter.stock), Number(stockBefore.stock) - 2);

            const [cartItems] = await dataSource.query(
                'SELECT COUNT(*) AS c FROM ITEM_CARRITO WHERE id_carrito = ?',
                [cartId],
            );
            assert.equal(Number(cartItems.c), 0, 'El carrito confirmado debe quedar vacío');

            const summary = await apiRequest('/cuenta-corriente', { token });
            assert.equal(summary.status, 200);
            const summaryBody = await summary.json();
            assert.equal(summaryBody.data.estado, 'HABILITADA');
            assert.equal(summaryBody.data.saldo, '200.00');
            assert.equal(summaryBody.data.disponible, '1800.00');
        });
    });

    // =========================================================================
    // ESCENARIO E — Empresa rechazada con crédito previamente habilitado
    // =========================================================================
    describe('E — Empresa rechazada', () => {
        let clientId;
        let accountId;
        let token;
        let historicalOrderId;

        before(async () => {
            const { email, password } = await registerCompany();
            clientId = (await clientRowByEmail(email)).id_cliente;
            token = await loginToken(email, password);
            assert.equal((await approve(clientId, 'APROBADA')).status, 200);
            accountId = await createCreditAccount(clientId);
            await createCart(clientId, 1);

            const order = await dataSource.query(`
                INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total)
                VALUES (?, 'ENTREGADO', 'TRANSFERENCIA', 150.00, 0.00, 150.00)
            `, [clientId]);
            historicalOrderId = Number(order.insertId);
        });

        test('E.1 El ADMIN rechaza una empresa previamente aprobada', async () => {
            const res = await approve(clientId, 'RECHAZADA');
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.data.cliente.estadoAprobacionEmpresa, 'RECHAZADA');

            const [saved] = await dataSource.query(
                'SELECT estado_aprobacion_empresa FROM CLIENTE WHERE id_cliente = ?',
                [clientId],
            );
            assert.equal(saved.estado_aprobacion_empresa, 'RECHAZADA');
        });

        test('E.2 Con cuenta y crédito vigentes, la empresa rechazada no puede comprar a crédito', async () => {
            const eligibility = await apiRequest('/pedidos/cuenta-corriente/eligibilidad', { token });
            assert.equal(eligibility.status, 200);
            const eligibilityBody = await eligibility.json();
            assert.equal(eligibilityBody.data.elegible, false);
            assert.equal(eligibilityBody.data.codigo, 'EMPRESA_NO_HABILITADA');
            assert.equal(eligibilityBody.data.cotizacion, null);

            const confirmation = await apiRequest('/pedidos/cuenta-corriente', {
                method: 'POST',
                token,
                headers: { 'Idempotency-Key': randomUUID() },
                body: JSON.stringify({ cotizacion: 'c'.repeat(40) }),
            });
            assert.equal(confirmation.status, 403);
            assert.equal((await confirmation.json()).code, 'EMPRESA_NO_HABILITADA');

            assert.deepEqual(
                await commercialEffects(clientId, accountId),
                { orders: 1, movements: 0, confirmed: 0 },
                'Solo debe existir el pedido histórico, sin cargos nuevos',
            );
        });

        test('E.3 La empresa rechazada conserva acceso a su historial de pedidos', async () => {
            const list = await apiRequest('/pedidos', { token });
            assert.equal(list.status, 200);
            const listBody = await list.json();
            assert.ok(Array.isArray(listBody.data.items));
            assert.ok(listBody.data.items.some(order => order.pedidoId === historicalOrderId));

            const detail = await apiRequest(`/pedidos/${historicalOrderId}`, { token });
            assert.equal(detail.status, 200);
            const detailBody = await detail.json();
            assert.equal(detailBody.data.pedidoId, historicalOrderId);
            assert.equal(detailBody.data.modalidadPago, 'TRANSFERENCIA');
        });
    });

    // =========================================================================
    // ESCENARIO F — Permisos, manipulación y auto-habilitación
    // =========================================================================
    describe('F — Permisos y manipulación', () => {
        let clientId;
        let token;

        before(async () => {
            const { email, password } = await registerCompany();
            clientId = (await clientRowByEmail(email)).id_cliente;
            token = await loginToken(email, password);
        });

        async function approvalState() {
            const [row] = await dataSource.query(
                'SELECT estado_aprobacion_empresa, es_fiel FROM CLIENTE WHERE id_cliente = ?',
                [clientId],
            );
            return row;
        }

        test('F.1 Sin sesión, los endpoints administrativos responden 401', async () => {
            const res = await apiRequest(`/admin/clientes/${clientId}/estado-empresa`, {
                method: 'PATCH',
                body: JSON.stringify({ estado: 'APROBADA' }),
            });
            assert.equal(res.status, 401);
        });

        test('F.2 Un CLIENTE no puede autoaprobarse (403) y su estado permanece PENDIENTE', async () => {
            const res = await approve(clientId, 'APROBADA', token);
            assert.equal(res.status, 403);
            const state = await approvalState();
            assert.equal(state.estado_aprobacion_empresa, 'PENDIENTE');
        });

        test('F.3 Un CLIENTE no puede modificar el estado de otra empresa (403)', async () => {
            const res = await approve(clientId + 1, 'APROBADA', token);
            assert.equal(res.status, 403);
        });

        test('F.4 Un CLIENTE no puede habilitarse crédito por endpoints administrativos', async () => {
            for (const [method, endpoint] of [
                ['GET', `/admin/clientes/${clientId}/cuenta-corriente`],
                ['PATCH', `/admin/clientes/${clientId}/cuenta-corriente`],
                ['POST', `/admin/clientes/${clientId}/cuenta-corriente`],
                ['PUT', `/admin/clientes/${clientId}/cuenta-corriente`],
            ]) {
                const res = await apiRequest(endpoint, {
                    method,
                    token,
                    ...(method === 'GET' ? {} : { body: JSON.stringify({ habilitada: true, limite: '999999.00' }) }),
                });
                assert.equal(res.status, 403, `${method} ${endpoint} debe rechazar al CLIENTE`);
            }

            const [accounts] = await dataSource.query(
                'SELECT COUNT(*) AS c FROM CUENTA_CORRIENTE WHERE id_cliente = ?',
                [clientId],
            );
            assert.equal(Number(accounts.c), 0, 'El cliente no pudo crear ni habilitar crédito');
        });

        test('F.5 El ADMIN recibe 400 ante IDs inválidos, estados inválidos o campos ajenos', async () => {
            const invalidId = await apiRequest('/admin/clientes/no-valido/estado-empresa', {
                method: 'PATCH',
                token: adminToken,
                body: JSON.stringify({ estado: 'APROBADA' }),
            });
            assert.equal(invalidId.status, 400);

            const invalidState = await approve(clientId, 'HACKEADA');
            assert.equal(invalidState.status, 400);

            const injected = await apiRequest(`/admin/clientes/${clientId}/estado-empresa`, {
                method: 'PATCH',
                token: adminToken,
                body: JSON.stringify({ estado: 'APROBADA', rol: 'ADMIN', es_fiel: 1, id_cliente: 1 }),
            });
            assert.equal(injected.status, 400, 'Los campos no permitidos deben rechazarse');

            const state = await approvalState();
            assert.equal(state.estado_aprobacion_empresa, 'PENDIENTE');
            assert.equal(state.es_fiel, 0);
        });

        test('F.6 El ADMIN no puede aprobar una cuenta PARTICULAR (400)', async () => {
            const email = `part-probe-${randomUUID()}@patagonia-test.com`;
            const created = await apiRequest('/auth/register', {
                method: 'POST',
                body: JSON.stringify({
                    tipoCliente: 'PARTICULAR',
                    nombreRazonSocial: 'Particular No Empresa',
                    email,
                    password: 'ParticularPass123!',
                }),
            });
            assert.equal(created.status, 201);
            const particular = await clientRowByEmail(email);

            const res = await approve(particular.id_cliente, 'APROBADA');
            assert.equal(res.status, 400);
            assert.match((await res.json()).message, /empresa/i);

            const [saved] = await dataSource.query(
                'SELECT estado_aprobacion_empresa FROM CLIENTE WHERE id_cliente = ?',
                [particular.id_cliente],
            );
            assert.equal(saved.estado_aprobacion_empresa, null);
        });

        test('F.7 El endpoint administrativo no expone una vía para habilitar crédito (ADMIN: 404)', async () => {
            const res = await apiRequest(`/admin/clientes/${clientId}/cuenta-corriente`, {
                method: 'PATCH',
                token: adminToken,
                body: JSON.stringify({ habilitada: true }),
            });
            assert.equal(res.status, 404, 'No debe existir un endpoint de escritura de cuenta corriente');

            const [accounts] = await dataSource.query(
                'SELECT COUNT(*) AS c FROM CUENTA_CORRIENTE WHERE id_cliente = ?',
                [clientId],
            );
            assert.equal(Number(accounts.c), 0);
        });
    });

    // =========================================================================
    // ESCENARIO G — TOCTOU: perder autorización entre cotización y confirmación
    // =========================================================================
    describe('G — Condiciones de carrera entre cotización y confirmación', () => {
        async function approvedWithCredit() {
            const { email, password } = await registerCompany();
            const client = await clientRowByEmail(email);
            const token = await loginToken(email, password);
            assert.equal((await approve(client.id_cliente, 'APROBADA')).status, 200);
            const accountId = await createCreditAccount(client.id_cliente);
            const cartId = await createCart(client.id_cliente, 1);
            return { clientId: client.id_cliente, accountId, cartId, token };
        }

        async function quote(token) {
            const res = await apiRequest('/pedidos/cuenta-corriente/eligibilidad', { token });
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.data.elegible, true);
            assert.equal(typeof body.data.cotizacion, 'string');
            return body.data.cotizacion;
        }

        test('G.1 Una cotización emitida antes del rechazo administrativo no permite confirmar', async () => {
            const fixture = await approvedWithCredit();
            const cotizacion = await quote(fixture.token);

            assert.equal((await approve(fixture.clientId, 'RECHAZADA')).status, 200);

            const res = await apiRequest('/pedidos/cuenta-corriente', {
                method: 'POST',
                token: fixture.token,
                headers: { 'Idempotency-Key': randomUUID() },
                body: JSON.stringify({ cotizacion }),
            });
            assert.equal(res.status, 403);
            assert.equal((await res.json()).code, 'EMPRESA_NO_HABILITADA');

            assert.deepEqual(
                await commercialEffects(fixture.clientId, fixture.accountId),
                { orders: 0, movements: 0, confirmed: 0 },
            );

            const [items] = await dataSource.query(
                'SELECT COUNT(*) AS c FROM ITEM_CARRITO WHERE id_carrito = ?',
                [fixture.cartId],
            );
            assert.equal(Number(items.c), 1);
        });

        test('G.2 Una cotización emitida antes de inhabilitar la cuenta no permite confirmar', async () => {
            const fixture = await approvedWithCredit();
            const cotizacion = await quote(fixture.token);

            await dataSource.query(
                'UPDATE CUENTA_CORRIENTE SET habilitada = 0 WHERE id_cuenta_corriente = ?',
                [fixture.accountId],
            );

            const res = await apiRequest('/pedidos/cuenta-corriente', {
                method: 'POST',
                token: fixture.token,
                headers: { 'Idempotency-Key': randomUUID() },
                body: JSON.stringify({ cotizacion }),
            });
            assert.equal(res.status, 403);
            assert.equal((await res.json()).code, 'CUENTA_NO_HABILITADA');

            assert.deepEqual(
                await commercialEffects(fixture.clientId, fixture.accountId),
                { orders: 0, movements: 0, confirmed: 0 },
            );
        });
    });
});
