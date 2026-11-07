// Synthetic test-only USD evidence. Coverage/terms below are fixture intentions:
// #260 has no columns to persist them. Never interpret this manifest as production evidence.
const assert = require('node:assert/strict');
const { assertOwned } = require('../../backend/test/helpers/account-disposable.cjs');
const epoch = '2026-01-01 12:00:00';
const password = 'Fer19-DEMO-only!';
const scenarios = [
  ['particular', null, null, null],
  ['empresa30', '1000.00', 30, 'COMPLETA'],
  ['empresa60', '2000.00', 60, 'COMPLETA'],
  ['inhabilitada', '500.00', 30, 'COMPLETA'],
  ['vacia', '300.00', 30, 'COMPLETA'],
  ['incompleta', '700.00', null, 'NO_ACREDITADA'],
  ['favor', '100.00', 30, 'COMPLETA'],
  ['cero', '0.00', 30, 'COMPLETA'],
  ['pendiente', '400.00', 30, 'NO_ACREDITADA'],
  ['usuario-inactivo', '400.00', 30, 'COMPLETA'],
  ['cliente-inactivo', '400.00', 30, 'COMPLETA'],
];
const tables = ['MOVIMIENTO_CUENTA_CORRIENTE', 'PAGO', 'PEDIDO', 'CUENTA_CORRIENTE', 'USUARIO', 'CLIENTE'];

async function clearDemo(session) {
  await assertOwned(session);
  for (const table of tables) await session.connection.query(`DELETE FROM ${table}`);
}

async function seedDemo(session) {
  await assertOwned(session);
  const db = session.connection;
  // Fail before inserting anything if the actual required schema is absent.
  for (const table of tables) assert.equal(Number((await db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0].n), 0, `${table} debe estar vacía`);
  const bcrypt = require('../../backend/node_modules/bcryptjs');
  const hash = bcrypt.hashSync(password, '$2b$04$abcdefghijklmnopqrstuu');
  const fixture = { clients: {}, password, cut: '2026-03-03T03:00:00.000Z', origin: 'DEMO' };
  await db.beginTransaction();
  try {
    for (const [key, limit, term, coverage] of scenarios) {
      const particular = key === 'particular';
      const email = `fer19-${key}@example.test`;
      const client = await db.query(`INSERT INTO CLIENTE(tipo_cliente,nombre_razon_social,email,estado_aprobacion_empresa,es_fiel,activo,fecha_alta)
        VALUES(?,?,?,?,0,?,?)`, [particular ? 'PARTICULAR' : 'EMPRESA', `DEMO FER19 ${key}`, email,
        particular ? null : key === 'pendiente' ? 'PENDIENTE' : 'APROBADA', key === 'cliente-inactivo' ? 0 : 1, epoch]);
      const clientId = Number(client.insertId);
      const user = await db.query(`INSERT INTO USUARIO(id_cliente,email,password_hash,rol,activo,fecha_creacion)
        VALUES(?,?,?,'CLIENTE',?,?)`, [clientId, email, hash, key === 'usuario-inactivo' ? 0 : 1, epoch]);
      let accountId = null;
      if (limit !== null) accountId = Number((await db.query(`INSERT INTO CUENTA_CORRIENTE(id_cliente,limite_credito,habilitada,fecha_alta,observaciones)
        VALUES(?,?,?,?,?)`, [clientId, limit, key === 'inhabilitada' ? 0 : 1, epoch, `DEMO USD; intención ${coverage}; plazo ${term}; NO son columnas de evidencia`])).insertId);
      fixture.clients[key] = { key, email, clientId, userId: Number(user.insertId), accountId, limit, term, coverage, movements: [] };
    }
    const admin = await db.query(`INSERT INTO USUARIO(email,password_hash,rol,activo,fecha_creacion) VALUES('fer19-admin@example.test',?,'ADMIN',1,?)`, [hash, epoch]);
    fixture.admin = { userId: Number(admin.insertId), email: 'fer19-admin@example.test' };
    async function movement(key, type, amount, effective, due = null, state = 'ACREDITADO') {
      const c = fixture.clients[key];
      let orderId = null, paymentId = null;
      if (type === 'CARGO') orderId = Number((await db.query(`INSERT INTO PEDIDO(id_cliente,fecha,estado,modalidad_pago,subtotal,descuento,total,observaciones)
        VALUES(?,?,'DEMO_CONFIRMADO','DEMO_CUENTA_CORRIENTE',?,0,?,'DEMO USD sintético')`, [c.clientId, effective, amount, amount])).insertId);
      else paymentId = Number((await db.query(`INSERT INTO PAGO(id_cuenta_corriente,fecha,monto,metodo_pago,estado,observaciones)
        VALUES(?,?,?,'DEMO_USD',?,'DEMO USD sintético')`, [c.accountId, effective, amount, state])).insertId);
      const result = await db.query(`INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE(id_cuenta_corriente,tipo_movimiento,origen,id_pedido,id_pago,monto,moneda,fecha_efectiva,fecha_incorporacion,fecha_vencimiento,estado,observaciones)
        VALUES(?,?,?,?,?,?,'USD',?,?,?,?, 'DEMO FER19 USD sintético')`, [c.accountId, type, type === 'CARGO' ? 'PEDIDO' : 'PAGO', orderId, paymentId, amount, effective, effective, due, state]);
      c.movements.push({ id: Number(result.insertId), type, amount, effective, due, state, orderId, paymentId });
    }
    // At the fixed cut: Jan 31 overdue, Mar 3 due today, Apr 1 upcoming.
    await movement('empresa30', 'CARGO', '100.00', '2026-01-01 12:00:00', '2026-01-31 00:00:00');
    await movement('empresa30', 'CARGO', '200.00', '2026-02-01 12:00:00', '2026-03-03 00:00:00');
    await movement('empresa30', 'CARGO', '50.00', '2026-03-02 12:00:00', '2026-04-01 00:00:00');
    await movement('empresa30', 'ABONO', '125.00', '2026-03-02 12:00:00');
    await movement('empresa30', 'CARGO', '20.00', '2026-01-01 12:00:00', '2026-01-31 00:00:00', 'ANULADO');
    await movement('empresa30', 'ABONO', '7.00', '2026-03-02 12:00:00', null, 'ANULADO');
    await movement('empresa60', 'CARGO', '600.10', '2026-01-01 12:00:00', '2026-03-02 00:00:00');
    await movement('empresa60', 'ABONO', '100.10', '2026-02-01 12:00:00');
    await movement('inhabilitada', 'CARGO', '70.00', '2026-02-01 12:00:00', '2026-03-03 00:00:00');
    await movement('favor', 'ABONO', '150.00', '2026-02-01 12:00:00');
    // A known row does not establish complete opening coverage.
    await movement('incompleta', 'CARGO', '40.00', '2026-02-01 12:00:00');
    for (const state of ['PENDIENTE', 'RECHAZADO']) await db.query(`INSERT INTO PAGO(id_cuenta_corriente,fecha,monto,metodo_pago,estado,observaciones)
      VALUES(?,?,'999.00','DEMO_USD',?,'DEMO: no genera movimiento acreditado')`, [fixture.clients.empresa30.accountId, epoch, state]);
    await db.commit();
    return fixture;
  } catch (error) { await db.rollback(); throw error; }
}
module.exports = { seedDemo, clearDemo, scenarios };
