const assert = require('node:assert/strict');
const { test } = require('node:test');
const { accountContext } = require('./helpers/account-test-context.cjs');
const c = accountContext();

const state = client => c.repo.calcularEstadoCuenta(client.accountId);
async function allocations(client) {
  return c.db.query("SELECT id_cargo, id_abono, monto_imputado FROM IMPUTACION_MOVIMIENTO_CUENTA " +
    "WHERE id_cuenta_corriente=? AND estado='VIGENTE' ORDER BY id_cargo,id_abono", [client.accountId]);
}

test('saldo a favor mantiene signo y tope, y se imputa al cargo posterior', async () => {
  const client = c.fixture.clients.favor;
  const before = await state(client);
  assert.deepEqual([before.deuda_vigente, before.utilizado, before.credito_disponible], ['-150.00', '0.00', '100.00']);
  const charge = await c.charge(client, '25.00');
  assert.equal((await state(client)).deuda_vigente, '-125.00');
  assert.deepEqual(await allocations(client), [{
    id_cargo: charge, id_abono: client.movements[0].id, monto_imputado: '25.00',
  }]);
  assert.deepEqual(await c.repo.consultarVencimientos(client.accountId), []);
});

for (const [key, coverage, limit] of [
  ['incompleta', 'NO_ACREDITADA', null],
  ['parcial', 'PARCIAL', '700.00'],
]) test('cobertura ' + coverage + ' conserva importes desconocidos', async () => {
  const client = c.fixture.clients[key];
  const summary = await state(client);
  assert.deepEqual([
    summary.cobertura, summary.deuda_vigente, summary.total_cargos, summary.total_abonos,
    summary.utilizado, summary.credito_disponible, summary.limite_credito, summary.estado_credito,
  ], [coverage, null, null, null, null, null, limit, 'NO_DETERMINABLE']);
  await assert.rejects(c.charge(client, '1.00'), /cobertura histórica/);
});

test('movimiento ARS rechazado por SQL y el saldo USD queda intacto', async () => {
  await assert.rejects(c.db.query("UPDATE MOVIMIENTO_CUENTA_CORRIENTE SET moneda='ARS' WHERE id_movimiento_cuenta=?",
    [c.a.movements[0].id]), /chk_movimiento_moneda/);
  assert.equal((await state(c.a)).total_cargos, '350.00');
});

test('acreditación ARS exige cotización verificada, redondea una vez y conserva la tasa histórica', async () => {
  const client = c.fixture.clients.vacia;
  const payment = await c.payment(client, '1.01', { currency: 'ARS', instant: '2026-10-02T15:00:00Z' });
  const dto = { id_cuenta_corriente: client.accountId, id_pago: payment, monto: '0.51' };
  await assert.rejects(c.repo.registrarAbonoPorPago(dto), /CALENDARIO_NO_VERIFICADO/);
  assert.equal((await state(client)).deuda_vigente, '0.00');

  const admin = c.fixture.admin.userId;
  await c.db.query("INSERT INTO FER17_CALENDARIO(version,dias_json,evidencia,id_admin,verificado_utc,activo,sintetica) " +
    "VALUES('demo-fer19',?,'DEMO calendario',?,'2026-10-02 13:00:00',1,1)", [JSON.stringify({ '2026-10-01': true }), admin]);
  const quote = Number((await c.db.query(
    "INSERT INTO COTIZACION(tasa,fecha_referencia,fecha_carga,actor,valida) VALUES(2.00000000,'2026-10-01','2026-10-02 09:00:00','DEMO BNA',1)"
  )).insertId);
  await c.db.query("INSERT INTO FER17_COTIZACION_VERIFICACION(id_cotizacion,tasa_verificada,referencia_verificada,cargada_utc," +
    "actor_carga_verificado,banco,tipo,evidencia,id_admin,verificado_utc,valida,sintetica) " +
    "VALUES(?,2.00000000,'2026-10-01','2026-10-02 12:00:00','DEMO BNA','BNA','VENDEDOR','DEMO comprobación',?,'2026-10-02 13:00:00',1,1)",
    [quote, admin]);
  const movement = await c.repo.registrarAbonoPorPago(dto);
  await c.db.query('UPDATE COTIZACION SET tasa=3 WHERE id_cotizacion=?', [quote]);
  assert.equal(await c.repo.registrarAbonoPorPago(dto), movement);
  const [row] = await c.db.query('SELECT * FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_movimiento_cuenta=?', [movement]);
  assert.deepEqual([row.monto, row.moneda, row.monto_original, row.moneda_original, row.id_cotizacion, row.tasa_historica],
    ['0.51', 'USD', '1.01', 'ARS', quote, '2.00000000']);
  assert.equal(JSON.parse(row.evidencia_origen).cotizacion.evidencia, 'DEMO comprobación');
  assert.equal((await state(client)).deuda_vigente, '-0.51');
});

