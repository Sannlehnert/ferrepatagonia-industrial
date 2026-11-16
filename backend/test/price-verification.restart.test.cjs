require('./helpers/integration-lifecycle.cjs');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../dist/config/catalog-snapshot.config.js');
const { listPriceHistory } = require('../dist/services/pricing/price-verification.js');
const { MariaDbPricingSource } = require('../dist/repositories/pricing.source.js');

assert.match(process.env.DB_NAME || '', /^price_verification_test_[a-f0-9]{32}$/);
const RUN_ID = process.env.PRICE_VERIFICATION_RUN_ID;
assert.ok(RUN_ID && RUN_ID.length >= 16);

after(async () => { await pool.end(); });

test('T-S7-05.2: evidencia, auditoría y FER17 persisten tras reiniciar MariaDB', async () => {
  const sku = `T-S7-05-2-PERSIST-${RUN_ID}`;
  const [product] = await pool.query(
    `SELECT id_producto,precio FROM PRODUCTO WHERE codigo = ?`, [sku]);
  assert.ok(product, 'El producto de persistencia debe existir');
  assert.equal(product.precio, '88.88');

  const [evidence] = await pool.query(
    `SELECT precio_verificado,evidencia,valida,sintetica,id_admin
     FROM PRECIO_USD_EVIDENCIA WHERE id_producto = ?`, [product.id_producto]);
  assert.ok(evidence, 'La evidencia debe persistir');
  assert.equal(evidence.precio_verificado, '88.88');
  assert.equal(evidence.valida, 1);
  assert.equal(evidence.sintetica, 0);
  assert.match(evidence.evidencia, /FER-320-PERSIST/);

  const history = await listPriceHistory(Number(product.id_producto), 200);
  assert.equal(history.some(event => event.tipo === 'ALTA'), true);
  assert.equal(history.some(event => event.tipo === 'VERIFICACION' && event.evidencia === evidence.evidencia), true);

  const snapshot = await new MariaDbPricingSource().load(null, [Number(product.id_producto)], new Date());
  assert.equal(snapshot.products[0].baseVerified, true);
  assert.equal(snapshot.products[0].baseUSD, '88.88');
  assert.equal(snapshot.products[0].evidence.synthetic, false);
});
