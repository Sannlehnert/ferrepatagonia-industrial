// Real failing contract probes. Deliberately separate from the available subset:
// never skip, invert expected results, or claim these are approved on #260.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { accountContext } = require('./helpers/account-test-context.cjs');
const c = accountContext();

test('#250 saldo negativo conserva saldo a favor', async () => {
  assert.equal((await c.repo.calcularEstadoCuenta(c.fixture.clients.favor.accountId)).deuda_vigente, '-150.00');
});
test('#250 cobertura incompleta no equivale a saldo conocido', async () => {
  assert.equal((await c.repo.calcularEstadoCuenta(c.fixture.clients.incompleta.accountId)).deuda_vigente, null);
});
test('#250 saldo a favor se consume al registrar cargo posterior', async () => {
  const a = c.fixture.clients.favor;
  await c.charge(a, '25.00');
  assert.equal((await c.repo.calcularEstadoCuenta(a.accountId)).deuda_vigente, '-125.00');
});
test('#250 solo USD acreditados participan del saldo', async () => {
  await c.db.query("UPDATE MOVIMIENTO_CUENTA_CORRIENTE SET moneda='ARS' WHERE id_movimiento_cuenta=?", [c.a.movements[0].id]);
  assert.equal((await c.repo.calcularEstadoCuenta(c.a.accountId)).total_cargos, '250.00');
});
test('#250 repetición del mismo evento devuelve resultado previo', async () => {
  const id = await c.order(), dto = { id_cuenta_corriente: c.a.accountId, id_pedido: id, monto: '1.00' };
  const first = await c.repo.registrarCargoPorPedido(dto);
  assert.equal(await c.repo.registrarCargoPorPedido(dto), first);
});
test('#250 rechaza pedido ajeno a la cuenta', async () => {
  const id = await c.order(c.fixture.clients.empresa60);
  await assert.rejects(c.repo.registrarCargoPorPedido({ id_cuenta_corriente: c.a.accountId, id_pedido: id, monto: '1.00' }));
});
test('#250 abono exige pago acreditado de esa cuenta', async () => {
  await assert.rejects(c.db.query(`INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE(id_cuenta_corriente,tipo_movimiento,origen,monto) VALUES(?,'ABONO','PAGO','1.00')`, [c.a.accountId]));
});
for (const amount of ['1e1', '0x10', '0.001']) test(`#250 importe no canónico ${amount} no se convierte silenciosamente`, async () => {
  const id = await c.order();
  await assert.rejects(c.repo.registrarCargoPorPedido({ id_cuenta_corriente: c.a.accountId, id_pedido: id, monto: amount }));
});
for (const days of [undefined, 1, 31, 90]) test(`#250 plazo ${days} no autoriza un cargo`, async () => {
  await assert.rejects(c.charge(c.fixture.clients.vacia, '1.00', { dias_vencimiento: days }));
});
for (const [instant, days, due] of [
  ['2026-01-31T15:00:00Z', 30, '2026-03-02'],
  ['2026-12-15T15:00:00Z', 30, '2027-01-14'],
  ['2026-01-01T15:00:00Z', 60, '2026-03-02'],
  ['2024-01-31T15:00:00Z', 30, '2024-03-01'],
  ['2024-02-01T15:00:00Z', 60, '2024-04-01'],
  ['2026-02-01T02:59:59Z', 30, '2026-03-02'],
  ['2026-02-01T03:00:00Z', 30, '2026-03-03'],
  ['2026-01-01T02:59:59Z', 60, '2026-03-01'],
]) test(`#250 calendario BA ${instant} + ${days} días = ${due}`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(instant).getTime() });
  const id = await c.charge(c.fixture.clients.vacia, '1.00', { dias_vencimiento: days });
  const [row] = await c.db.query('SELECT fecha_vencimiento FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_movimiento_cuenta=?', [id]);
  assert.equal(row.fecha_vencimiento.slice(0, 10), due);
});
