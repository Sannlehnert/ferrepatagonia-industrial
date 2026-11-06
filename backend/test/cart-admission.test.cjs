const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CartAdmission } = require('../dist/services/cart.admission');

const conflict = { status: 409, code: 'CONFLICTO_CARRITO' };
const signal = new AbortController().signal;

test('admisión respeta FIFO por usuario sin bloquear a otro cliente elegible', async () => {
  const gate = new CartAdmission({ active: 2, pending: 3, pendingPerUser: 2, waitMs: 1000 });
  const hold = Promise.withResolvers();
  const events = [];
  const first = gate.run(1, signal, () => hold.promise);
  const second = gate.run(1, signal, async () => events.push('A2'));
  const third = gate.run(1, signal, async () => events.push('A3'));
  await assert.rejects(gate.run(1, signal, async () => assert.fail('excedió cupo por usuario')), conflict);
  await gate.run(2, signal, async () => events.push('B1'));
  assert.deepEqual(events, ['B1']);
  hold.resolve();
  await Promise.all([first, second, third]);
  assert.deepEqual(events, ['B1', 'A2', 'A3']);
});

test('admisión limita activos y pendientes globales, y descarta la espera vencida', async () => {
  const gate = new CartAdmission({ active: 1, pending: 1, pendingPerUser: 1, waitMs: 30 });
  const hold = Promise.withResolvers();
  const first = gate.run(1, signal, () => hold.promise);
  const pending = gate.run(2, signal, async () => assert.fail('la espera vencida no puede ejecutar trabajo'));
  await assert.rejects(gate.run(3, signal, async () => assert.fail('excedió cupo global')), conflict);
  await assert.rejects(pending, conflict);
  const next = gate.run(3, signal, async () => 3);
  hold.resolve();
  await first;
  assert.equal(await next, 3);
});

test('cancelar una espera retira su entrada y libera el cupo de cola', async () => {
  const gate = new CartAdmission({ active: 1, pending: 1, pendingPerUser: 1, waitMs: 1000 });
  const hold = Promise.withResolvers();
  const first = gate.run(1, signal, () => hold.promise);
  const cancellation = new AbortController();
  const pending = gate.run(2, cancellation.signal, async () => assert.fail('la espera cancelada no puede ejecutar trabajo'));
  const error = new Error('cancelado');
  cancellation.abort(error);
  await assert.rejects(pending, reason => reason === error);
  await assert.rejects(gate.run(2, cancellation.signal, async () => assert.fail('señal ya cancelada')), reason => reason === error);
  const next = gate.run(3, signal, async () => 3);
  hold.resolve();
  await first;
  assert.equal(await next, 3);
});

test('cancelar trabajo activo conserva el permiso hasta su salida, incluso si lanza una excepción', async () => {
  const gate = new CartAdmission({ active: 1, pending: 1, pendingPerUser: 1, waitMs: 1000 });
  const entered = Promise.withResolvers();
  const hold = Promise.withResolvers();
  const cancellation = new AbortController();
  const first = gate.run(1, cancellation.signal, () => {
    entered.resolve();
    return hold.promise;
  });
  await entered.promise;
  cancellation.abort();
  let ran = false;
  const next = gate.run(2, signal, async () => { ran = true; });
  await assert.rejects(gate.run(3, signal, async () => assert.fail('se liberó el activo antes de terminar')), conflict);
  assert.equal(ran, false);
  const failure = Error('excepción inesperada');
  hold.reject(failure);
  await assert.rejects(first, reason => reason === failure);
  await next;
  assert.equal(ran, true);
  assert.equal(await gate.run(1, signal, async () => 1), 1);
});
