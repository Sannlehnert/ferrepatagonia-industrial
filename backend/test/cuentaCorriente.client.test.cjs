const assert = require('node:assert/strict');
const { describe, test, before, after } = require('node:test');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');

const { childProfile, connectOwned } = require('./helpers/cc260-disposable.cjs');

async function assertOwnershipGuardBeforeConnect() {
    assert.equal(process.env.NODE_ENV, 'test', 'Guardia H05: NODE_ENV debe ser test');
    const runner = process.env.CC251_TEST_PROFILE === undefined ? 260 : 251;
    const profile = childProfile(runner);
    const session = await connectOwned(profile, runner);
    await session.connection.end();
    return profile;
}

describe('Task #251 — API de cuenta corriente para cliente', () => {
    let server;
    let baseUrl;
    let db, dataSource, env, signCursor, registrarCargoPorPedido, registrarAbonoPorPago;

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
        clienteActivo = 1,
        usuarioActivo = 1,
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
             VALUES (?, ?, ?, ?, 0, ?)`,
            [
                tipo,
                `Cliente ${timestamp}`,
                tipo === 'EMPRESA' ? `30${String(timestamp).slice(-8)}1` : null,
                tipo === 'EMPRESA' ? empresaAprobada : null,
                clienteActivo
            ]
        );
        const idCliente = Number(clienteRes.insertId);
        createdClienteIds.push(idCliente);

        const userRes = await dataSource.query(
            `INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo)
             VALUES (?, ?, 'hash_dummy', 'CLIENTE', ?)`,
            [idCliente, email, usuarioActivo]
        );
        const idUsuario = Number(userRes.insertId);
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
            idCuenta = Number(cuentaRes.insertId);
            createdCuentaIds.push(idCuenta);
        }

        const token = signTestToken({ id: idUsuario, rol: 'CLIENTE' });
        const cookie = `jwt_token=${token}; auth_token=${token}`;

        return { idUsuario, idCliente, idCuenta, cookie };
    }

    before(async () => {
        const profile = await assertOwnershipGuardBeforeConnect();
        db = require('../dist/config/database.config');
        dataSource = db.dataSource;
        const { host, port, database, username, password } = dataSource.options;
        assert.ok(host === profile.host && port === profile.port && database === profile.database &&
            username === 'root' && password === profile.password, 'Guardia H05: DataSource no coincide con el perfil');

        const { app } = require('../dist/app');
        ({ env } = require('../dist/config/env.config'));
        ({ signCursor } = require('../dist/services/cuentaCorriente.service'));
        ({ registrarCargoPorPedido, registrarAbonoPorPago } = require('../dist/repositories/cuentaCorriente.repository'));

        if (!dataSource.isInitialized) {
            await dataSource.initialize();
        }

        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        baseUrl = `http://127.0.0.1:${server.address().port}/api/cuenta-corriente`;
    });

    after(async () => {
        try {
            if (dataSource && dataSource.isInitialized) {
                // 1. Imputaciones y movimientos
                if (createdCuentaIds.length > 0) {
                    const placeholders = createdCuentaIds.map(() => '?').join(',');
                    await dataSource.query(
                        `DELETE FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_cuenta_corriente IN (${placeholders})`,
                        createdCuentaIds
                    );
                    await dataSource.query(
                        `DELETE FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente IN (${placeholders})`,
                        createdCuentaIds
                    );
                }

                // 2. Pagos (deben borrarse ANTES de CUENTA_CORRIENTE por fk_pago_cuenta)
                if (createdCuentaIds.length > 0) {
                    const placeholders = createdCuentaIds.map(() => '?').join(',');
                    await dataSource.query(
                        `DELETE FROM PAGO WHERE id_cuenta_corriente IN (${placeholders})`,
                        createdCuentaIds
                    );
                }
                if (createdPagoIds.length > 0) {
                    const placeholders = createdPagoIds.map(() => '?').join(',');
                    await dataSource.query(
                        `DELETE FROM PAGO WHERE id_pago IN (${placeholders})`,
                        createdPagoIds
                    );
                }

                // 3. Pedidos
                if (createdClienteIds.length > 0) {
                    const placeholders = createdClienteIds.map(() => '?').join(',');
                    await dataSource.query(
                        `DELETE FROM PEDIDO WHERE id_cliente IN (${placeholders})`,
                        createdClienteIds
                    );
                }
                if (createdPedidoIds.length > 0) {
                    const placeholders = createdPedidoIds.map(() => '?').join(',');
                    await dataSource.query(
                        `DELETE FROM PEDIDO WHERE id_pedido IN (${placeholders})`,
                        createdPedidoIds
                    );
                }

                // 4. Cuentas corrientes
                if (createdCuentaIds.length > 0) {
                    const placeholders = createdCuentaIds.map(() => '?').join(',');
                    await dataSource.query(
                        `DELETE FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente IN (${placeholders})`,
                        createdCuentaIds
                    );
                }

                // 5. Usuarios
                if (createdUserIds.length > 0) {
                    const placeholders = createdUserIds.map(() => '?').join(',');
                    await dataSource.query(
                        `DELETE FROM USUARIO WHERE id_usuario IN (${placeholders})`,
                        createdUserIds
                    );
                }

                // 6. Clientes y validación de residuo cero
                if (createdClienteIds.length > 0) {
                    const placeholders = createdClienteIds.map(() => '?').join(',');
                    await dataSource.query(
                        `DELETE FROM CLIENTE WHERE id_cliente IN (${placeholders})`,
                        createdClienteIds
                    );
                    const [rem] = await dataSource.query(
                        `SELECT COUNT(*) AS cnt FROM CLIENTE WHERE id_cliente IN (${placeholders})`,
                        createdClienteIds
                    );
                    assert.equal(Number(rem.cnt), 0, 'Fallo de limpieza: quedaron clientes residuales.');
                }
            }
        } finally {
            if (server) {
                await new Promise((resolve) => {
                    server.close(resolve);
                    if (typeof server.closeAllConnections === 'function') {
                        server.closeAllConnections();
                    }
                });
            }
            if (typeof db?.destroyDatabase === 'function') {
                await db.destroyDatabase();
            } else if (dataSource && dataSource.isInitialized) {
                await dataSource.destroy();
            }
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
        const idPedido = Number(pedRes.insertId);
        createdPedidoIds.push(idPedido);

        await registrarCargoPorPedido({
            id_cuenta_corriente: client.idCuenta,
            id_pedido: idPedido,
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

    test('4. Movimientos (H04): Paginación por clave sin offset, orden descendente y saldoResultante acumulado', async () => {
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
        createdPedidoIds.push(Number(p1.insertId));
        await registrarCargoPorPedido({
            id_cuenta_corriente: client.idCuenta,
            id_pedido: Number(p1.insertId),
            monto: '100.00'
        });

        const p2 = await dataSource.query(
            `INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total, moneda_total, evidencia_total_usd)
             VALUES (?, 'PENDIENTE', 'CUENTA_CORRIENTE', 200.00, 0.00, 200.00, 'USD', 'EV_P2')`,
            [client.idCliente]
        );
        createdPedidoIds.push(Number(p2.insertId));
        await registrarCargoPorPedido({
            id_cuenta_corriente: client.idCuenta,
            id_pedido: Number(p2.insertId),
            monto: '200.00'
        });

        const resP1 = await fetch(`${baseUrl}/movimientos?limite=1`, { headers: { Cookie: client.cookie } });
        assert.equal(resP1.status, 200);
        const bodyP1 = await resP1.json();
        assert.equal(bodyP1.data.items.length, 1);
        assert.equal(bodyP1.data.items[0].importe, '200.00');
        assert.equal(bodyP1.data.items[0].saldoResultante, '300.00');
        assert.ok(bodyP1.data.siguienteCursor !== null);

        const rawPayload = JSON.parse(
            Buffer.from(bodyP1.data.siguienteCursor.split('.')[0], 'base64url').toString('utf8')
        );
        assert.equal('offset' in rawPayload, false);
        assert.ok(rawPayload.ultimaClave);
        assert.equal(rawPayload.ultimaClave.id, Number(bodyP1.data.items[0].id));
        assert.equal(rawPayload.ultimaClave.fechaOperacion, bodyP1.data.items[0].fechaOperacion);

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

    test('5. Vencimientos (H04): Orden ascendente, imputación FIFO y paginación por clave sin offset', async () => {
        const client = await createScenarioClient({
            tipo: 'EMPRESA',
            conCuenta: true,
            cuentaHabilitada: true,
            cobertura: 'COMPLETA',
            limiteCredito: '1000.00',
            plazoDias: 30
        });

        const ped1 = await dataSource.query(
            `INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total, moneda_total, evidencia_total_usd)
             VALUES (?, 'PENDIENTE', 'CUENTA_CORRIENTE', 150.00, 0.00, 150.00, 'USD', 'EV_PED_VENC1')`,
            [client.idCliente]
        );
        createdPedidoIds.push(Number(ped1.insertId));
        await registrarCargoPorPedido({
            id_cuenta_corriente: client.idCuenta,
            id_pedido: Number(ped1.insertId),
            monto: '150.00',
            dias_vencimiento: 30
        });

        const ped2 = await dataSource.query(
            `INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total, moneda_total, evidencia_total_usd)
             VALUES (?, 'PENDIENTE', 'CUENTA_CORRIENTE', 80.00, 0.00, 80.00, 'USD', 'EV_PED_VENC2')`,
            [client.idCliente]
        );
        createdPedidoIds.push(Number(ped2.insertId));
        await registrarCargoPorPedido({
            id_cuenta_corriente: client.idCuenta,
            id_pedido: Number(ped2.insertId),
            monto: '80.00',
            dias_vencimiento: 30
        });

        const pago = await dataSource.query(
            `INSERT INTO PAGO (id_cuenta_corriente, id_pedido, fecha, monto, metodo_pago, estado, moneda, evidencia_acreditacion, fecha_acreditacion_utc)
             VALUES (?, NULL, NOW(), 50.00, 'TRANSFERENCIA', 'ACREDITADO', 'USD', 'EV_PAGO_VENC', NOW())`,
            [client.idCuenta]
        );
        createdPagoIds.push(Number(pago.insertId));
        await registrarAbonoPorPago({
            id_cuenta_corriente: client.idCuenta,
            id_pago: Number(pago.insertId),
            monto: '50.00'
        });

        const resV1 = await fetch(`${baseUrl}/vencimientos?limite=1`, { headers: { Cookie: client.cookie } });
        assert.equal(resV1.status, 200);
        const bodyV1 = await resV1.json();
        assert.equal(bodyV1.data.items.length, 1);
        assert.equal(bodyV1.data.items[0].pendiente, '100.00');
        assert.equal(bodyV1.data.items[0].estado, 'POR_VENCER');
        assert.ok(bodyV1.data.siguienteCursor !== null);

        const decodedVencCursor = JSON.parse(
            Buffer.from(bodyV1.data.siguienteCursor.split('.')[0], 'base64url').toString('utf8')
        );
        assert.equal('offset' in decodedVencCursor, false);
        assert.equal(decodedVencCursor.ultimaClave.venceEl, bodyV1.data.items[0].venceEl);
        assert.equal(decodedVencCursor.ultimaClave.id, Number(bodyV1.data.items[0].movimientoId));

        const resV2 = await fetch(`${baseUrl}/vencimientos?limite=1&cursor=${bodyV1.data.siguienteCursor}`, {
            headers: { Cookie: client.cookie }
        });
        assert.equal(resV2.status, 200);
        const bodyV2 = await resV2.json();
        assert.equal(bodyV2.data.items.length, 1);
        assert.equal(bodyV2.data.items[0].pendiente, '80.00');
        assert.equal(bodyV2.data.siguienteCursor, null);
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
        const idAdmin = Number(adminRes.insertId);
        createdUserIds.push(idAdmin);

        const adminToken = signTestToken({ id: idAdmin, rol: 'ADMIN' });
        const res = await fetch(baseUrl, { headers: { Cookie: `jwt_token=${adminToken}; auth_token=${adminToken}` } });
        assert.equal(res.status, 403);
        assert.equal(res.headers.get('cache-control'), 'private, no-store');
    });

    test('8. Movimientos: Validación de límites, parámetros repetidos y cursores inválidos', async () => {
        const client = await createScenarioClient({ tipo: 'EMPRESA', conCuenta: true });

        const resBadLimit = await fetch(`${baseUrl}/movimientos?limite=150`, { headers: { Cookie: client.cookie } });
        assert.equal(resBadLimit.status, 400);
        assert.equal((await resBadLimit.json()).code, 'CONSULTA_INVALIDA');

        const resRepLimit = await fetch(`${baseUrl}/movimientos?limite=10&limite=20`, { headers: { Cookie: client.cookie } });
        assert.equal(resRepLimit.status, 400);
        assert.equal((await resRepLimit.json()).code, 'CONSULTA_INVALIDA');

        const resBadCursor = await fetch(`${baseUrl}/movimientos?cursor=cursor_invalido`, { headers: { Cookie: client.cookie } });
        assert.equal(resBadCursor.status, 400);
        assert.equal((await resBadCursor.json()).code, 'CONSULTA_INVALIDA');

        const resEmptyCursor = await fetch(`${baseUrl}/movimientos?cursor=`, { headers: { Cookie: client.cookie } });
        assert.equal(resEmptyCursor.status, 400);
        assert.equal((await resEmptyCursor.json()).code, 'CONSULTA_INVALIDA');

        const resRepCursor = await fetch(`${baseUrl}/movimientos?cursor=a&cursor=b`, { headers: { Cookie: client.cookie } });
        assert.equal(resRepCursor.status, 400);
        assert.equal((await resRepCursor.json()).code, 'CONSULTA_INVALIDA');
    });

    test('9. Concurrencia: Retorno 409 Conflict si la revisión de la cuenta cambia', async () => {
        const client = await createScenarioClient({ tipo: 'EMPRESA', conCuenta: true, cobertura: 'COMPLETA' });
        const nowIso = new Date().toISOString();

        const staleCursor = signCursor({
            userId: client.idUsuario,
            rol: 'CLIENTE',
            cuentaId: client.idCuenta,
            scope: 'movimientos',
            filtros: {},
            corte: nowIso,
            revision: 'sha256-revision-obsoleta',
            exp: Date.now() + 3600000,
            ultimaClave: {
                fechaEfectiva: nowIso,
                fechaOperacion: nowIso,
                id: 1
            }
        });

        const res = await fetch(`${baseUrl}/movimientos?cursor=${staleCursor}`, { headers: { Cookie: client.cookie } });
        assert.equal(res.status, 409);
        const body = await res.json();
        assert.equal(body.code, 'CONSULTA_DESACTUALIZADA');
    });

    test('10. Regresión H01: Observaciones internas del libro jamás se exponen en concepto', async () => {
        const client = await createScenarioClient({
            tipo: 'EMPRESA',
            conCuenta: true,
            cuentaHabilitada: true,
            cobertura: 'COMPLETA',
            limiteCredito: '1000.00'
        });

        const ped = await dataSource.query(
            `INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total, moneda_total, evidencia_total_usd)
             VALUES (?, 'PENDIENTE', 'CUENTA_CORRIENTE', 95.00, 0.00, 95.00, 'USD', 'EV_H01')`,
            [client.idCliente]
        );
        const pedidoId = Number(ped.insertId);
        createdPedidoIds.push(pedidoId);

        const notaSecreta = 'INTERNO_AUDIT79: riesgo crediticio, verificación privada';
        await registrarCargoPorPedido({
            id_cuenta_corriente: client.idCuenta,
            id_pedido: pedidoId,
            monto: '95.00',
            observaciones: notaSecreta
        });

        const res = await fetch(`${baseUrl}/movimientos`, { headers: { Cookie: client.cookie } });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.data.items.length, 1);
        assert.equal(body.data.items[0].concepto, `Pedido #${pedidoId}`);
        assert.equal(JSON.stringify(body).includes('INTERNO_AUDIT79'), false);
    });

    test('11. Regresión H02: CLIENTE inactivo con sesión válida recibe 403 en los tres endpoints', async () => {
        const client = await createScenarioClient({
            tipo: 'EMPRESA',
            clienteActivo: 0,
            usuarioActivo: 1,
            conCuenta: true
        });

        for (const suffix of ['', '/movimientos', '/vencimientos']) {
            const res = await fetch(`${baseUrl}${suffix}`, { headers: { Cookie: client.cookie } });
            assert.equal(res.status, 403, `Se esperaba 403 en ${suffix || '/'}`);
            assert.equal(res.headers.get('cache-control'), 'private, no-store');
            const body = await res.json();
            assert.notEqual(body?.data?.estado, 'SIN_CUENTA');
        }
    });

    test('12. Regresión H03: PARTICULAR con fila asociada en CUENTA_CORRIENTE recibe 200 SIN_CUENTA', async () => {
        const client = await createScenarioClient({
            tipo: 'PARTICULAR',
            conCuenta: true,
            cuentaHabilitada: true,
            limiteCredito: '1000.00',
            cobertura: 'COMPLETA'
        });

        for (const suffix of ['', '/movimientos', '/vencimientos']) {
            const res = await fetch(`${baseUrl}${suffix}`, { headers: { Cookie: client.cookie } });
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.data.estado, 'SIN_CUENTA');
            assert.equal('limite' in body.data, false);
            assert.equal('saldo' in body.data, false);
            assert.equal('cuentaId' in body.data, false);
        }
    });

    test('13. Regresión H03b: EMPRESA con aprobación cambiada o cuenta inhabilitada conserva lectura histórica con disponible 0.00', async () => {
        const client = await createScenarioClient({
            tipo: 'EMPRESA',
            empresaAprobada: 'RECHAZADA',
            conCuenta: true,
            cuentaHabilitada: false,
            limiteCredito: '1000.00',
            cobertura: 'COMPLETA'
        });

        const res = await fetch(baseUrl, { headers: { Cookie: client.cookie } });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.data.estado, 'INHABILITADA');
        assert.equal(body.data.disponible, '0.00');
        assert.equal(body.data.estadoCredito, 'BLOQUEADO');
    });

    test('14. Observación O01: Cursor expirado devuelve 409 CONSULTA_DESACTUALIZADA', async () => {
        const client = await createScenarioClient({
            tipo: 'EMPRESA',
            conCuenta: true,
            cobertura: 'COMPLETA'
        });

        const resSummary = await fetch(baseUrl, { headers: { Cookie: client.cookie } });
        const summaryBody = await resSummary.json();
        const pastIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

        const expiredCursor = signCursor({
            userId: client.idUsuario,
            rol: 'CLIENTE',
            cuentaId: client.idCuenta,
            scope: 'movimientos',
            filtros: {},
            corte: pastIso,
            revision: summaryBody.data.revision,
            exp: Date.parse(pastIso) + 24 * 60 * 60 * 1000,
            ultimaClave: {
                fechaEfectiva: pastIso,
                fechaOperacion: pastIso,
                id: 999999
            }
        });

        const res = await fetch(`${baseUrl}/movimientos?cursor=${expiredCursor}`, {
            headers: { Cookie: client.cookie }
        });
        assert.equal(res.status, 409);
        const body = await res.json();
        assert.equal(body.code, 'CONSULTA_DESACTUALIZADA');
    });
});