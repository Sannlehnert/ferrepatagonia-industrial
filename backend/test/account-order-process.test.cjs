const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test, before, after } = require('node:test');

const {
  childProfile,
  connectOwned,
  assertOwned,
} = require('./helpers/cc260-disposable.cjs');

const {
  createOrderFixture,
} = require('./helpers/account-order.fixture.cjs');

let session;

before(async () => {
  session = await connectOwned(childProfile());
  await assertOwned(session);
});

after(async () => {
  await session?.connection.end();
});

function execute(mode, fixture, key, expectedExit) {
  const result = spawnSync(process.execPath, [
    '--require',
    path.join(__dirname, 'helpers/test-env.cjs'),
    path.join(__dirname, 'helpers/account-order-process.cjs'),
    mode,
    String(fixture.userId),
    String(fixture.clientId),
    key,
  ], {
    env: { ...process.env },
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });

  assert.ifError(result.error);
  assert.equal(
    result.status,
    expectedExit,
    `Proceso ${mode}: ${result.stderr}\n${result.stdout}`,
  );

  return result.stdout;
}

async function persistedState(fixture, key) {
  const [attempt] = await session.connection.query(`
    SELECT estado FROM CONFIRMACION_PEDIDO_CC
    WHERE id_cliente = ? AND clave = ?
  `, [fixture.clientId, key]);

  const [orders] = await session.connection.query(`
    SELECT COUNT(*) cantidad
    FROM PEDIDO WHERE id_cliente = ?
  `, [fixture.clientId]);

  const [product] = await session.connection.query(
    'SELECT stock FROM PRODUCTO WHERE id_producto = ?',
    [fixture.productId],
  );

  return {
    state: attempt?.estado,
    orders: Number(orders.cantidad),
    stock: Number(product.stock),
  };
}

for (const mode of ['before-commit', 'after-commit']) {
  test(`#261: recupera en otro proceso una caída ${mode}`, async () => {
    const fixture = await createOrderFixture(session);
    const key = randomUUID();
    const committed = mode === 'after-commit';

    execute(mode, fixture, key, committed ? 86 : 87);

    assert.deepEqual(await persistedState(fixture, key), {
      state: committed ? 'CONFIRMADO' : 'PENDIENTE',
      orders: committed ? 1 : 0,
      stock: committed ? 3 : 5,
    });

    const result = JSON.parse(
      execute('recover', fixture, key, 0).trim(),
    );

    assert.equal(result.previous.status, committed ? 200 : 202);
    assert.equal(result.confirmed.status, committed ? 200 : 201);
    assert.equal(result.recovered.status, 200);

    assert.deepEqual(
      result.recovered.body,
      result.confirmed.body,
    );

    if (committed) {
      assert.deepEqual(
        result.previous.body,
        result.confirmed.body,
      );
    }

    assert.deepEqual(await persistedState(fixture, key), {
      state: 'CONFIRMADO',
      orders: 1,
      stock: 3,
    });

    const [charges] = await session.connection.query(`
      SELECT COUNT(*) cantidad
      FROM MOVIMIENTO_CUENTA_CORRIENTE
      WHERE id_cuenta_corriente = ? AND tipo_movimiento = 'CARGO'
    `, [fixture.accountId]);

    assert.equal(Number(charges.cantidad), 1);
  });
}