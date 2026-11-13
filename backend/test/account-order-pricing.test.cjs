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
let cartRepository;
let pricing;

before(async () => {
  session = await connectOwned(childProfile());
  await assertOwned(session);

  database = require('../dist/config/database.config.js');
  cartRepository = require(
    '../dist/repositories/accountOrderCart.repository.js'
  );
  pricing = require(
    '../dist/services/orders/account-order.pricing.js'
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

function quote(f, auth = f.auth) {
  return database.inTransaction(async manager => {
    const cart = await cartRepository.lockAccountOrderCart(
      manager,
      f.userId,
      f.clientId,
    );
    return pricing.quoteAccountOrderCart(manager, auth, cart);
  }, { isolation: 'READ COMMITTED' });
}

test('#261: aplica la lista del cliente usando precios verificados', async () => {
  const f = await createOrderFixture(session, { discount: '20.00' });
  const result = await quote(f);

  assert.equal(result.totalUSD, '16.00');
  assert.equal(result.lines[0].precioUnitarioUSD, '8.00');
  assert.equal(result.lines[0].descuentoAplicado, '20.00');
  assert.equal(result.lines[0].origenDescuento, 'LISTA');

  const [product] = await session.connection.query(
    'SELECT stock FROM PRODUCTO WHERE id_producto = ?',
    [f.productId],
  );
  assert.equal(product.stock, 5);
});

for (const [options, code] of [
  [{ price: null }, 'PRECIO_AUSENTE'],
  [{ price: '0.00' }, 'BASE_CERO'],
  [{ verified: false }, 'BASE_NO_VERIFICADA'],
  [{ synthetic: true }, 'PRECIO_SINTETICO'],
]) {
  test(`#261: no permite comprar con ${code}`, async () => {
    const f = await createOrderFixture(session, options);

    await assert.rejects(
      quote(f),
      error => error.code === code && error.status === 422,
    );
  });
}

test('#261: no cotiza un carrito con la identidad de otro cliente', async () => {
  const first = await createOrderFixture(session);
  const second = await createOrderFixture(session);

  await assert.rejects(
    quote(first, second.auth),
    error => error.code === 'CLIENTE_NO_HABILITADO',
  );
});