const assert = require('node:assert/strict');
const { mock } = require('node:test');
const { assertOwned, assertDatabaseOptions } = require('../../backend/test/helpers/account-disposable.cjs');

const opened = '2023-01-01 00:00:00';
const cut = '2026-03-03T03:00:00.000Z';
const password = 'Fer19-DEMO-only!';
const scenarios = [
  ['particular', null, null],
  ['empresa-sin-cuenta', null, null],
  ['empresa30', '1000.00', 30],
  ['empresa60', '2000.00', 60],
  ['inhabilitada', '500.00', 30],
  ['vacia', '300.00', 30],
  ['incompleta', '700.00', 30, 'NO_ACREDITADA'],
  ['parcial', '700.00', 30],
  ['favor', '100.00', 30],
  ['cero', '0.00', 30],
  ['pendiente', '400.00', 30],
  ['usuario-inactivo', '400.00', 30],
  ['cliente-inactivo', '400.00', 30],
];
const tables = [
  'IMPUTACION_MOVIMIENTO_CUENTA', 'MOVIMIENTO_CUENTA_CORRIENTE', 'FER17_COTIZACION_VERIFICACION',
  'FER17_CALENDARIO', 'COTIZACION', 'PAGO', 'PEDIDO', 'CUENTA_CORRIENTE', 'USUARIO', 'CLIENTE',
];
const sqlTime = instant => instant.replace('T', ' ').replace('Z', '');
const id = result => Number(result.insertId);

async function clearDemo(session) {
  await assertOwned(session);
  const db = session.connection;
  await db.beginTransaction();
  try {
    for (const table of tables) await db.query('DELETE FROM ' + table);
    await db.commit();
  } catch (error) {
    await db.rollback();
    throw error;
  }
}

async function demoOrder(db, client, amount, instant = new Date().toISOString()) {
  return id(await db.query(
    "INSERT INTO PEDIDO(id_cliente,fecha,estado,modalidad_pago,subtotal,descuento,total,moneda_total,evidencia_total_usd) " +
    "VALUES(?,?,'DEMO_CONFIRMADO','CUENTA_CORRIENTE',?,0,?,'USD','DEMO FER17-v1: total histórico de prueba')",
    [client.clientId, sqlTime(instant), amount, amount]));
}

async function demoPayment(db, client, amount, {
  instant = new Date().toISOString(), state = 'ACREDITADO', currency = 'USD',
} = {}) {
  const date = sqlTime(instant);
  return id(await db.query(
    "INSERT INTO PAGO(id_cuenta_corriente,fecha,monto,metodo_pago,estado,moneda,fecha_acreditacion_utc,evidencia_acreditacion) " +
    "VALUES(?,?,?,'DEMO_TRANSFERENCIA',?,?,?,?)",
    [client.accountId, date, amount, state, currency, state === 'ACREDITADO' ? date : null,
      state === 'ACREDITADO' ? 'DEMO: constancia sintética de acreditación' : null]));
}

