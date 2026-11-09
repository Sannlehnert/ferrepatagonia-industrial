const assert = require('node:assert/strict');
const { test } = require('node:test');
const { accountContext } = require('./helpers/account-test-context.cjs');
const { seedDemo, clearDemo } = require('../../database/fixtures/fer19-demo.cjs');
const c = accountContext();

test('seed reproducible con IDs autogenerados diferentes y segunda carga rechazada sin escrituras', async () => {
  const snapshot = async () => ({
    accounts: await c.db.query(`SELECT cl.email,cc.limite_credito,cc.habilitada,cc.cobertura,cc.plazo_dias,cc.origen_datos,
      cc.moneda_limite,cc.evidencia_limite,cc.evidencia_plazo,cc.evidencia_cobertura,cc.cobertura_desde_utc,
      CAST(cc.revision AS CHAR) AS revision
      FROM CLIENTE cl LEFT JOIN CUENTA_CORRIENTE cc USING(id_cliente) ORDER BY cl.email`),
    movements: await c.db.query(`SELECT cl.email,m.tipo_movimiento,m.monto,m.moneda,m.fecha_efectiva,
      m.fecha_base_civil,m.plazo_aplicado,m.vence_el,m.estado,m.invalidado_utc
      FROM MOVIMIENTO_CUENTA_CORRIENTE m JOIN CUENTA_CORRIENTE cc USING(id_cuenta_corriente)
      JOIN CLIENTE cl USING(id_cliente) ORDER BY cl.email,m.id_movimiento_cuenta`),
    allocations: await c.db.query(`SELECT cl.email,cargo.monto AS cargo,abono.monto AS abono,i.monto_imputado,
      i.estado,CAST(i.revision AS CHAR) AS revision,i.fecha_imputacion,i.invalidada_utc
      FROM IMPUTACION_MOVIMIENTO_CUENTA i JOIN CUENTA_CORRIENTE cc USING(id_cuenta_corriente)
      JOIN CLIENTE cl USING(id_cliente) JOIN MOVIMIENTO_CUENTA_CORRIENTE cargo ON cargo.id_movimiento_cuenta=i.id_cargo
      JOIN MOVIMIENTO_CUENTA_CORRIENTE abono ON abono.id_movimiento_cuenta=i.id_abono
      ORDER BY cl.email,i.id_imputacion`),
  });
  const first = JSON.stringify(await snapshot());
  const id = c.a.accountId;
  await assert.rejects(seedDemo(c.session), /debe estar vacía/);
  assert.equal(JSON.stringify(await snapshot()), first);
  await clearDemo(c.session);
  const second = await seedDemo(c.session);
  assert.notEqual(second.clients.empresa30.accountId, id);
  assert.equal(JSON.stringify(await snapshot()), first);
});

test('seed: usuarios válidos, contraseña de login DEMO y relaciones propias', async () => {
  const users = await c.db.query('SELECT * FROM USUARIO');
  assert.equal(users.length, 14);
  const bcrypt = require('bcryptjs');
  assert.ok(bcrypt.compareSync(c.fixture.password, users[0].password_hash));
  assert.equal(users.filter(u => u.rol === 'ADMIN' && u.id_cliente === null).length, 1);
  assert.equal(Number((await c.db.query(`SELECT COUNT(*) n FROM MOVIMIENTO_CUENTA_CORRIENTE m
    JOIN CUENTA_CORRIENTE cc USING(id_cuenta_corriente) LEFT JOIN PEDIDO p USING(id_pedido) LEFT JOIN PAGO a USING(id_pago)
    WHERE (m.tipo_movimiento='CARGO' AND p.id_cliente<>cc.id_cliente)
       OR (m.tipo_movimiento='ABONO' AND a.id_cuenta_corriente<>cc.id_cuenta_corriente)`))[0].n), 0);
  assert.equal(c.fixture.clients.particular.accountId, null);
});

test('fallo a mitad del seed revierte todas sus escrituras', async () => {
  await clearDemo(c.session);
  await c.db.query(`CREATE TRIGGER demo_seed_fail BEFORE INSERT ON PAGO FOR EACH ROW
    BEGIN IF NEW.monto=999.00 AND NEW.estado='RECHAZADO' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DEMO_SEED_FAILURE'; END IF; END`);
  try {
    await assert.rejects(seedDemo(c.session), /DEMO_SEED_FAILURE/);
    for (const table of ['USUARIO', 'CLIENTE', 'CUENTA_CORRIENTE', 'MOVIMIENTO_CUENTA_CORRIENTE',
      'IMPUTACION_MOVIMIENTO_CUENTA', 'PAGO', 'PEDIDO'])
      assert.equal(Number((await c.db.query(`SELECT COUNT(*) n FROM ${table}`))[0].n), 0);
  } finally { await c.db.query('DROP TRIGGER demo_seed_fail'); }
});

