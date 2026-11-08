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
const {
    registrarCargoPorPedido,
    registrarAbonoPorPago
} = require('../dist/repositories/cuentaCorriente.repository');

describe('Task #251 — API de cuenta corriente para cliente', () => {
    let server;
    let baseUrl;

    const createdUserIds = [];
    const createdClienteIds = [];
    const createdCuentaIds = [];
    const createdPedidoIds = [];
    const createdPagoIds = [];

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

    async function createScenarioClient({
        tipo = 'EMPRESA',
        empresaAprobada = 'APROBADA',
        conCuenta = true,
        cuentaHabilitada = true,
        limiteCredito = '1000.00',
        limiteAcreditado = true,
        cobertura = 'COMPLETA',
        plazoDias = 30
    } = {}) {
        const timestamp = Date.now() + Math.floor(Math.random() * 1000000);
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
            const esCompleta = cobertura === 'COMPLETA';
            const cuentaRes = await dataSource.query(
                `INSERT INTO CUENTA_CORRIENTE
                 (id_cliente, limite_credito, habilitada, cobertura, plazo_dias, observaciones,
                  moneda_limite, evidencia_limite, evidencia_plazo, evidencia_cobertura,
                  cobertura_desde_utc, origen_datos, revision)
                 VALUES (?, ?, ?, ?, ?, 'Cuenta test #251',
                         ?, ?, ?, ?,
                         ?, 'DEMO', 1)`,
                [
                    idCliente,
                    limiteCredito,
                    cuentaHabilitada ? 1 : 0,
                    cobertura,
                    plazoDias,
                    limiteAcreditado ? 'USD' : null,
                    limiteAcreditado ? 'EV_LIM_TEST' : null,
                    plazoDias ? 'EV_PLAZO_TEST' : null,
                    esCompleta ? 'EV_COB_TEST' : null,
                    esCompleta ? '2026-01-01 00:00:00.000' : null
                ]
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
                await dataSource.query(`DELETE FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_cuenta_corriente IN (${placeholders})`, createdCuentaIds);
                await dataSource.query(`DELETE FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente IN (${placeholders})`, createdCuentaIds);
                await dataSource.query(`DELETE FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente IN (${placeholders})`, createdCuentaIds);
            }
            if (createdPedidoIds.length > 0) {
                const placeholders = createdPedidoIds.map(() => '?').join(',');
                await dataSource.query(`DELETE FROM PEDIDO WHERE id_pedido IN (${placeholders})`, createdPedidoIds);
            }
            if (createdPagoIds.length > 0) {
                const placeholders = createdPagoIds.map(() => '?').join(',');
                await dataSource.query(`DELETE FROM PAGO WHERE id_pago IN (${placeholders})`, createdPagoIds);
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
            // Ignorar errores en limpieza de cascada
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
            conCuenta: true,
            cuentaHabilitada: true,
            limiteCredito: '1000.00',
            limiteAcreditado: true,
            cobertura: 'NO_ACREDITADA'
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
        assert.equal(body.data.deudaVencidaTotal, null);
    });

    test('3. Resumen: Cuenta con cobertura completa expone saldo real, disponible y aging buckets', async () => {
        const client = await createScenarioClient({
            tipo: 'EMPRESA',
            conCuenta: true,
            cuentaHabilitada: true,
            limiteCredito: '1000.00',
            cobertura: 'COMPLETA',
            plazoDias: 30
        });

        const pedRes = await dataSource.query(
            `INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total, moneda_total, evidencia_total_usd)
             VALUES (?, 'PENDIENTE', 'CUENTA_CORRIENTE', 250.00, 0.00, 250.00, 'USD', 'EV_TOTAL_PEDIDO')`,
            [client.idCliente]
        );
        createdPedidoIds.push(pedRes.insertId);

        await registrarCargoPorPedido({
            id_cuenta_corriente: client.idCuenta,
            id_pedido: pedRes.insertId,
            monto: '250.00',
            dias_vencimiento: 30
        });

        const res = await fetch(baseUrl, { headers: { Cookie: client.cookie } });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.data.estado, 'HABILITADA');
        assert.equal(body.data.limite, '1000.00');
        assert.equal(body.data.saldo, '250.00');
        assert.equal(body.data.utilizado, '250.00');
        assert.equal(body.data.disponible, '750.00');
        assert.equal(body.data.cobertura, 'COMPLETA');
        assert.equal(body.data.estadoCredito, 'DISPONIBLE');
        assert.equal(body.data.deudaPorVencerTotal, '250.00');
        assert.equal(body.data.deudaVencidaTotal, '0.00');
    });

    test('4. Movimientos: Paginación, orden descendente y saldoResultante acumulado', async () => {
        const client = await createScenarioClient({
            tipo: 'EMPRESA',
            conCuenta: true,
            cuentaHabilitada: true,
            cobertura: 'COMPLETA',
            limiteCredito: '1000.00'
        });

        const p1 = await dataSource.query(
            `INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total, moneda_total, evidencia_total_usd)
             VALUES (?, 'PENDIENTE', 'CUENTA_CORRIENTE', 100.00, 0.00, 100.00, 'USD', 'EV_P1')`,
            [client.idCliente]
        );
        createdPedidoIds.push(p1.insertId);
        await registrarCargoPorPedido({
            id_cuenta_corriente: client.idCuenta,
            id_pedido: p1.insertId,
            monto: '100.00'
        });

        const p2 = await dataSource.query(
            `INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total, moneda_total, evidencia_total_usd)
             VALUES (?, 'PENDIENTE', 'CUENTA_CORRIENTE', 200.00, 0.00, 200.00, 'USD', 'EV_P2')`,
            [client.idCliente]
        );
        createdPedidoIds.push(p2.insertId);
        await registrarCargoPorPedido({
            id_cuenta_corriente: client.idCuenta,
            id_pedido: p2.insertId,
            monto: '200.00'
        });

        const resP1 = await fetch(`${baseUrl}/movimientos?limite=1`, { headers: { Cookie: client.cookie } });
        assert.equal(resP1.status, 200);
        const bodyP1 = await resP1.json();
        assert.equal(bodyP1.data.items.length, 1);
        assert.equal(bodyP1.data.items[0].importe, '200.00');
        assert.equal(bodyP1.data.items[0].saldoResultante, '300.00');
        assert.ok(bodyP1.data.siguienteCursor !== null);

        const resP2 = await fetch(`${baseUrl}/movimientos?limite=1&cursor=${bodyP1.data.siguienteCursor}`, {
            headers: { Cookie: client.cookie }
        });
        assert.equal(resP2.status, 200);
        const bodyP2 = await resP2.json();
        assert.equal(bodyP2.data.items.length, 1);
        assert.equal(bodyP2.data.items[0].importe, '100.00');
        assert.equal(bodyP2.data.items[0].saldoResultante, '100.00');
        assert.equal(bodyP2.data.siguienteCursor, null);
    });

    test('5. Vencimientos: Orden ascendente y cálculo de pendiente por imputación FIFO', async () => {
        const client = await createScenarioClient({
            tipo: 'EMPRESA',
            conCuenta: true,
            cuentaHabilitada: true,
            cobertura: 'COMPLETA',
            limiteCredito: '1000.00'
        });

        const ped = await dataSource.query(
            `INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total, moneda_total, evidencia_total_usd)
             VALUES (?, 'PENDIENTE', 'CUENTA_CORRIENTE', 150.00, 0.00, 150.00, 'USD', 'EV_PED_VENC')`,
            [client.idCliente]
        );
        createdPedidoIds.push(ped.insertId);
        await registrarCargoPorPedido({
            id_cuenta_corriente: client.idCuenta,
            id_pedido: ped.insertId,
            monto: '150.00'
        });

        const pago = await dataSource.query(
            `INSERT INTO PAGO (id_cuenta_corriente, id_pedido, fecha, monto, metodo_pago, estado, moneda, evidencia_acreditacion, fecha_acreditacion_utc)
             VALUES (?, NULL, NOW(), 50.00, 'TRANSFERENCIA', 'ACREDITADO', 'USD', 'EV_PAGO_VENC', NOW())`,
            [client.idCuenta]
        );
        createdPagoIds.push(pago.insertId);
        await registrarAbonoPorPago({
            id_cuenta_corriente: client.idCuenta,
            id_pago: pago.insertId,
            monto: '50.00'
        });

        const res = await fetch(`${baseUrl}/vencimientos`, { headers: { Cookie: client.cookie } });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.data.items.length, 1);
        assert.equal(body.data.items[0].pendiente, '100.00');
        assert.equal(body.data.items[0].estado, 'POR_VENCER');
    });

    test('6. Anti-IDOR: Rechazo 400 CONSULTA_INVALIDA ante parámetros manipulados (clienteId)', async () => {
        const client = await createScenarioClient({ tipo: 'PARTICULAR', conCuenta: false });
        const res = await fetch(`${baseUrl}?clienteId=999`, { headers: { Cookie: client.cookie } });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.code, 'CONSULTA_INVALIDA');
    });

    test('7. Control de Rol: Rechazo con 403 Forbidden para rol ADMIN', async () => {
        const timestamp = Date.now() + Math.floor(Math.random() * 1000000);
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

    test('8. Movimientos: Validación de límites, parámetros repetidos y cursores inválidos', async () => {
        const client = await createScenarioClient({ tipo: 'EMPRESA', conCuenta: true });

        // Límite fuera de rango
        const resBadLimit = await fetch(`${baseUrl}/movimientos?limite=150`, { headers: { Cookie: client.cookie } });
        assert.equal(resBadLimit.status, 400);
        assert.equal((await resBadLimit.json()).code, 'CONSULTA_INVALIDA');

        // Límite repetido (?limite=10&limite=20 => array)
        const resRepLimit = await fetch(`${baseUrl}/movimientos?limite=10&limite=20`, { headers: { Cookie: client.cookie } });
        assert.equal(resRepLimit.status, 400);
        assert.equal((await resRepLimit.json()).code, 'CONSULTA_INVALIDA');

        // Cursor corrupto
        const resBadCursor = await fetch(`${baseUrl}/movimientos?cursor=cursor_invalido`, { headers: { Cookie: client.cookie } });
        assert.equal(resBadCursor.status, 400);
        assert.equal((await resBadCursor.json()).code, 'CONSULTA_INVALIDA');

        // Cursor vacío (?cursor=)
        const resEmptyCursor = await fetch(`${baseUrl}/movimientos?cursor=`, { headers: { Cookie: client.cookie } });
        assert.equal(resEmptyCursor.status, 400);
        assert.equal((await resEmptyCursor.json()).code, 'CONSULTA_INVALIDA');

        // Cursor repetido (?cursor=a&cursor=b => array)
        const resRepCursor = await fetch(`${baseUrl}/movimientos?cursor=a&cursor=b`, { headers: { Cookie: client.cookie } });
        assert.equal(resRepCursor.status, 400);
        assert.equal((await resRepCursor.json()).code, 'CONSULTA_INVALIDA');
    });

    test('9. Concurrencia: Retorno 409 Conflict si la revisión de la cuenta cambia', async () => {
        const client = await createScenarioClient({ tipo: 'EMPRESA', conCuenta: true, cobertura: 'COMPLETA' });

        const staleCursor = signCursor({
            userId: client.idUsuario,
            cuentaId: client.idCuenta,
            scope: 'movimientos',
            corte: new Date().toISOString(),
            revision: 'sha256-revision-obsoleta',
            offset: 0
        });

        const res = await fetch(`${baseUrl}/movimientos?cursor=${staleCursor}`, { headers: { Cookie: client.cookie } });
        assert.equal(res.status, 409);
        const body = await res.json();
        assert.equal(body.code, 'CONSULTA_DESACTUALIZADA');
    });
});