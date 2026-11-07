const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const assert = require('node:assert/strict');
const { describe, test, before, after } = require('node:test');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');
const { app } = require('../dist/app');
const db = require('../dist/config/database.config');
const dataSource = db.dataSource;
const { env } = require('../dist/config/env.config');
const { signCursor } = require('../dist/services/cuentaCorriente.service');

describe('Task #251 — API de cuenta corriente para cliente', () => {
    let server;
    let baseUrl;

    const createdUserIds = [];
    const createdClienteIds = [];
    const createdCuentaIds = [];

    function signTestToken(payload) {
        try {
            const tokenService = require('../dist/services/token.service');
            if (typeof tokenService.signToken === 'function') {
                return tokenService.signToken(payload);
            }
        } catch {
            // fallback
        }
        return jwt.sign(payload, env.jwtSecret);
    }

    async function createScenarioClient({ tipo, empresaAprobada, conCuenta, cuentaHabilitada, limiteCredito = '500.00' }) {
        const timestamp = Date.now() + Math.floor(Math.random() * 100000);
        const email = `test-cc-${timestamp}@ferrepatagonia.com`;

        const clienteRes = await dataSource.query(
            `INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, cuit, estado_aprobacion_empresa, es_fiel, activo)
             VALUES (?, ?, ?, ?, 0, 1)`,
            [
                tipo,
                `Cliente ${timestamp}`,
                tipo === 'EMPRESA' ? `30${String(timestamp).slice(-8)}1` : null,
                tipo === 'EMPRESA' ? empresaAprobada : null
            ]
        );
        const idCliente = clienteRes.insertId;
        createdClienteIds.push(idCliente);

        const userRes = await dataSource.query(
            `INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo)
             VALUES (?, ?, 'hash_dummy', 'CLIENTE', 1)`,
            [idCliente, email]
        );
        const idUsuario = userRes.insertId;
        createdUserIds.push(idUsuario);

        let idCuenta = null;
        if (conCuenta) {
            const cuentaRes = await dataSource.query(
                `INSERT INTO CUENTA_CORRIENTE (id_cliente, limite_credito, habilitada, observaciones)
                 VALUES (?, ?, ?, 'Cuenta test')`,
                [idCliente, limiteCredito, cuentaHabilitada ? 1 : 0]
            );
            idCuenta = cuentaRes.insertId;
            createdCuentaIds.push(idCuenta);
        }

        const token = signTestToken({ id: idUsuario, rol: 'CLIENTE' });
        const cookie = `jwt_token=${token}; auth_token=${token}`;

        return { idUsuario, idCliente, idCuenta, cookie };
    }

    before(async () => {
        if (!dataSource.isInitialized) {
            await dataSource.initialize();
        }
        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        baseUrl = `http://127.0.0.1:${server.address().port}/api/cuenta-corriente`;
    });

    after(async () => {
        try {
            if (createdCuentaIds.length > 0) {
                const placeholders = createdCuentaIds.map(() => '?').join(',');
                await dataSource.query(`DELETE FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente IN (${placeholders})`, createdCuentaIds);
            }
            if (createdUserIds.length > 0) {
                const placeholders = createdUserIds.map(() => '?').join(',');
                await dataSource.query(`DELETE FROM USUARIO WHERE id_usuario IN (${placeholders})`, createdUserIds);
            }
            if (createdClienteIds.length > 0) {
                const placeholders = createdClienteIds.map(() => '?').join(',');
                await dataSource.query(`DELETE FROM CLIENTE WHERE id_cliente IN (${placeholders})`, createdClienteIds);
            }
        } catch {
            // Ignorar errores de cascada en teardown
        }

        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }

        if (typeof db.destroyDatabase === 'function') {
            await db.destroyDatabase();
        } else if (dataSource && dataSource.isInitialized) {
            await dataSource.destroy();
        }
    });

    test('1. Resumen: Cliente sin cuenta devuelve 200 OK con SIN_CUENTA', async () => {
        const client = await createScenarioClient({ tipo: 'PARTICULAR', conCuenta: false });
        const res = await fetch(baseUrl, { headers: { Cookie: client.cookie } });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('cache-control'), 'private, no-store');
        assert.equal(res.headers.get('vary'), 'Cookie');
        const body = await res.json();
        assert.equal(body.data.estado, 'SIN_CUENTA');
    });

    test('2. Resumen: Empresa con cuenta habilitada pero sin cobertura responde saldo null y NO_ACREDITADA', async () => {
        const client = await createScenarioClient({
            tipo: 'EMPRESA',
            empresaAprobada: 'APROBADA',
            conCuenta: true,
            cuentaHabilitada: true,
            limiteCredito: '1000.00'
        });

        const res = await fetch(baseUrl, { headers: { Cookie: client.cookie } });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.data.estado, 'HABILITADA');
        assert.equal(body.data.limite, '1000.00');
        assert.equal(body.data.saldo, null);
        assert.equal(body.data.disponible, null);
        assert.equal(body.data.cobertura, 'NO_ACREDITADA');
        assert.equal(body.data.estadoCredito, 'NO_DETERMINABLE');
    });

    test('3. Anti-IDOR: Rechazo 400 CONSULTA_INVALIDA ante parámetros manipulados (clienteId)', async () => {
        const client = await createScenarioClient({ tipo: 'PARTICULAR', conCuenta: false });
        const res = await fetch(`${baseUrl}?clienteId=999`, { headers: { Cookie: client.cookie } });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.code, 'CONSULTA_INVALIDA');
    });

    test('4. Control de Rol: Rechazo con 403 Forbidden para rol ADMIN', async () => {
        const timestamp = Date.now() + Math.floor(Math.random() * 100000);
        const adminEmail = `test-admin-${timestamp}@ferrepatagonia.com`;
        const adminRes = await dataSource.query(
            `INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo)
             VALUES (NULL, ?, 'hash_dummy', 'ADMIN', 1)`,
            [adminEmail]
        );
        const idAdmin = adminRes.insertId;
        createdUserIds.push(idAdmin);

        const adminToken = signTestToken({ id: idAdmin, rol: 'ADMIN' });
        const res = await fetch(baseUrl, { headers: { Cookie: `jwt_token=${adminToken}; auth_token=${adminToken}` } });
        assert.equal(res.status, 403);
        assert.equal(res.headers.get('cache-control'), 'private, no-store');
    });

    test('5. Movimientos: Validación de límites y rechazo de cursor adulterado', async () => {
        const client = await createScenarioClient({
            tipo: 'EMPRESA',
            empresaAprobada: 'APROBADA',
            conCuenta: true,
            cuentaHabilitada: true
        });

        const resBadLimit = await fetch(`${baseUrl}/movimientos?limite=150`, { headers: { Cookie: client.cookie } });
        assert.equal(resBadLimit.status, 400);
        assert.equal((await resBadLimit.json()).code, 'CONSULTA_INVALIDA');

        const resBadCursor = await fetch(`${baseUrl}/movimientos?cursor=cursor_invalido`, { headers: { Cookie: client.cookie } });
        assert.equal(resBadCursor.status, 400);
        assert.equal((await resBadCursor.json()).code, 'CONSULTA_INVALIDA');
    });

    test('6. Concurrencia: Retorno 409 Conflict si la revisión de la cuenta cambia', async () => {
        const client = await createScenarioClient({
            tipo: 'EMPRESA',
            empresaAprobada: 'APROBADA',
            conCuenta: true,
            cuentaHabilitada: true
        });

        const staleCursor = signCursor({
            userId: client.idUsuario,
            cuentaId: client.idCuenta,
            scope: 'movimientos',
            corte: new Date().toISOString(),
            revision: 'rev-vieja',
            offset: 0
        });

        const res = await fetch(`${baseUrl}/movimientos?cursor=${staleCursor}`, { headers: { Cookie: client.cookie } });
        assert.equal(res.status, 409);
        assert.equal((await res.json()).code, 'CONSULTA_DESACTUALIZADA');
    });
});