test('esquema requerido ausente falla explícitamente antes de escribir', async () => {
  await clearDemo(c.session);
  await c.db.query('RENAME TABLE MOVIMIENTO_CUENTA_CORRIENTE TO DEMO_MOVIMIENTO_UNAVAILABLE');
  try {
    await assert.rejects(seedDemo(c.session), /doesn't exist|does not exist/i);
    assert.equal(Number((await c.db.query('SELECT COUNT(*) n FROM CLIENTE'))[0].n), 0);
  } finally { await c.db.query('RENAME TABLE DEMO_MOVIMIENTO_UNAVAILABLE TO MOVIMIENTO_CUENTA_CORRIENTE'); }
});

for (const [key, charges, credits, debt, available] of [
  ['empresa30', '350.00', '125.00', '225.00', '775.00'],
  ['empresa60', '600.10', '100.10', '500.00', '1500.00'],
  ['inhabilitada', '70.00', '0.00', '70.00', '0.00'],
  ['vacia', '0.00', '0.00', '0.00', '300.00'],
  ['cero', '0.00', '0.00', '0.00', '0.00'],
]) test(`repositorio #260: saldo y crédito del escenario ${key}`, async () => {
  const s = await c.repo.calcularEstadoCuenta(c.fixture.clients[key].accountId);
  assert.deepEqual([s.total_cargos, s.total_abonos, s.deuda_vigente, s.credito_disponible], [charges, credits, debt, available]);
});

test('cuenta inexistente devuelve null; búsqueda por titular no intercambia cuentas', async () => {
  assert.equal(await c.repo.calcularEstadoCuenta(2147483647), null);
  assert.equal(await c.repo.findCuentaByClienteId(c.fixture.clients.particular.clientId), null);
  assert.equal((await c.repo.findCuentaByClienteId(c.a.clientId)).id_cuenta_corriente, c.a.accountId);
});

test('cuenta vacía conserva colección vacía sin fabricar movimientos', async () => {
  assert.equal((await c.db.query('SELECT * FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente=?', [c.fixture.clients.vacia.accountId])).length, 0);
});

test('cargo exacto seguido de abono exacto cancela deuda', async () => {
  const a = c.fixture.clients.vacia;
  await c.charge(a, '0.30');
  assert.equal((await c.repo.calcularEstadoCuenta(a.accountId)).deuda_vigente, '0.30');
  await c.credit(a, '0.30');
  assert.equal((await c.repo.calcularEstadoCuenta(a.accountId)).deuda_vigente, '0.00');
  assert.deepEqual(await c.repo.consultarVencimientos(a.accountId), []);
});

test('pagos pendientes/rechazados no generan movimientos ni alteran saldo', async () => {
  assert.equal(Number((await c.db.query("SELECT COUNT(*) n FROM PAGO WHERE estado IN ('PENDIENTE','RECHAZADO')"))[0].n), 2);
  assert.equal((await c.repo.calcularEstadoCuenta(c.a.accountId)).deuda_vigente, '225.00');
});

test('saldo a favor no amplía el límite comercial (signo del saldo: suite contract)', async () => {
  const s = await c.repo.calcularEstadoCuenta(c.fixture.clients.favor.accountId);
  assert.equal(s.total_abonos, '150.00');
  assert.equal(s.credito_disponible, '100.00');
});

for (const [key, amount, message] of [
  ['inhabilitada', '1.00', /no se encuentra habilitada/],
  ['cero', '0.01', /excede/],
  ['empresa30', '775.01', /excede/],
]) test(`rechaza cargo en ${key} sin persistencia parcial`, async () => {
  const a = c.fixture.clients[key], orderId = await c.order(a, amount);
  await assert.rejects(c.repo.registrarCargoPorPedido({ id_cuenta_corriente: a.accountId, id_pedido: orderId, monto: amount }), message);
  assert.equal(Number((await c.db.query('SELECT COUNT(*) n FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pedido=?', [orderId]))[0].n), 0);
});

for (const value of ['', ' ', 'x', 'NaN', 'Infinity', NaN, Infinity, '0', '-0.01']) test(`importe inválido ${JSON.stringify(String(value))} rechazado antes de escribir`, async () => {
  const id = await c.order();
  await assert.rejects(c.repo.registrarCargoPorPedido({ id_cuenta_corriente: c.a.accountId, id_pedido: id, monto: value }), /finito mayor a cero/);
  assert.equal(Number((await c.db.query('SELECT COUNT(*) n FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pedido=?', [id]))[0].n), 0);
});

test('dos cargos simultáneos compiten por 775.00: solo uno de 450.00 persiste', async () => {
  const orders = [await c.order(c.a, '450.00'), await c.order(c.a, '450.00')];
  const results = await Promise.allSettled(orders.map(id => c.repo.registrarCargoPorPedido({ id_cuenta_corriente: c.a.accountId, id_pedido: id, monto: '450.00' })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /excede/);
  assert.equal((await c.repo.calcularEstadoCuenta(c.a.accountId)).deuda_vigente, '675.00');
});

test('unicidad pedido/pago y FK reales MariaDB', async () => {
  const cargo = c.a.movements[0], abono = c.a.movements.find(m => m.type === 'ABONO');
  const insert = (type, order, payment) => c.db.query(
    "INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE(id_cuenta_corriente,tipo_movimiento,origen,id_pedido,id_pago,monto) VALUES(?,?,'DEMO',?,?,'1.00')",
    [c.a.accountId, type, order, payment]);
  await assert.rejects(insert('CARGO', cargo.orderId, null), /uq_movimiento_pedido/);
  await assert.rejects(insert('ABONO', null, abono.paymentId), /uq_movimiento_pago/);
  await assert.rejects(insert('ABONO', null, 2147483647), /fk_movimiento_pago/);
});

test('rollback externo revierte cargo; cuenta B permanece intacta', async () => {
  const orderId = await c.order(c.a, '100.00');
  const before = await c.repo.calcularEstadoCuenta(c.a.accountId);
  const allocations = () => c.db.query('SELECT * FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_cuenta_corriente=? ORDER BY id_imputacion', [c.a.accountId]);
  const beforeAllocations = await allocations();
  await assert.rejects(c.database.inTransaction(async manager => {
    await c.repo.registrarCargoPorPedido({ id_cuenta_corriente: c.a.accountId, id_pedido: orderId, monto: '100.00' }, manager);
    throw Error('DEMO_ROLLBACK');
  }), /DEMO_ROLLBACK/);
  assert.deepEqual(await c.repo.calcularEstadoCuenta(c.a.accountId), before);
  assert.deepEqual(await allocations(), beforeAllocations);
  assert.equal((await c.repo.calcularEstadoCuenta(c.fixture.clients.empresa60.accountId)).deuda_vigente, '500.00');
  assert.equal(Number((await c.db.query('SELECT COUNT(*) n FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pedido=?', [orderId]))[0].n), 0);
});

test('DECIMAL máximo y mínimo conservados exactamente en SQL y resumen básico', async () => {
  const a = c.fixture.clients.vacia;
  await c.db.query("UPDATE CUENTA_CORRIENTE SET limite_credito='9999999999.99' WHERE id_cuenta_corriente=?", [a.accountId]);
  await c.charge(a, '9999999999.99');
  const s = await c.repo.calcularEstadoCuenta(a.accountId);
  assert.equal(s.deuda_vigente, '9999999999.99');
  assert.equal(s.credito_disponible, '0.00');
  await assert.rejects(c.db.query("UPDATE CUENTA_CORRIENTE SET limite_credito='10000000000.00' WHERE id_cuenta_corriente=?", [a.accountId]), /range/i);
});

test('105 cargos de 0.01 acumulan 1.05 sin redondear cada suma', async () => {
  const a = c.fixture.clients.vacia;
  for (let n = 0; n < 105; n++) await c.charge(a, '0.01');
  const s = await c.repo.calcularEstadoCuenta(a.accountId);
  assert.equal(s.total_cargos, '1.05');
  assert.equal(s.credito_disponible, '298.95');
});
for (const [column, value, constraint] of [
  ['monto', '0.00', 'chk_movimiento_monto'],
  ['tipo_movimiento', 'OTRO', 'chk_movimiento_tipo'],
  ['moneda', 'EUR', 'chk_movimiento_moneda'],
  ['estado', 'PENDIENTE', 'chk_movimiento_estado'],
]) test(`migración real conserva CHECK ${constraint}`, async () => {
  const fields = { monto: '1.00', tipo_movimiento: 'ABONO', moneda: 'USD', estado: 'ACREDITADO', [column]: value };
  const payment = await c.payment(c.a, '1.00');
  await assert.rejects(c.db.query(`INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE(id_cuenta_corriente,origen,monto,tipo_movimiento,moneda,estado,id_pago)
    VALUES(?,'DEMO',?,?,?,?,?)`, [c.a.accountId, fields.monto, fields.tipo_movimiento, fields.moneda, fields.estado, payment]), new RegExp(constraint));
});
