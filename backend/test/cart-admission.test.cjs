const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CartAdmission } = require('../dist/services/cart.admission');

const conflict = { status: 409, code: 'CONFLICTO_CARRITO' };
const signal = new AbortController().signal;
const run = (gate, id, work, requestSignal = signal) => gate.run(requestSignal, async () => ({ id }), work);

test('admisión respeta FIFO por usuario sin bloquear a otro cliente elegible', async () => {
  const gate = new CartAdmission({ active: 2, pending: 3, pendingPerUser: 2, waitMs: 1000 });
  const hold = Promise.withResolvers();
  const events = [];
  const first = run(gate, 1, () => hold.promise);
  const second = run(gate, 1, async () => events.push('A2'));
  await Promise.resolve(); // the second request has authenticated and parked
  const third = run(gate, 1, async () => events.push('A3'));
  await Promise.resolve();
  await assert.rejects(run(gate, 1, async () => assert.fail('excedió cupo por usuario')), conflict);
  await run(gate, 2, async () => events.push('B1'));
  assert.deepEqual(events, ['B1']);
  hold.resolve();
  await Promise.all([first, second, third]);
  assert.deepEqual(events, ['B1', 'A2', 'A3']);
});

test('admisión limita activos y pendientes globales, y descarta la espera vencida', async () => {
  const gate = new CartAdmission({ active: 3, pending: 1, pendingPerUser: 2, waitMs: 30 });
  const hold = Promise.withResolvers();
  const first = run(gate, 1, () => hold.promise);
  const second = run(gate, 2, () => hold.promise);
  const pending = run(gate, 1, async () => assert.fail('la espera vencida no puede ejecutar trabajo'));
  await Promise.resolve();
  await assert.rejects(run(gate, 2, async () => assert.fail('excedió cupo global de cola')), conflict);
  await assert.rejects(pending, conflict);
  const next = run(gate, 3, async () => 3);
  hold.resolve();
  await Promise.all([first, second]);
  assert.equal(await next, 3);
});

test('cancelar una espera retira su entrada y libera el cupo de cola', async () => {
  const gate = new CartAdmission({ active: 2, pending: 1, pendingPerUser: 1, waitMs: 1000 });
  const hold = Promise.withResolvers();
  const first = run(gate, 1, () => hold.promise);
  const cancellation = new AbortController();
  const pending = run(gate, 1, async () => assert.fail('la espera cancelada no puede ejecutar trabajo'), cancellation.signal);
  await Promise.resolve();
  const error = new Error('cancelado');
  cancellation.abort(error);
  await assert.rejects(pending, reason => reason === error);
  await assert.rejects(run(gate, 1, async () => assert.fail('señal ya cancelada'), cancellation.signal), reason => reason === error);
  const next = run(gate, 1, async () => 3);
  hold.resolve();
  await first;
  assert.equal(await next, 3);
});

test('cancelar trabajo activo conserva el permiso hasta su salida, incluso si lanza una excepción', async () => {
  const gate = new CartAdmission({ active: 2, pending: 1, pendingPerUser: 1, waitMs: 1000 });
  const entered = Promise.withResolvers();
  const hold = Promise.withResolvers();
  const cancellation = new AbortController();
  const first = run(gate, 1, () => {
    entered.resolve();
    return hold.promise;
  }, cancellation.signal);
  await entered.promise;
  cancellation.abort();
  let ran = false;
  const next = run(gate, 1, async () => { ran = true; });
  await Promise.resolve();
  await assert.rejects(run(gate, 1, async () => assert.fail('se liberó el activo antes de terminar')), conflict);
  assert.equal(ran, false);
  const failure = Error('excepción inesperada');
  hold.reject(failure);
  await assert.rejects(first, reason => reason === failure);
  await next;
  assert.equal(ran, true);
  assert.equal(await run(gate, 1, async () => 1), 1);
});

test('admisión rechaza antes de identificar y conserva el cupo al desconectar durante Passport', async () => {
  const gate = new CartAdmission({ active: 1, pending: 1, pendingPerUser: 1, waitMs: 1000 });
  const lookup = Promise.withResolvers();
  const cancellation = new AbortController();
  const aborted = new Error('desconectado');
  const first = gate.run(cancellation.signal, () => lookup.promise, async () => assert.fail('trabajo cancelado'));
  cancellation.abort(aborted);
  await assert.rejects(gate.run(signal, async () => assert.fail('Passport se ejecutó sin cupo'),
    async () => assert.fail('trabajo sin cupo')), conflict);
  lookup.resolve({ id: 1 });
  await assert.rejects(first, error => error === aborted);
  assert.equal(await run(gate, 1, async () => 'recuperado'), 'recuperado');
});

test('denegaciones de autenticación y excepciones liberan el cupo previo a Passport', async () => {
  const gate = new CartAdmission({ active: 1, pending: 1, pendingPerUser: 1, waitMs: 1000 });
  const work = async () => assert.fail('una sesión denegada no puede ejecutar el carrito');
  const fault = Error('fallo de autenticación');
  await gate.run(signal, async () => undefined, work);
  await assert.rejects(gate.run(signal, async () => { throw fault; }, work), reason => reason === fault);
  assert.equal(await run(gate, 2, async () => 2), 2);
});

test('consultar un resultado no espera al trabajo activo del mismo usuario', async () => {
  const gate = new CartAdmission({
    active: 2,
    pending: 1,
    pendingPerUser: 1,
    waitMs: 1000,
  });

  const entered = Promise.withResolvers();
  const hold = Promise.withResolvers();

  const purchase = run(gate, 1, async () => {
    entered.resolve();
    await hold.promise;
  });

  await entered.promise;

  try {
    const result = await gate.run(
      signal,
      async () => ({ id: 1 }),
      async () => {
        await assert.rejects(
          gate.run(
            signal,
            async () => assert.fail('identificó sin cupo disponible'),
            async () => assert.fail('ejecutó sin cupo disponible'),
            { serializePerUser: false },
          ),
          conflict,
        );

        return 'PENDIENTE';
      },
      { serializePerUser: false },
    );

    assert.equal(result, 'PENDIENTE');
  } finally {
    hold.resolve();
    await purchase;
  }

  assert.equal(await run(gate, 1, async () => 'liberado'), 'liberado');
});