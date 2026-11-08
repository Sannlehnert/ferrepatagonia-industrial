const assert = require('node:assert/strict');
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
let carts;
let pricing;
let orders;

before(async () => {
  session = await connectOwned(childProfile());
  await assertOwned(session);

  database = require('../dist/config/database.config.js');
  carts = require('../dist/repositories/accountOrderCart.repository.js');
  pricing = require('../dist/services/orders/account-order.pricing.js');
  orders = require('../dist/repositories/accountOrder.repository.js');

  await database.initializeDatabase();
});

after(async () => {
  try {
    await database?.destroyDatabase();
  } finally {
    await session?.connection.end();
  }
});

async function prepare(manager, f) {
  const cart = await carts.lockAccountOrderCart(
    manager,
    f.userId,
    f.clientId,
  );
  return pricing.quoteAccountOrderCart(manager, f.auth, cart);
}

const transaction = work => database.inTransaction(
  work,
  { isolation: 'READ COMMITTED' },
);

async function orderCount(clientId) {
  const [row] = await session.connection.query(
    'SELECT COUNT(*) AS cantidad FROM PEDIDO WHERE id_cliente = ?',
    [clientId],
  );
  return Number(row.cantidad);
}

test('#261: conserva importes y evidencia aunque cambie el catálogo', async () => {
  const f = await createOrderFixture(session, { discount: '20.00' });

  const orderId = await transaction(async manager => {
    const quote = await prepare(manager, f);
    return orders.persistAccountOrder(manager, f.clientId, quote);
  });

  const [order] = await session.connection.query(`
    SELECT subtotal, descuento, total, moneda_total
    FROM PEDIDO WHERE id_pedido = ?
  `, [orderId]);

  assert.deepEqual(
    [order.subtotal, order.descuento, order.total, order.moneda_total],
    ['20.00', '4.00', '16.00', 'USD'],
  );

  const readDetail = async () => {
    const [row] = await session.connection.query(`
      SELECT d.precio_unitario, d.descuento, d.subtotal, e.snapshot_json
      FROM DETALLE_PEDIDO d
      INNER JOIN DETALLE_PEDIDO_CC_PRECIO e
        ON e.id_detalle_pedido = d.id_detalle_pedido
      WHERE d.id_pedido = ?
    `, [orderId]);
    return row;
  };

  const original = await readDetail();

  assert.deepEqual(
    [original.precio_unitario, original.descuento, original.subtotal],
    ['10.00', '4.00', '16.00'],
  );

  const snapshot = JSON.parse(original.snapshot_json);
  assert.equal(snapshot.producto.precioUnitarioUSD, '8.00');
  assert.equal(snapshot.producto.descuentoAplicado, '20.00');
  assert.equal(snapshot.regla, 'FER17-v1');

  await session.connection.query(
    'UPDATE PRODUCTO SET precio = 99 WHERE id_producto = ?',
    [f.productId],
  );
  await session.connection.query(
    'UPDATE LISTA_PRECIO SET porcentaje_descuento = 50 WHERE id_lista_precio = ?',
    [f.listId],
  );

  assert.deepEqual(await readDetail(), original);
});

test('#261: rechaza un total que no coincide con sus detalles', async () => {
  const f = await createOrderFixture(session);

  await assert.rejects(
    transaction(async manager => {
      const quote = await prepare(manager, f);
      await orders.persistAccountOrder(
        manager,
        f.clientId,
        { ...quote, totalUSD: '0.01' },
      );
    }),
    error => error.code === 'IMPORTE_PEDIDO_INVALIDO',
  );

  assert.equal(await orderCount(f.clientId), 0);
});

test('#261: rollback revierte pedido, detalles y evidencia', async () => {
  const f = await createOrderFixture(session);
  let detailId;

  await assert.rejects(
    transaction(async manager => {
      const quote = await prepare(manager, f);
      const orderId = await orders.persistAccountOrder(
        manager,
        f.clientId,
        quote,
      );

      const [detail] = await manager.query(
        'SELECT id_detalle_pedido FROM DETALLE_PEDIDO WHERE id_pedido = ?',
        [orderId],
      );
      detailId = detail.id_detalle_pedido;

      throw new Error('FALLO_SIMULADO_261');
    }),
    /FALLO_SIMULADO_261/,
  );

  assert.equal(await orderCount(f.clientId), 0);
  assert.ok(detailId);

  for (const table of ['DETALLE_PEDIDO', 'DETALLE_PEDIDO_CC_PRECIO']) {
    const [row] = await session.connection.query(
      `SELECT COUNT(*) AS cantidad FROM ${table} WHERE id_detalle_pedido = ?`,
      [detailId],
    );
    assert.equal(Number(row.cantidad), 0);
  }
});