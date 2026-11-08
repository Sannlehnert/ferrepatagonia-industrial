// backend/test/cuentaCorriente.test.cjs
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { dataSource, destroyDatabase, inTransaction } = require('../dist/config/database.config.js');
const {
    findCuentaByClienteId,
    calcularEstadoCuenta,
    registrarCargoPorPedido,
    registrarAbonoPorPago
} = require('../dist/repositories/cuentaCorriente.repository.js');

describe('Task #260 — S5-20.1: Modelo y registro de movimientos de cuenta corriente', async () => {
    let idClienteTest;
    let idCuentaTest;
    let idPedidoTest1;
    let idPedidoTest2;
    let idPedidoTest3;
    let idPedidoTest4;
    let idPedidoTest5;
    let idClienteInhabilitado;
    let idCuentaInhabilitada;

    const fixtureEmail = `cc-test-${Date.now()}@example.com`;
    const fixtureEmailInh = `cc-test-inh-${Date.now()}@example.com`;

    before(async () => {
        // H07: Guardia de seguridad que exige base de datos descartable
        const isSafe = /^audit_cc_[a-f0-9]+$/.test(process.env.CUENTA_CORRIENTE_TEST_DATABASE || '') ||
                      process.env.ALLOW_DEV_DB === 'true';
        assert.ok(
            isSafe,
            `Guardia H07: se requiere base descartable (CUENTA_CORRIENTE_TEST_DATABASE="${process.env.CUENTA_CORRIENTE_TEST_DATABASE}"). Ejecute mediante run-cuenta-corriente-mariadb.cjs.`
        );

        if (!dataSource.isInitialized) {
            await dataSource.initialize();
        }

        // 1. Cliente y Cuenta Corriente activa con cobertura COMPLETA y plazo 30
        const clienteRes = await dataSource.query(
            `INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, email, estado_aprobacion_empresa, es_fiel, activo)
             VALUES ('EMPRESA', 'Empresa Test CC', ?, 'APROBADA', 0, 1)`,
            [fixtureEmail]
        );
        idClienteTest = clienteRes.insertId;

        const cuentaRes = await dataSource.query(
            `INSERT INTO CUENTA_CORRIENTE (id_cliente, limite_credito, habilitada, cobertura, plazo_dias, observaciones)
             VALUES (?, 1000.00, 1, 'COMPLETA', 30, 'Cuenta habilitada para pruebas')`,
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

        const ped4 = await dataSource.query(
            `INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total)
             VALUES (?, 'PENDIENTE', 'CUENTA_CORRIENTE', 450.00, 0.00, 450.00)`,
            [idClienteTest]
        );
        idPedidoTest4 = ped4.insertId;

        const ped5 = await dataSource.query(
            `INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total)
             VALUES (?, 'PENDIENTE', 'CUENTA_CORRIENTE', 450.00, 0.00, 450.00)`,
            [idClienteTest]
        );
        idPedidoTest5 = ped5.insertId;

        // 3. Cliente con Cuenta Corriente Inhabilitada
        const cliInh = await dataSource.query(
            `INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, email, estado_aprobacion_empresa, es_fiel, activo)
             VALUES ('EMPRESA', 'Empresa Inhabilitada CC', ?, 'APROBADA', 0, 1)`,
            [fixtureEmailInh]
        );
        idClienteInhabilitado = cliInh.insertId;

        const ctaInh = await dataSource.query(
            `INSERT INTO CUENTA_CORRIENTE (id_cliente, limite_credito, habilitada, cobertura, plazo_dias, observaciones)
             VALUES (?, 500.00, 0, 'COMPLETA', 30, 'Cuenta inhabilitada administrativamente')`,
            [idClienteInhabilitado]
        );
        idCuentaInhabilitada = ctaInh.insertId;
    });

    after(async () => {
        try {
            if (dataSource.isInitialized) {
                await dataSource.query(
                    `DELETE FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_cuenta_corriente IN (?, ?)`,
                    [idCuentaTest, idCuentaInhabilitada]
                );
                await dataSource.query(
                    `DELETE FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente IN (?, ?)`,
                    [idCuentaTest, idCuentaInhabilitada]
                );
                await dataSource.query(
                    `DELETE FROM PAGO WHERE id_cuenta_corriente IN (?, ?)`,
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

    test('3. H03/H04: Imputación de abono con PAGO acreditado reduce deuda y libera disponible', async () => {
        // H03: El abono exige pago acreditado registrado en la tabla PAGO
        const pagoRes = await dataSource.query(
            `INSERT INTO PAGO (id_cuenta_corriente, monto, metodo_pago, estado, observaciones)
             VALUES (?, 150.00, 'TRANSFERENCIA', 'ACREDITADO', 'Pago acreditado en cuenta')`,
            [idCuentaTest]
        );
        const idPago = pagoRes.insertId;

        const idAbono = await registrarAbonoPorPago({
            id_cuenta_corriente: idCuentaTest,
            id_pago: idPago,
            monto: '150.00',
            observaciones: 'Abono recibido'
        });
        assert.ok(idAbono > 0);

        const estado = await calcularEstadoCuenta(idCuentaTest);
        assert.ok(estado);
        assert.equal(estado.total_cargos, '350.00');
        assert.equal(estado.total_abonos, '150.00');
        assert.equal(estado.deuda_vigente, '200.00');
        assert.equal(estado.credito_disponible, '800.00');

        // H04: Comprobar imputación FIFO registrada
        const [imp] = await dataSource.query(
            `SELECT * FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_abono = ?`,
            [idAbono]
        );
        assert.ok(imp, 'Debe existir registro en IMPUTACION_MOVIMIENTO_CUENTA');
        assert.equal(Number(imp.monto_imputado).toFixed(2), '150.00');
        assert.equal(imp.estado, 'VIGENTE');
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
        await assert.rejects(
            registrarCargoPorPedido({
                id_cuenta_corriente: idCuentaTest,
                id_pedido: idPedidoTest1,
                monto: '50.00'
            }),
            /Duplicate entry|uq_movimiento_pedido/
        );
    });

    test('8. Integración transaccional con rollback atómico con externalManager', async () => {
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

                throw new Error('SIMULATED_ORDER_CONFIRMATION_FAILURE');
            }),
            /SIMULATED_ORDER_CONFIRMATION_FAILURE/
        );

        const [movsAfter] = await dataSource.query(
            `SELECT COUNT(*) AS total FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pedido = ?`,
            [idPedidoTest3]
        );
        assert.equal(Number(movsAfter.total), 0);
    });

    test('9. Concurrencia normal: pedidos paralelos que superan el disponible se serializan', async () => {
        const p1 = registrarCargoPorPedido({
            id_cuenta_corriente: idCuentaTest,
            id_pedido: idPedidoTest4,
            monto: '450.00'
        });
        const p2 = registrarCargoPorPedido({
            id_cuenta_corriente: idCuentaTest,
            id_pedido: idPedidoTest5,
            monto: '450.00'
        });

        const results = await Promise.allSettled([p1, p2]);
        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');

        assert.equal(fulfilled.length, 1, 'Exactamente un pedido debe aprobarse');
        assert.equal(rejected.length, 1, 'El segundo pedido debe ser rechazado por sobregiro');
        assert.match(rejected[0].reason.message, /excede el crédito disponible/);

        const estadoFinal = await calcularEstadoCuenta(idCuentaTest);
        assert.ok(Number(estadoFinal.deuda_vigente) <= 1000.00, 'La deuda jamás puede sobregirar el límite');
    });

    test('10. H06: Validación estricta de valores no finitos (NaN, cadenas vacías)', async () => {
        await assert.rejects(
            registrarCargoPorPedido({
                id_cuenta_corriente: idCuentaTest,
                id_pedido: idPedidoTest3,
                monto: 'invalido'
            }),
            /El importe del cargo debe ser un número finito mayor a cero/
        );

        await assert.rejects(
            registrarCargoPorPedido({
                id_cuenta_corriente: idCuentaTest,
                id_pedido: idPedidoTest3,
                monto: NaN
            }),
            /El importe del cargo debe ser un número finito mayor a cero/
        );
    });

    test('11. Integridad DDL MariaDB: rechaza violaciones de restricciones CHECK', async () => {
        await assert.rejects(
            dataSource.query(
                `INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE
                 (id_cuenta_corriente, tipo_movimiento, origen, monto)
                 VALUES (?, 'ABONO', 'PAGO', 0.00)`,
                [idCuentaTest]
            ),
            /chk_movimiento_monto/
        );

        await assert.rejects(
            dataSource.query(
                `INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE
                 (id_cuenta_corriente, tipo_movimiento, origen, monto)
                 VALUES (?, 'INVALIDO', 'PAGO', 10.00)`,
                [idCuentaTest]
            ),
            /chk_movimiento_tipo/
        );

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

    test('12. H01: Cuenta sin cobertura acreditada bloquea consumo y expone saldo null', async () => {
        const fixtureEmail = `cc-nocob-${Date.now()}@test.com`;
        const cliNoCob = await dataSource.query(
            `INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, email, estado_aprobacion_empresa, es_fiel, activo)
             VALUES ('EMPRESA', 'Empresa Sin Cobertura', ?, 'APROBADA', 0, 1)`,
            [fixtureEmail]
        );
        const ctaNoCob = await dataSource.query(
            `INSERT INTO CUENTA_CORRIENTE (id_cliente, limite_credito, habilitada, cobertura, plazo_dias)
             VALUES (?, 1000.00, 1, 'NO_ACREDITADA', 30)`,
            [cliNoCob.insertId]
        );
        const pedNoCob = await dataSource.query(
            `INSERT INTO PEDIDO (id_cliente, total, estado, modalidad_pago, subtotal, descuento)
             VALUES (?, 100.00, 'PENDIENTE', 'CUENTA_CORRIENTE', 100.00, 0.00)`,
            [cliNoCob.insertId]
        );

        try {
            const estado = await calcularEstadoCuenta(ctaNoCob.insertId);
            assert.equal(estado.cobertura, 'NO_ACREDITADA');
            assert.equal(estado.credito_disponible, null);
            assert.equal(estado.estado_credito, 'NO_DETERMINABLE');

            await assert.rejects(
                registrarCargoPorPedido({
                    id_cuenta_corriente: ctaNoCob.insertId,
                    id_pedido: pedNoCob.insertId,
                    monto: '100.00'
                }),
                /no posee cobertura histórica acreditada/
            );
        } finally {
            await dataSource.query('DELETE FROM PEDIDO WHERE id_pedido = ?', [pedNoCob.insertId]);
            await dataSource.query('DELETE FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?', [ctaNoCob.insertId]);
            await dataSource.query('DELETE FROM CLIENTE WHERE id_cliente = ?', [cliNoCob.insertId]);
        }
    });

    test('13. H03: Titularidad protegida rechaza asociar pedido de cliente ajeno', async () => {
        const fixtureEmail = `cc-ajeno-${Date.now()}@test.com`;
        const cliAjeno = await dataSource.query(
            `INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, email, estado_aprobacion_empresa, es_fiel, activo)
             VALUES ('EMPRESA', 'Empresa Ajena', ?, 'APROBADA', 0, 1)`,
            [fixtureEmail]
        );
        const pedAjeno = await dataSource.query(
            `INSERT INTO PEDIDO (id_cliente, total, estado, modalidad_pago, subtotal, descuento)
             VALUES (?, 100.00, 'PENDIENTE', 'CUENTA_CORRIENTE', 100.00, 0.00)`,
            [cliAjeno.insertId]
        );

        try {
            await assert.rejects(
                registrarCargoPorPedido({
                    id_cuenta_corriente: idCuentaTest,
                    id_pedido: pedAjeno.insertId,
                    monto: '100.00'
                }),
                /Violación de titularidad/
            );
        } finally {
            await dataSource.query('DELETE FROM PEDIDO WHERE id_pedido = ?', [pedAjeno.insertId]);
            await dataSource.query('DELETE FROM CLIENTE WHERE id_cliente = ?', [cliAjeno.insertId]);
        }
    });

    test('14. H08: externalManager con snapshot previo en REPEATABLE READ impide sobregiro', async () => {
        const fixtureEmail = `cc-h08-${Date.now()}@test.com`;
        const cliH08 = await dataSource.query(
            `INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, email, estado_aprobacion_empresa, es_fiel, activo)
             VALUES ('EMPRESA', 'Empresa H08 Regresion', ?, 'APROBADA', 0, 1)`,
            [fixtureEmail]
        );
        const ctaH08 = await dataSource.query(
            `INSERT INTO CUENTA_CORRIENTE (id_cliente, limite_credito, habilitada, cobertura, plazo_dias)
             VALUES (?, 1000.00, 1, 'COMPLETA', 30)`,
            [cliH08.insertId]
        );
        const pedA = await dataSource.query(
            `INSERT INTO PEDIDO (id_cliente, total, estado, modalidad_pago, subtotal, descuento)
             VALUES (?, 700.00, 'PENDIENTE', 'CUENTA_CORRIENTE', 700.00, 0.00)`,
            [cliH08.insertId]
        );
        const pedB = await dataSource.query(
            `INSERT INTO PEDIDO (id_cliente, total, estado, modalidad_pago, subtotal, descuento)
             VALUES (?, 700.00, 'PENDIENTE', 'CUENTA_CORRIENTE', 700.00, 0.00)`,
            [cliH08.insertId]
        );

        const runnerA = dataSource.createQueryRunner();
        const runnerB = dataSource.createQueryRunner();
        await runnerA.connect();
        await runnerB.connect();

        try {
            // 1. Transacción A abre en REPEATABLE READ y consulta el estado (fija snapshot de deuda 0)
            await runnerA.startTransaction('REPEATABLE READ');
            const estadoAInicial = await calcularEstadoCuenta(ctaH08.insertId, runnerA.manager);
            assert.equal(estadoAInicial.credito_disponible, '1000.00');

            // 2. Transacción B registra cargo de 700 y confirma
            await runnerB.startTransaction('REPEATABLE READ');
            await registrarCargoPorPedido(
                {
                    id_cuenta_corriente: ctaH08.insertId,
                    id_pedido: pedB.insertId,
                    monto: '700.00'
                },
                runnerB.manager
            );
            await runnerB.commitTransaction();

            // 3. Transacción A intenta registrar otros 700 con su externalManager
            // El current read bloqueante de H08 lee deuda vigente 700 y disponible 300, rechazando el sobregiro
            await assert.rejects(
                registrarCargoPorPedido(
                    {
                        id_cuenta_corriente: ctaH08.insertId,
                        id_pedido: pedA.insertId,
                        monto: '700.00'
                    },
                    runnerA.manager
                ),
                /excede el crédito disponible/
            );

            await runnerA.rollbackTransaction();

            // 4. Saldo final comprobado: deuda 700.00, disponible 300.00 (jamás 1400.00)
            const estadoFinal = await calcularEstadoCuenta(ctaH08.insertId);
            assert.equal(estadoFinal.deuda_vigente, '700.00');
            assert.equal(estadoFinal.credito_disponible, '300.00');
        } finally {
            await runnerA.release();
            await runnerB.release();
            await dataSource.query('DELETE FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?', [ctaH08.insertId]);
            await dataSource.query('DELETE FROM PEDIDO WHERE id_pedido IN (?, ?)', [pedA.insertId, pedB.insertId]);
            await dataSource.query('DELETE FROM CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?', [ctaH08.insertId]);
            await dataSource.query('DELETE FROM CLIENTE WHERE id_cliente = ?', [cliH08.insertId]);
        }
    });
});