test('pedido y pago reintentados devuelven el ID anterior sin cambiar revisión ni imputaciones', async () => {
  const charge = { id_cuenta_corriente: c.a.accountId, id_pedido: await c.order(), monto: '1.00' };
  const credit = { id_cuenta_corriente: c.a.accountId, id_pago: await c.payment(c.a, '2.00'), monto: '2.00' };
  const chargeId = await c.repo.registrarCargoPorPedido(charge);
  const creditId = await c.repo.registrarAbonoPorPago(credit);
  const before = await state(c.a);
  const beforeAllocations = await allocations(c.a);
  assert.equal(await c.repo.registrarCargoPorPedido(charge), chargeId);
  assert.equal(await c.repo.registrarAbonoPorPago(credit), creditId);
  await assert.rejects(c.repo.registrarCargoPorPedido({ ...charge, monto: '3.00' }), /reutilizado con datos diferentes/);
  await assert.rejects(c.repo.registrarAbonoPorPago({ ...credit, monto: '3.00' }), /reutilizado con datos diferentes/);
  assert.deepEqual(await state(c.a), before);
  assert.deepEqual(await allocations(c.a), beforeAllocations);
});

test('pedido ajeno no genera cargo ni modifica cuentas', async () => {
  const other = c.fixture.clients.empresa60;
  const id = await c.order(other);
  await assert.rejects(c.repo.registrarCargoPorPedido({ id_cuenta_corriente: c.a.accountId, id_pedido: id, monto: '1.00' }),
    /titularidad/);
  assert.equal((await state(c.a)).deuda_vigente, '225.00');
  assert.equal((await state(other)).deuda_vigente, '500.00');
});
test('abono requiere referencia propia y acreditada', async () => {
  const foreign = await c.payment(c.fixture.clients.empresa60, '1.00');
  const dto = id => ({ id_cuenta_corriente: c.a.accountId, id_pago: id, monto: '1.00' });
  await assert.rejects(c.repo.registrarAbonoPorPago(dto(foreign)), /ajeno/);
  for (const state of ['PENDIENTE', 'RECHAZADO']) {
    await assert.rejects(c.repo.registrarAbonoPorPago(dto(await c.payment(c.a, '1.00', { state }))), /sin acreditación/);
  }
  await assert.rejects(c.db.query(
    "INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE(id_cuenta_corriente,tipo_movimiento,origen,monto) VALUES(?,'ABONO','PAGO','1.00')",
    [c.a.accountId]), /chk_movimiento_referencia/);
  assert.equal((await c.repo.calcularEstadoCuenta(c.a.accountId)).deuda_vigente, '225.00');
});
for (const amount of ['1e1', '0x10', '0.001', NaN, Infinity, '0.00', '-0.01']) {
  test('importe inválido rechazado ' + amount, async () => {
    const order = await c.order();
    await assert.rejects(c.repo.registrarCargoPorPedido({ id_cuenta_corriente: c.a.accountId, id_pedido: order, monto: amount }),
      /número finito mayor a cero/);
    assert.equal((await c.db.query('SELECT id_movimiento_cuenta FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pedido=?', [order])).length, 0);
  });
}

for (const days of [1, 31, 90]) test('plazo arbitrario rechazado ' + days, async () => {
  await assert.rejects(c.charge(c.fixture.clients.vacia, '1.00', { dias_vencimiento: days }), /Plazo inválido/);
});
test('plazo vigente se deriva de la cuenta, requiere evidencia y rechaza plazo incompatible', async () => {
  const client = c.fixture.clients.vacia;
  await assert.rejects(c.charge(client, '1.00', { dias_vencimiento: 60 }), /diferente del plazo acreditado/);
  const id = await c.charge(client, '1.00');
  await c.db.query('UPDATE CUENTA_CORRIENTE SET evidencia_plazo=NULL WHERE id_cuenta_corriente=?', [client.accountId]);
  await assert.rejects(c.charge(client, '1.00'), /Plazo no configurado/);
  const [row] = await c.db.query('SELECT plazo_aplicado FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_movimiento_cuenta=?', [id]);
  assert.equal(row.plazo_aplicado, 30);
});
test('cambiar el plazo comercial conserva el vencimiento histórico', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-01T15:00:00Z') });
  const client = c.fixture.clients.vacia;
  const first = await c.charge(client, '1.00');
  await c.db.query('UPDATE CUENTA_CORRIENTE SET plazo_dias=60 WHERE id_cuenta_corriente=?', [client.accountId]);
  const second = await c.charge(client, '1.00');
  assert.deepEqual(await c.db.query(
    'SELECT plazo_aplicado,vence_el FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_movimiento_cuenta IN (?,?) ORDER BY id_movimiento_cuenta',
    [first, second]), [{ plazo_aplicado: 30, vence_el: '2026-10-31' }, { plazo_aplicado: 60, vence_el: '2026-11-30' }]);
});

