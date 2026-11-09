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
let transaction;
let financial;

before(async () => {
  session = await connectOwned(childProfile());
  await assertOwned(session);

  database = require('../dist/config/database.config.js');
  attempts = require(
    '../dist/repositories/accountOrderAttempt.repository.js'
  );
  transaction = require(
    '../dist/services/orders/account-order.transaction.js'
  );
  financial = require(
    '../dist/repositories/cuentaCorriente.repository.js'
  );

  await database.initializeDatabase();
});

after(async () => {
  try {
    await database?.destroyDatabase();
  } finally {
    await session?.connection.end();
  }
});

async function fixture(options) {
  const f = await createOrderFixture(session, options);
  f.key = randomUUID();
  await attempts.reserveAccountOrderAttempt(f.clientId, f.key);
  return f;
}

function buy(f, key = f.key) {
  return database.inTransaction(
    manager => transaction.executePendingAccountOrder(
      manager, f.auth, f.clientId, key,
    ),
    { isolation: 'READ COMMITTED', lockWaitSeconds: 2 },
  );
}

async function snapshot(f) {
  const db = session.connection;
  const count = async (sql, values) =>
    Number((await db.query(sql, values))[0].cantidad);

  const [product] = await db.query(
    'SELECT stock FROM PRODUCTO WHERE id_producto = ?',
    [f.productId],
  );

  return {
    orders: await count(
      'SELECT COUNT(*) cantidad FROM PEDIDO WHERE id_cliente = ?',
      [f.clientId],
    ),
    charges: await count(`
      SELECT COUNT(*) cantidad FROM MOVIMIENTO_CUENTA_CORRIENTE
      WHERE id_cuenta_corriente = ? AND tipo_movimiento = 'CARGO'
    `, [f.accountId]),
    allocations: await count(`
      SELECT COUNT(*) cantidad FROM IMPUTACION_MOVIMIENTO_CUENTA
      WHERE id_cuenta_corriente = ? AND estado = 'VIGENTE'
    `, [f.accountId]),
    stock: product.stock,
    lines: await count(
      'SELECT COUNT(*) cantidad FROM ITEM_CARRITO WHERE id_carrito = ?',
      [f.cartId],
    ),
    state: (await attempts.findAccountOrderAttempt(
      f.clientId, f.key,
    )).state,
  };
}

const untouched = {
  orders: 0,
  charges: 0,
  allocations: 0,
  stock: 5,
  lines: 1,
  state: 'PENDIENTE',
};

test('#261: confirma al límite exacto y registra todos los cambios', async () => {
  const f = await fixture({ limit: '20.00' });
  const result = await buy(f);

  assert.equal(result.status, 201);
  assert.equal(result.body.data.totalUSD, '20.00');
  assert.equal(result.body.data.estado, 'CONFIRMADO');

  assert.deepEqual(await snapshot(f), {
    orders: 1,
    charges: 1,
    allocations: 0,
    stock: 3,
    lines: 0,
    state: 'CONFIRMADO',
  });

  const state = await financial.calcularEstadoCuenta(f.accountId);
  assert.equal(state.deuda_vigente, '20.00');
  assert.equal(state.credito_disponible, '0.00');
});

test('#261: crédito insuficiente no deja escrituras parciales', async () => {
  const f = await fixture({ limit: '19.99' });

  await assert.rejects(
    buy(f),
    error => error.code === 'CREDITO_INSUFICIENTE',
  );

  assert.deepEqual(await snapshot(f), untouched);
});

test('#261: un saldo desconocido no se interpreta como cero', async () => {
  const f = await fixture();

  await session.connection.query(`
    UPDATE CUENTA_CORRIENTE SET cobertura = 'NO_ACREDITADA'
    WHERE id_cuenta_corriente = ?
  `, [f.accountId]);

  await assert.rejects(
    buy(f),
    error => error.code === 'CREDITO_NO_VERIFICADO',
  );

  assert.deepEqual(await snapshot(f), untouched);
});

test('#261: empresa pendiente de aprobación no confirma', async () => {
  const f = await fixture();

  await session.connection.query(`
    UPDATE CLIENTE SET estado_aprobacion_empresa = 'PENDIENTE'
    WHERE id_cliente = ?
  `, [f.clientId]);

  await assert.rejects(
    buy(f),
    error => error.code === 'EMPRESA_NO_HABILITADA',
  );

  assert.deepEqual(await snapshot(f), untouched);
});

test('#261: un fallo tardío revierte también el cargo y FIFO', async () => {
  const f = await fixture();

  const payment = await session.connection.query(`
    INSERT INTO PAGO (
      id_cuenta_corriente, monto, metodo_pago, estado,
      moneda, fecha_acreditacion_utc, evidencia_acreditacion
    ) VALUES (
      ?, 5, 'TRANSFERENCIA', 'ACREDITADO', 'USD',
      UTC_TIMESTAMP(3) - INTERVAL 1 SECOND, 'DEMO #261'
    )
  `, [f.accountId]);

  await financial.registrarAbonoPorPago({
    id_cuenta_corriente: f.accountId,
    id_pago: Number(payment.insertId),
    monto: '5.00',
  });

  await assertOwned(session);
  await session.connection.query(`
    CREATE TRIGGER order261_fail_delete
    BEFORE DELETE ON ITEM_CARRITO
    FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FALLO_TARDIO_261'
  `);

  try {
    await assert.rejects(buy(f), /FALLO_TARDIO_261/);
  } finally {
    await session.connection.query('DROP TRIGGER order261_fail_delete');
  }

  assert.deepEqual(await snapshot(f), untouched);
  assert.equal(
    (await financial.calcularEstadoCuenta(f.accountId)).deuda_vigente,
    '-5.00',
  );

  await buy(f);

  const final = await snapshot(f);
  assert.equal(final.orders, 1);
  assert.equal(final.charges, 1);
  assert.equal(final.allocations, 1);
  assert.equal(final.stock, 3);
  assert.equal(final.lines, 0);
  assert.equal(final.state, 'CONFIRMADO');

  assert.equal(
    (await financial.calcularEstadoCuenta(f.accountId)).deuda_vigente,
    '15.00',
  );
});

test('#261: dos confirmaciones no compran dos veces el mismo carrito', async () => {
  const f = await fixture({ limit: '20.00' });
  const secondKey = randomUUID();

  await attempts.reserveAccountOrderAttempt(f.clientId, secondKey);

  const outcomes = await Promise.allSettled([
    buy(f),
    buy(f, secondKey),
  ]);

  assert.equal(
    outcomes.filter(result => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    outcomes.find(result => result.status === 'rejected').reason.code,
    'CARRITO_VACIO',
  );

  const final = await snapshot(f);
  assert.equal(final.orders, 1);
  assert.equal(final.charges, 1);
  assert.equal(final.stock, 3);
  assert.equal(final.lines, 0);

  const credit = await financial.calcularEstadoCuenta(f.accountId);
  assert.equal(credit.deuda_vigente, '20.00');
  assert.equal(credit.credito_disponible, '0.00');
});