async function seedDemo(session, { browser = false } = {}) {
  await assertOwned(session, browser ? 'E2E' : 253);
  for (const table of tables) {
    const [row] = await session.connection.query('SELECT COUNT(*) AS n FROM ' + table);
    assert.equal(Number(row.n), 0, table + ' debe estar vacía');
  }

  const database = require('../../backend/dist/config/database.config');
  assertDatabaseOptions(session, database.dataSource);
  const repo = require('../../backend/dist/repositories/cuentaCorriente.repository');
  const bcrypt = require('../../backend/node_modules/bcryptjs');
  const hash = bcrypt.hashSync(password, '$2b$04$abcdefghijklmnopqrstuu');
  const fixture = { clients: {}, password, cut };
  mock.timers.enable({ apis: ['Date'], now: new Date(cut).getTime() });
  try {
    return await database.inTransaction(async manager => {
      const browserScenarios = [
        ['paginada', '1000.00', 30], ['real', '500.00', 30], ['mixta', '500.00', 30],
        ...Array.from({ length: 15 }, (_, i) => ['pagina-' + i, '300.00', 30]),
      ];
      for (const [key, limit, term, coverage = 'COMPLETA'] of [...scenarios, ...(browser ? browserScenarios : [])]) {
        const particular = key === 'particular';
        const email = 'fer19-' + key + '@example.test';
        const clientId = id(await manager.query(
          'INSERT INTO CLIENTE(tipo_cliente,nombre_razon_social,email,estado_aprobacion_empresa,es_fiel,activo,fecha_alta) VALUES(?,?,?,?,0,?,?)',
          [particular ? 'PARTICULAR' : 'EMPRESA', 'DEMO FER19 ' + key, email,
            particular ? null : key === 'pendiente' ? 'PENDIENTE' : 'APROBADA', key === 'cliente-inactivo' ? 0 : 1, opened]));
        const userId = id(await manager.query(
          "INSERT INTO USUARIO(id_cliente,email,password_hash,rol,activo,fecha_creacion) VALUES(?,?,?,'CLIENTE',?,?)",
          [clientId, email, hash, key === 'usuario-inactivo' ? 0 : 1, opened]));
        let accountId = null;
        if (limit !== null) {
          const complete = coverage === 'COMPLETA';
          accountId = id(await manager.query(
            'INSERT INTO CUENTA_CORRIENTE(id_cliente,limite_credito,habilitada,fecha_alta,cobertura,plazo_dias,' +
            'moneda_limite,evidencia_limite,evidencia_plazo,evidencia_cobertura,cobertura_desde_utc,origen_datos,revision) ' +
            "VALUES(?,?,1,?,?,?,?,?,?,?,?,?,0)",
            [clientId, limit, opened, coverage, term, complete ? 'USD' : null,
              complete ? 'DEMO: autorización de límite USD' : null, 'DEMO: plazo autorizado',
              complete ? 'DEMO: alta sin saldo previo' : null, complete ? opened : null,
              key === 'real' || key === 'mixta' ? 'REAL' : 'DEMO']));
        }
        fixture.clients[key] = { key, email, clientId, userId, accountId, limit, term, movements: [] };
      }
      const adminEmail = 'fer19-admin@example.test';
      const adminId = id(await manager.query(
        "INSERT INTO USUARIO(email,password_hash,rol,activo,fecha_creacion) VALUES(?,?,'ADMIN',1,?)",
        [adminEmail, hash, opened]));
      fixture.admin = { userId: adminId, email: adminEmail };

      async function movement(key, type, amount, instant, origin = 'DEMO') {
        const client = fixture.clients[key];
        mock.timers.setTime(Date.parse(instant));
        const dto = { id_cuenta_corriente: client.accountId, monto: amount, origen: origin };
        let orderId, paymentId, movementId;
        if (type === 'CARGO') {
          orderId = await demoOrder(manager, client, amount, instant);
          movementId = await repo.registrarCargoPorPedido({ ...dto, id_pedido: orderId }, manager);
        } else {
          paymentId = await demoPayment(manager, client, amount, { instant });
          movementId = await repo.registrarAbonoPorPago({ ...dto, id_pago: paymentId }, manager);
        }
        const item = { id: movementId, type, amount, effective: instant, orderId, paymentId, state: 'ACREDITADO' };
        client.movements.push(item);
        return item;
      }
      async function annul(key, item, instant) {
        mock.timers.setTime(Date.parse(instant));
        await repo.anularMovimiento({
          id_cuenta_corriente: fixture.clients[key].accountId,
          id_movimiento_cuenta: item.id, evento: 'DEMO-FER19-' + item.type,
          actor: String(adminId), motivo: 'DEMO: anulación autorizada de prueba',
        }, manager);
        item.state = 'ANULADO';
      }

      await movement('empresa30', 'CARGO', '100.00', '2026-01-01T12:00:00Z');
      const voidCharge = await movement('empresa30', 'CARGO', '20.00', '2026-01-01T12:00:00Z');
      await movement('empresa30', 'CARGO', '200.00', '2026-02-01T12:00:00Z');
      await movement('empresa30', 'CARGO', '50.00', '2026-03-02T12:00:00Z');
      await movement('empresa30', 'ABONO', '125.00', '2026-03-02T12:00:00Z');
      const voidPayment = await movement('empresa30', 'ABONO', '7.00', '2026-03-02T12:00:00Z');
      await annul('empresa30', voidCharge, '2026-03-02T13:00:00Z');
      await annul('empresa30', voidPayment, '2026-03-02T14:00:00Z');
      await movement('empresa60', 'CARGO', '600.10', '2026-01-01T12:00:00Z');
      await movement('empresa60', 'ABONO', '100.10', '2026-02-01T12:00:00Z');
      await movement('inhabilitada', 'CARGO', '70.00', '2026-02-01T12:00:00Z');
      await manager.query('UPDATE CUENTA_CORRIENTE SET habilitada=0 WHERE id_cuenta_corriente=?', [fixture.clients.inhabilitada.accountId]);
      await movement('favor', 'ABONO', '150.00', '2026-02-01T12:00:00Z');

      // Model an observed historical charge whose opening reconciliation is unavailable.
      await movement('parcial', 'CARGO', '40.00', '2026-02-01T12:00:00Z');
      await manager.query("UPDATE CUENTA_CORRIENTE SET cobertura='PARCIAL',evidencia_cobertura=NULL,cobertura_desde_utc=NULL WHERE id_cuenta_corriente=?",
        [fixture.clients.parcial.accountId]);
      for (const state of ['PENDIENTE', 'RECHAZADO']) {
        await demoPayment(manager, fixture.clients.empresa30, '999.00', { state, instant: '2026-02-10T12:00:00Z' });
      }
      if (browser) {
        for (let i = 0; i < 27; i++) await movement('paginada', 'CARGO', '1.00', '2026-02-01T12:00:00Z');
        await movement('real', 'CARGO', '80.00', '2026-02-01T12:00:00Z', 'PEDIDO');
        for (let i = 0; i < 25; i++) await movement('mixta', 'CARGO', '1.00', '2026-02-01T12:00:00Z', 'PEDIDO');
        // A historical credit on page two must taint the entire ledger.
        await movement('mixta', 'ABONO', '19.37', '2026-01-01T12:00:00Z');
      }
      return fixture;
    });
  } finally {
    mock.timers.reset();
  }
}

module.exports = { seedDemo, clearDemo, demoOrder, demoPayment };
