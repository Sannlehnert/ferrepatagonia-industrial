const assert = require('node:assert/strict');
const { mock } = require('node:test');
const bcrypt = require('bcryptjs');
const { assertOwned } = require('./cc260-disposable.cjs');

const cut = '2026-03-03T03:00:00.000Z';
const sqlDate = iso => iso.replace('T', ' ').replace('Z', '');
const password = 'E2eLocal-214!';

async function seedAdminAccounts(session, { browser = false } = {}) {
  await assertOwned(session);
  const { dataSource, inTransaction } = require('../../dist/config/database.config');
  const { host, port, database, password: secret } = session.profile;
  assert.equal(dataSource.options.host, host);
  assert.equal(dataSource.options.port, port);
  assert.equal(dataSource.options.database, database);
  assert.equal(dataSource.options.username, 'root');
  assert.ok(dataSource.options.password === secret, 'Credencial de DataSource ajena al runner');
  const ledger = require('../../dist/repositories/cuentaCorriente.repository');
  const hash = bcrypt.hashSync(password, '$2b$04$abcdefghijklmnopqrstuu');
  const fixture = { cut, accounts: {} };
  mock.timers.enable({ apis: ['Date'], now: new Date(cut) });
  try {
    return await inTransaction(async db => {
      const insert = async (sql, values) => Number((await db.query(sql, values)).insertId);
      const [empty] = await db.query('SELECT COUNT(*) AS n FROM CUENTA_CORRIENTE');
      assert.equal(Number(empty.n), 0, 'Fixture #258 exige ledger vacío');

      async function account(key, limit = '1000.00', term = 30, coverage = 'COMPLETA') {
        const email = `cc258-${key}@example.test`;
        const clientId = await insert(
          "INSERT INTO CLIENTE(tipo_cliente,nombre_razon_social,email,estado_aprobacion_empresa,es_fiel,activo) VALUES('EMPRESA',?,?,'APROBADA',0,1)",
          [`DEMO #258 ${key}`, email],
        );
        const userId = await insert(
          "INSERT INTO USUARIO(id_cliente,email,password_hash,rol,activo) VALUES(?,?,?,'CLIENTE',1)", [clientId, email, hash],
        );
        const accountId = await insert(`INSERT INTO CUENTA_CORRIENTE
          (id_cliente,limite_credito,habilitada,cobertura,plazo_dias,moneda_limite,evidencia_limite,evidencia_plazo,
            evidencia_cobertura,cobertura_desde_utc,origen_datos)
          VALUES(?,?,1,?,?,?,'Autorización DEMO','Plazo DEMO',?,?,'DEMO')`,
        [clientId, limit, coverage, term, coverage === 'COMPLETA' ? 'USD' : null,
          coverage === 'COMPLETA' ? 'Alta DEMO' : null, coverage === 'COMPLETA' ? '2025-01-01 00:00:00' : null]);
        return fixture.accounts[key] = { clientId, userId, accountId, email, movements: {} };
      }

      async function charge(acct, key, amount, at) {
        mock.timers.setTime(Date.parse(at));
        const id_pedido = await insert(`INSERT INTO PEDIDO
          (id_cliente,fecha,estado,modalidad_pago,subtotal,descuento,total,moneda_total,evidencia_total_usd)
          VALUES(?,?,'DEMO_CONFIRMADO','CUENTA_CORRIENTE',?,0,?,'USD','Total DEMO acreditado')`,
        [acct.clientId, sqlDate(at), amount, amount]);
        acct.movements[key] = await ledger.registrarCargoPorPedido({
          id_cuenta_corriente: acct.accountId, id_pedido, monto: amount, origen: 'DEMO', observaciones: 'interno-fixture-258',
        }, db);
      }

      async function credit(acct, key, amount, at) {
        mock.timers.setTime(Date.parse(at));
        const id_pago = await insert(`INSERT INTO PAGO
          (id_cuenta_corriente,fecha,monto,metodo_pago,estado,moneda,fecha_acreditacion_utc,evidencia_acreditacion)
          VALUES(?,?,?,'DEMO','ACREDITADO','USD',?,'Pago DEMO acreditado')`,
        [acct.accountId, sqlDate(at), amount, sqlDate(at)]);
        acct.movements[key] = await ledger.registrarAbonoPorPago({
          id_cuenta_corriente: acct.accountId, id_pago, monto: amount, origen: 'DEMO', observaciones: 'interno-fixture-258',
        }, db);
      }

      const debt = await account('debt');
      const long = await account('long', '2000.00', 60);
      const disabled = await account('disabled');
      await account('empty', '400.00');
      await account('unknown', '700.00', 30, 'NO_ACREDITADA');
      const partial = await account('partial');
      const favor = await account('favor', '100.00');
      await account('zero', '0.00');
      if (browser) {
        for (let i = 0; i < 19; i++) await account(`page-${i}`);
        for (let i = 0; i < 25; i++) await charge(debt, `page-${i}`, '1.00', '2025-12-01T12:00:00.000Z');
        await credit(debt, 'paid-page', '25.00', '2025-12-02T12:00:00.000Z');
      }
      await charge(debt, 'paid', '100.00', '2026-01-01T12:00:00.000Z');
      await charge(debt, 'void', '20.00', '2026-01-01T12:00:00.000Z');
      await charge(debt, 'today', '200.00', '2026-02-01T12:00:00.000Z');
      await charge(debt, 'future', '50.00', '2026-03-02T12:00:00.000Z');
      await credit(debt, 'payment', '125.00', '2026-03-02T12:00:00.000Z');
      await credit(debt, 'void-payment', '7.00', '2026-03-02T12:00:00.000Z');
      mock.timers.setTime(Date.parse(cut));
      for (const key of ['void', 'void-payment']) {
        await ledger.anularMovimiento({
          id_cuenta_corriente: debt.accountId, id_movimiento_cuenta: debt.movements[key], evento: `DEMO-258-${key}`,
          actor: '1', motivo: 'Prueba DEMO de anulación',
        }, db);
      }
      await charge(long, 'charge', '600.10', '2026-01-01T02:59:59.000Z');
      await credit(long, 'payment', '100.10', '2026-02-01T12:00:00.000Z');
      await charge(disabled, 'charge', '70.00', '2026-02-01T12:00:00.000Z');
      await credit(favor, 'payment', '150.00', '2026-02-01T12:00:00.000Z');
      await charge(partial, 'charge', '40.00', '2026-02-01T12:00:00.000Z');
      await db.query('UPDATE CUENTA_CORRIENTE SET habilitada=0 WHERE id_cuenta_corriente=?', [disabled.accountId]);
      await db.query('UPDATE CLIENTE SET activo=0 WHERE id_cliente=?', [disabled.clientId]);
      await db.query("UPDATE CUENTA_CORRIENTE SET cobertura='PARCIAL',evidencia_cobertura=NULL,cobertura_desde_utc=NULL WHERE id_cuenta_corriente=?", [partial.accountId]);
      return fixture;
    });
  } finally {
    mock.timers.reset();
  }
}

module.exports = { seedAdminAccounts, password };