for (const [instant, days, base, due] of [
  ['2026-01-31T15:00:00Z', 30, '2026-01-31', '2026-03-02'],
  ['2026-12-15T15:00:00Z', 30, '2026-12-15', '2027-01-14'],
  ['2026-01-01T15:00:00Z', 60, '2026-01-01', '2026-03-02'],
  ['2024-01-31T15:00:00Z', 30, '2024-01-31', '2024-03-01'],
  ['2024-02-01T15:00:00Z', 60, '2024-02-01', '2024-04-01'],
  ['2026-02-01T00:00:00Z', 30, '2026-01-31', '2026-03-02'],
  ['2026-02-01T02:59:59.999Z', 30, '2026-01-31', '2026-03-02'],
  ['2026-02-01T03:00:00Z', 30, '2026-02-01', '2026-03-03'],
  ['2026-02-01T03:00:00.001Z', 30, '2026-02-01', '2026-03-03'],
  ['2026-01-01T02:59:59Z', 60, '2025-12-31', '2026-03-01'],
]) test('calendario BA ' + instant + ' con plazo ' + days, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(instant) });
  const client = days === 30 ? c.fixture.clients.vacia : c.fixture.clients.empresa60;
  const id = await c.charge(client, '1.00', { dias_vencimiento: days });
  const [row] = await c.db.query(
    'SELECT fecha_base_civil,plazo_aplicado,vence_el FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_movimiento_cuenta=?', [id]);
  assert.deepEqual(row, { fecha_base_civil: base, plazo_aplicado: days, vence_el: due });
});

test('vence al comenzar el día posterior en Buenos Aires', async () => {
  for (const [instant, expected] of [
    ['2026-03-04T02:59:59.999Z', 'POR_VENCER'], ['2026-03-04T03:00:00Z', 'VENCIDO'],
  ]) {
    const [due] = await c.repo.consultarVencimientos(c.a.accountId, new Date(instant));
    assert.deepEqual([due.venceEl, due.pendiente, due.estado], ['2026-03-03', '175.00', expected]);
  }
});

test('FIFO con fechas iguales desempata por ID y redistribuye al anular cargo y abono', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-04-01T15:00:00Z') });
  const client = c.fixture.clients.vacia;
  const first = await c.charge(client, '60.00');
  const second = await c.charge(client, '50.00');
  const credit = await c.credit(client, '75.00');
  assert.deepEqual(await allocations(client), [
    { id_cargo: first, id_abono: credit, monto_imputado: '60.00' },
    { id_cargo: second, id_abono: credit, monto_imputado: '15.00' },
  ]);
  const annul = (id, event) => c.repo.anularMovimiento({
    id_cuenta_corriente: client.accountId, id_movimiento_cuenta: id, evento: event,
    actor: String(c.fixture.admin.userId), motivo: 'DEMO anulación contractual',
  });
  await annul(first, 'DEMO-FIFO-CARGO');
  assert.equal(await annul(first, 'DEMO-FIFO-CARGO'), first);
  assert.deepEqual(await allocations(client), [{ id_cargo: second, id_abono: credit, monto_imputado: '50.00' }]);
  assert.equal((await state(client)).deuda_vigente, '-25.00');
  await annul(credit, 'DEMO-FIFO-ABONO');
  assert.deepEqual(await allocations(client), []);
  assert.equal((await state(client)).deuda_vigente, '50.00');
  assert.deepEqual(await c.repo.consultarVencimientos(client.accountId), [
    { movimientoId: String(second), venceEl: '2026-05-01', plazoDias: 30, pendiente: '50.00', estado: 'POR_VENCER' },
  ]);
  const history = await c.db.query('SELECT estado,evento_sustitucion FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_cuenta_corriente=? ORDER BY id_imputacion',
    [client.accountId]);
  assert.deepEqual(history, [
    { estado: 'ANULADA', evento_sustitucion: 'DEMO-FIFO-CARGO' },
    { estado: 'ANULADA', evento_sustitucion: 'DEMO-FIFO-CARGO' },
    { estado: 'ANULADA', evento_sustitucion: 'DEMO-FIFO-ABONO' },
  ]);
});
