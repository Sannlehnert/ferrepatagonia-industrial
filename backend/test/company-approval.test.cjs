require('./helpers/integration-lifecycle.cjs');

const assert = require('node:assert/strict');
const { describe, test, before, after } = require('node:test');
const { once } = require('node:events');
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
                const userRepo = dataSource.getRepository(UsuarioSchema);
                const clienteRepo = dataSource.getRepository(ClienteSchema);
                for (const uid of createdUserIds) {
                    await userRepo.delete({ id_usuario: uid }).catch(() => {});
                }
                for (const cid of createdClienteIds) {
                    await clienteRepo.delete({ id_cliente: cid }).catch(() => {});
                }
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
});