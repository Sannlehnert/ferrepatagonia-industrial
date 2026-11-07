const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { dataSource, destroyDatabase, inTransaction } = require('../dist/config/database.config.js');
const {
    findCuentaByClienteId,
    calcularEstadoCuenta,
    registrarCargoPorPedido
} = require('../dist/repositories/cuentaCorriente.repository.js');

describe('Task #260 — S5-20.1: Modelo y registro de movimientos de cuenta corriente', async () => {
    let idClienteTest;
    let idCuentaTest;
    let idPedidoTest1;
    let idPedidoTest2;
    let idPedidoTest3;
    let idClienteInhabilitado;
    let idCuentaInhabilitada;

    const fixtureEmail = `cc-test-${Date.now()}@example.com`;
    const fixtureEmailInh = `cc-test-inh-${Date.now()}@example.com`;

    before(async () => {
        if (!dataSource.isInitialized) {
            await dataSource.initialize();
        }

        // 1. Cliente y Cuenta Corriente activa (Límite: $1000.00)
        const clienteRes = await dataSource.query(
            `INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, email, estado_aprobacion_empresa, es_fiel, activo)
             VALUES ('EMPRESA', 'Empresa Test CC', ?, 'APROBADA', 0, 1)`,
            [fixtureEmail]
        );
        idClienteTest = clienteRes.insertId;

        const cuentaRes = await dataSource.query(
            `INSERT INTO CUENTA_CORRIENTE (id_cliente, limite_credito, habilitada, observaciones)
             VALUES (?, 1000.00, 1, 'Cuenta habilitada para pruebas')`,
            [idClienteTest]
        );
        idCuentaTest = cuentaRes.insertId;

        // 2. Pedidos asociados al cliente para consumos
        const ped1 = await dataSource.query(
            `INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total)
             VALUES (?, 'PENDIENTE', 'CUENTA_CORRIENTE', 350.00, 0.00, 350.00)`,
            [idClienteTest]
        );
        idPedidoTest1 = ped1.insertId;

        const ped2 = await dataSource.query(
            `INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total)
             VALUES (?, 'PENDIENTE', 'CUENTA_CORRIENTE', 200.00, 0.00, 200.00)`,
            [idClienteTest]
        );
        idPedidoTest2 = ped2.insertId;

        const ped3 = await dataSource.query(
            `INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total)
             VALUES (?, 'PENDIENTE', 'CUENTA_CORRIENTE', 500.00, 0.00, 500.00)`,
            [idClienteTest]
        );
        idPedidoTest3 = ped3.insertId;

        // 3. Cliente con Cuenta Corriente Inhabilitada
        const cliInh = await dataSource.query(
            `INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, email, estado_aprobacion_empresa, es_fiel, activo)
             VALUES ('EMPRESA', 'Empresa Inhabilitada CC', ?, 'APROBADA', 0, 1)`,
            [fixtureEmailInh]
        );
        idClienteInhabilitado = cliInh.insertId;

        const ctaInh = await dataSource.query(
            `INSERT INTO CUENTA_CORRIENTE (id_cliente, limite_credito, habilitada, observaciones)
             VALUES (?, 500.00, 0, 'Cuenta inhabilitada administrativamente')`,
            [idClienteInhabilitado]
        );
        idCuentaInhabilitada = ctaInh.insertId;
    });

    after(async () => {
        try {
            if (dataSource.isInitialized) {
                await dataSource.query(
                    `DELETE FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente IN (?, ?)`,
                    [idCuentaTest, idCuentaInhabilitada]
                );
                await dataSource.query(
                    `DELETE FROM PEDIDO WHERE id_cliente IN (?, ?)`,
                    [idClienteTest, idClienteInhabilitado]
                );
                await dataSource.query(
                    `DELETE FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente IN (?, ?)`,
                    [idCuentaTest, idCuentaInhabilitada]
                );
                await dataSource.query(
                    `DELETE FROM CLIENTE WHERE id_cliente IN (?, ?)`,
                    [idClienteTest, idClienteInhabilitado]
                );
            }
        } finally {
            await destroyDatabase();
        }
    });

    test('1. Estado inicial: saldo en cero y disponible equivalente al límite total', async () => {
        const cuenta = await findCuentaByClienteId(idClienteTest);
        assert.ok(cuenta);
        assert.equal(cuenta.id_cuenta_corriente, idCuentaTest);

        const estado = await calcularEstadoCuenta(idCuentaTest);
        assert.ok(estado);
        assert.equal(estado.habilitada, true);
        assert.equal(estado.limite_credito, '1000.00');
        assert.equal(estado.total_cargos, '0.00');
        assert.equal(estado.total_abonos, '0.00');
        assert.equal(estado.deuda_vigente, '0.00');
        assert.equal(estado.credito_disponible, '1000.00');
    });

    test('2. Registro de cargo por pedido: descuenta disponible y vincula trazabilidad', async () => {
        const idMov = await registrarCargoPorPedido({
            id_cuenta_corriente: idCuentaTest,
            id_pedido: idPedidoTest1,
            monto: '350.00',
            dias_vencimiento: 30,
            observaciones: 'Cargo por pedido #1'
        });
        assert.ok(idMov > 0);

        const estado = await calcularEstadoCuenta(idCuentaTest);
        assert.ok(estado);
        assert.equal(estado.total_cargos, '350.00');
        assert.equal(estado.total_abonos, '0.00');
        assert.equal(estado.deuda_vigente, '350.00');
        assert.equal(estado.credito_disponible, '650.00');

        const [mov] = await dataSource.query(
            `SELECT * FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_movimiento_cuenta = ?`,
            [idMov]
        );
        assert.equal(mov.tipo_movimiento, 'CARGO');
        assert.equal(mov.origen, 'PEDIDO');
        assert.equal(mov.id_pedido, idPedidoTest1);
        assert.equal(mov.id_pago, null);
        assert.equal(Number(mov.monto).toFixed(2), '350.00');
        assert.equal(mov.estado, 'ACREDITADO');
        assert.ok(mov.fecha_vencimiento !== null);
    });

    test('3. Imputación de abono: reduce la deuda vigente y libera crédito disponible', async () => {
        await dataSource.query(
            `INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE 
             (id_cuenta_corriente, tipo_movimiento, origen, id_pedido, id_pago, monto, moneda, estado, observaciones)
             VALUES (?, 'ABONO', 'PAGO', NULL, NULL, 150.00, 'USD', 'ACREDITADO', 'Abono recibido')`,
            [idCuentaTest]
        );

        const estado = await calcularEstadoCuenta(idCuentaTest);
        assert.ok(estado);
        assert.equal(estado.total_cargos, '350.00');
        assert.equal(estado.total_abonos, '150.00');
        assert.equal(estado.deuda_vigente, '200.00');
        assert.equal(estado.credito_disponible, '800.00');
    });

    test('4. Movimientos anulados: conservan trazabilidad sin alterar balance', async () => {
        await dataSource.query(
            `INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE 
             (id_cuenta_corriente, tipo_movimiento, origen, id_pedido, id_pago, monto, moneda, estado, motivo_invalidacion)
             VALUES (?, 'CARGO', 'PEDIDO', ?, NULL, 200.00, 'USD', 'ANULADO', 'Pedido cancelado por admin')`,
            [idCuentaTest, idPedidoTest2]
        );

        const estado = await calcularEstadoCuenta(idCuentaTest);
        assert.ok(estado);
        // Sigue calculando sobre 350 - 150 = 200, el cargo anulado se ignora en la suma
        assert.equal(estado.deuda_vigente, '200.00');
        assert.equal(estado.credito_disponible, '800.00');
    });

    test('5. Cuenta inhabilitada: deuda real visible pero crédito disponible bloqueado en 0.00', async () => {
        const estado = await calcularEstadoCuenta(idCuentaInhabilitada);
        assert.ok(estado);
        assert.equal(estado.habilitada, false);
        assert.equal(estado.limite_credito, '500.00');
        assert.equal(estado.credito_disponible, '0.00');

        await assert.rejects(
            registrarCargoPorPedido({
                id_cuenta_corriente: idCuentaInhabilitada,
                id_pedido: idPedidoTest3,
                monto: '100.00'
            }),
            /La cuenta corriente no se encuentra habilitada/
        );
    });

    test('6. Control de crédito: rechaza cargo si el importe supera el disponible', async () => {
        // Disponible actual: 800.00. Intento de consumo: 850.00
        await assert.rejects(
            registrarCargoPorPedido({
                id_cuenta_corriente: idCuentaTest,
                id_pedido: idPedidoTest3,
                monto: '850.00'
            }),
            /El monto del pedido excede el crédito disponible/
        );
    });

    test('7. Garantía antiduplicidad: imposibilita registrar dos cargos para el mismo pedido', async () => {
        // idPedidoTest1 ya fue registrado en el test #2
        await assert.rejects(
            registrarCargoPorPedido({
                id_cuenta_corriente: idCuentaTest,
                id_pedido: idPedidoTest1,
                monto: '50.00'
            }),
            /Duplicate entry|uq_movimiento_pedido/
        );
    });

    test('8. Integración transaccional con #20.2: soporte para rollback atómico con externalManager', async () => {
        const [movsBefore] = await dataSource.query(
            `SELECT COUNT(*) AS total FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pedido = ?`,
            [idPedidoTest3]
        );
        assert.equal(Number(movsBefore.total), 0);

        await assert.rejects(
            inTransaction(async (manager) => {
                await registrarCargoPorPedido(
                    {
                        id_cuenta_corriente: idCuentaTest,
                        id_pedido: idPedidoTest3,
                        monto: '200.00'
                    },
                    manager
                );

                // Simulamos fallo posterior de confirmación de pedido
                throw new Error('SIMULATED_ORDER_CONFIRMATION_FAILURE');
            }),
            /SIMULATED_ORDER_CONFIRMATION_FAILURE/
        );

        // El movimiento se revirtió por completo
        const [movsAfter] = await dataSource.query(
            `SELECT COUNT(*) AS total FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pedido = ?`,
            [idPedidoTest3]
        );
        assert.equal(Number(movsAfter.total), 0);
    });

    test('9. Integridad DDL MariaDB: rechaza violaciones de restricciones CHECK', async () => {
        // chk_movimiento_monto (monto > 0)
        await assert.rejects(
            dataSource.query(
                `INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE 
                 (id_cuenta_corriente, tipo_movimiento, origen, monto)
                 VALUES (?, 'ABONO', 'PAGO', 0.00)`,
                [idCuentaTest]
            ),
            /chk_movimiento_monto/
        );

        // chk_movimiento_tipo (CARGO | ABONO)
        await assert.rejects(
            dataSource.query(
                `INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE 
                 (id_cuenta_corriente, tipo_movimiento, origen, monto)
                 VALUES (?, 'INVALIDO', 'PAGO', 10.00)`,
                [idCuentaTest]
            ),
            /chk_movimiento_tipo/
        );

        // chk_movimiento_referencia (CARGO exige id_pedido NOT NULL y id_pago NULL)
        await assert.rejects(
            dataSource.query(
                `INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE 
                 (id_cuenta_corriente, tipo_movimiento, origen, id_pedido, monto)
                 VALUES (?, 'CARGO', 'PEDIDO', NULL, 10.00)`,
                [idCuentaTest]
            ),
            /chk_movimiento_referencia/
        );
    });
});