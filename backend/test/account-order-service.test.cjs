const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
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
let database;
let attempts;
let service;

before(async () => {
  session = await connectOwned(childProfile());
  await assertOwned(session);

  database = require('../dist/config/database.config.js');
  attempts = require(
    '../dist/repositories/accountOrderAttempt.repository.js'
  );
  service = require('../dist/services/orders/account-order.service.js');

  await database.initializeDatabase();
});

after(async () => {
  try {
    await database?.destroyDatabase();
  } finally {
    await session?.connection.end();
  }
});

async function countOrders(f) {
  const [row] = await session.connection.query(
    'SELECT COUNT(*) cantidad FROM PEDIDO WHERE id_cliente = ?',
    [f.clientId],
  );
  return Number(row.cantidad);
}

test('#261: repetir y consultar devuelve el mismo pedido histórico', async () => {
  const f = await createOrderFixture(session);
  const key = randomUUID();

  const first = await service.confirmAccountOrder(f.auth, key);
  assert.equal(first.status, 201);

  await session.connection.query(
    'UPDATE PRODUCTO SET precio = 99 WHERE id_producto = ?',
    [f.productId],
  );
  await session.connection.query(
    'UPDATE CUENTA_CORRIENTE SET habilitada = 0 WHERE id_cuenta_corriente = ?',
    [f.accountId],
  );

  const repeated = await service.confirmAccountOrder(f.auth, key);
  const recovered = await service.getAccountOrderResult(f.auth, key);

  assert.equal(repeated.status, 200);
  assert.deepEqual(repeated.body, first.body);
  assert.deepEqual(recovered, repeated);
  assert.equal(await countOrders(f), 1);

  const other = await createOrderFixture(session);
  assert.equal(
    (await service.getAccountOrderResult(other.auth, key)).status,
    404,
  );
});

test('#261: conserva el rechazo aunque después aumente el crédito', async () => {
  const f = await createOrderFixture(session, { limit: '1.00' });
  const key = randomUUID();

  const first = await service.confirmAccountOrder(f.auth, key);
  assert.equal(first.status, 409);
  assert.equal(first.body.code, 'CREDITO_INSUFICIENTE');

  await session.connection.query(
    'UPDATE CUENTA_CORRIENTE SET limite_credito = 1000 WHERE id_cuenta_corriente = ?',
    [f.accountId],
  );

  assert.deepEqual(
    await service.confirmAccountOrder(f.auth, key),
    first,
  );
  assert.equal(await countOrders(f), 0);
});

test('#261: dos solicitudes con la misma clave generan una sola compra', async () => {
  const f = await createOrderFixture(session);
  const key = randomUUID();

  const responses = await Promise.all([
    service.confirmAccountOrder(f.auth, key),
    service.confirmAccountOrder(f.auth, key),
  ]);

  assert.deepEqual(
    responses.map(result => result.status).sort(),
    [200, 201],
  );
  assert.deepEqual(responses[0].body, responses[1].body);
  assert.equal(await countOrders(f), 1);
});

test('#261: consulta pendiente devuelve 202 y permite recuperar el intento', async () => {
  const f = await createOrderFixture(session);
  const key = randomUUID();
  await attempts.reserveAccountOrderAttempt(f.clientId, key);

  const runner = database.dataSource.createQueryRunner();
  await runner.connect();

  try {
    await runner.startTransaction('READ COMMITTED');
    await attempts.lockAccountOrderAttempt(
      runner.manager, f.clientId, key,
    );

    const pending = await service.getAccountOrderResult(f.auth, key);
    assert.equal(pending.status, 202);
    assert.equal(pending.body.data.estado, 'PENDIENTE');
    assert.equal(await countOrders(f), 0);
  } finally {
    try {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
    } finally {
      await runner.release();
    }
  }

  assert.equal(
    (await service.confirmAccountOrder(f.auth, key)).status,
    201,
  );
  assert.equal(await countOrders(f), 1);
});

test('#261: COMMIT ejecutado con acuse perdido recupera el resultado real', async t => {
  const f = await createOrderFixture(session);
  const key = randomUUID();
  let dropped = false;
  const createRunner = database.dataSource.createQueryRunner
    .bind(database.dataSource);

  t.mock.method(database.dataSource, 'createQueryRunner', (...args) => {
    const runner = createRunner(...args);
    const commit = runner.commitTransaction.bind(runner);

    runner.commitTransaction = async () => {
      const rootTransaction = runner.transactionDepth === 1;
      await commit();

      if (!rootTransaction || dropped) return;

      const [row] = await session.connection.query(`
        SELECT estado FROM CONFIRMACION_PEDIDO_CC
        WHERE id_cliente = ? AND clave = ?
      `, [f.clientId, key]);

      if (row?.estado === 'CONFIRMADO') {
        dropped = true;
        throw new Error('ACUSE_COMMIT_PERDIDO_261');
      }
    };

    return runner;
  });

  const result = await service.confirmAccountOrder(f.auth, key);

  assert.equal(dropped, true);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.estado, 'CONFIRMADO');
  assert.equal(await countOrders(f), 1);

  const repeated = await service.confirmAccountOrder(f.auth, key);
  assert.deepEqual(repeated, result);
  assert.equal(await countOrders(f), 1);

  const [product] = await session.connection.query(
    'SELECT stock FROM PRODUCTO WHERE id_producto = ?',
    [f.productId],
  );
  assert.equal(product.stock, 3);
});