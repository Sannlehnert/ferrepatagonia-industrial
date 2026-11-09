const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test, before, after } = require('node:test');
const {
  childProfile,
  connectOwned,
  assertOwned,
} = require('./helpers/cc260-disposable.cjs');

let session;
let database;
let cartRepository;

before(async () => {
  session = await connectOwned(childProfile());
  await assertOwned(session);

  database = require('../dist/config/database.config.js');
  cartRepository = require(
    '../dist/repositories/accountOrderCart.repository.js'
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

async function fixture({
  stock = 5,
  quantity = 2,
  active = 1,
  categoryActive = 1,
  empty = false,
} = {}) {
  await assertOwned(session);
  const db = session.connection;
  const insert = async (sql, values) =>
    Number((await db.query(sql, values)).insertId);

  const clientId = await insert(`
    INSERT INTO CLIENTE (
      tipo_cliente, nombre_razon_social,
      estado_aprobacion_empresa, es_fiel, activo
    ) VALUES ('EMPRESA', 'DEMO carrito #261', 'APROBADA', 0, 1)
  `);

  const userId = await insert(`
    INSERT INTO USUARIO (
      id_cliente, email, password_hash, rol, activo
    ) VALUES (?, ?, 'fixture-no-login', 'CLIENTE', 1)
  `, [clientId, `${randomUUID()}@example.test`]);

  const categoryId = await insert(`
    INSERT INTO CATEGORIA (nombre, activo)
    VALUES ('DEMO #261', ?)
  `, [categoryActive]);

  const productId = await insert(`
    INSERT INTO PRODUCTO (
      id_categoria, codigo, nombre, precio, stock, activo
    ) VALUES (?, ?, 'DEMO #261', 10, ?, ?)
  `, [categoryId, randomUUID(), stock, active]);

  const cartId = await insert(
    'INSERT INTO CARRITO (id_cliente) VALUES (?)',
    [clientId],
  );

  if (!empty) {
    await insert(`
      INSERT INTO ITEM_CARRITO (
        id_carrito, id_producto, cantidad
      ) VALUES (?, ?, ?)
    `, [cartId, productId, quantity]);
  }

  return { clientId, userId, productId, cartId };
}

const transaction = work => database.inTransaction(
  work,
  { isolation: 'READ COMMITTED' },
);

const lock = (manager, f) => cartRepository.lockAccountOrderCart(
  manager,
  f.userId,
  f.clientId,
);

async function remaining(f) {
  const [product] = await session.connection.query(
    'SELECT stock FROM PRODUCTO WHERE id_producto = ?',
    [f.productId],
  );
  const [items] = await session.connection.query(`
    SELECT COUNT(*) AS cantidad
    FROM ITEM_CARRITO WHERE id_carrito = ?
  `, [f.cartId]);

  return { stock: product.stock, lines: Number(items.cantidad) };
}

test('#261: consultar el carrito bloqueado no consume stock', async () => {
  const f = await fixture();
  const cart = await transaction(manager => lock(manager, f));

  assert.equal(cart.cartId, f.cartId);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].quantity, 2);
  assert.deepEqual(await remaining(f), { stock: 5, lines: 1 });
});

test('#261: rechaza un carrito vacío', async () => {
  const f = await fixture({ empty: true });

  await assert.rejects(
    transaction(manager => lock(manager, f)),
    error => error.code === 'CARRITO_VACIO',
  );
});

for (const [options, code] of [
  [{ active: 0 }, 'PRODUCTO_INACTIVO'],
  [{ categoryActive: 0 }, 'CATEGORIA_INACTIVA'],
  [{ stock: 1 }, 'STOCK_INSUFICIENTE'],
]) {
  test(`#261: rechaza ${code} sin consumir el carrito`, async () => {
    const f = await fixture(options);

    await assert.rejects(
      transaction(manager => lock(manager, f)),
      error => error.code === code,
    );

    assert.deepEqual(await remaining(f), {
      stock: options.stock ?? 5,
      lines: 1,
    });
  });
}

test('#261: rollback recupera stock y líneas; commit los consume', async () => {
  const f = await fixture();

  await assert.rejects(
    transaction(async manager => {
      const cart = await lock(manager, f);
      await cartRepository.consumeAccountOrderCart(manager, cart);
      throw new Error('FALLO_SIMULADO_261');
    }),
    /FALLO_SIMULADO_261/,
  );

  assert.deepEqual(await remaining(f), { stock: 5, lines: 1 });

  await transaction(async manager => {
    const cart = await lock(manager, f);
    await cartRepository.consumeAccountOrderCart(manager, cart);
  });

  assert.deepEqual(await remaining(f), { stock: 3, lines: 0 });
});

test('#261: dos carritos no consumen la misma última unidad', async () => {
  const first = await fixture({ stock: 1, quantity: 1 });
  const second = await fixture({ stock: 1, quantity: 1 });

  await session.connection.query(`
    UPDATE ITEM_CARRITO SET id_producto = ?
    WHERE id_carrito = ?
  `, [first.productId, second.cartId]);

  const buy = f => transaction(async manager => {
    const cart = await lock(manager, f);
    await cartRepository.consumeAccountOrderCart(manager, cart);
  });

  const outcomes = await Promise.allSettled([
    buy(first),
    buy(second),
  ]);

  assert.equal(
    outcomes.filter(result => result.status === 'fulfilled').length,
    1,
  );

  const failure = outcomes.find(result => result.status === 'rejected');
  assert.equal(failure.reason.code, 'STOCK_INSUFICIENTE');

  assert.equal((await remaining(first)).stock, 0);
  const lines =
    (await remaining(first)).lines +
    (await remaining(second)).lines;
  assert.equal(lines, 1);
});