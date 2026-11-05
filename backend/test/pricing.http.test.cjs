const assert = require('node:assert/strict');
const { test, before, after, beforeEach } = require('node:test');
const { once } = require('node:events');
const express = require('express');
const cookieParser = require('cookie-parser');
process.env.JWT_SECRET = 'pricing-http-test-only-secret';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_NAME = 'pricing_http_test';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
const { createPricingRouter } = require('../dist/routes/pricing.routes');
const { PricingService } = require('../dist/services/pricing/pricing.service');
const { signToken } = require('../dist/services/token.service');
const users = require('../dist/repositories/usuario.repository');
const { sessionRow } = require('./helpers/session-fixture.cjs');
const { app: productionApp } = require('../dist/app');
const { pool } = require('../dist/config/catalog-snapshot.config');
let server, url, calls, broken;
const source = {
  async load(userId, ids) {
    calls.push({ userId, ids });
    if (broken) throw Error('SQL password=secret internal-stack SELECT private-list');
    return { client: userId === null ? null : { usuarioId: userId, clienteId: userId + 100,
      active: true, assignedListId: userId === 12 ? null : 4,
      list: userId === 12 ? null : { id: 4, active: true, percent: userId === 13 ? '15' : '10' } },
      products: [{ id: 7, baseUSD: '100.00', specialPercent: '5' }], calendar: null, quote: null };
  },
  async recordInactiveList() {},
};
before(async () => {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api', createPricingRouter(new PricingService(source)));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = `http://127.0.0.1:${server.address().port}/api`;
});
beforeEach(t => {
  calls = []; broken = false;
  t.mock.method(users, 'findUsuarioById', async id => sessionRow(id, id === 99 ? 'ADMIN' : 'CLIENTE'));
});
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });
const body = { moneda: 'USD', productos: [{ productoId: 7, cantidad: 1 }] };
const request = (path, userId, payload = body) => fetch(`${url}${path}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(userId === undefined ? {} : {
    Cookie: `jwt_token=${signToken({ id: userId, rol: userId === 99 ? 'ADMIN' : 'CLIENTE' })}` }) },
  body: JSON.stringify(payload) });
test('middleware real exige sesión y rol CLIENTE', async () => {
  for (const [id, status] of [[undefined, 401], [99, 403]]) {
    const response = await request('/precios/mios', id);
    assert.equal(response.status, status);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
  assert.equal(calls.length, 0);
});
test('precios propios, sin lista y aislamiento consecutivo de usuarios', async () => {
  for (const [id, amount] of [[11, '90.00'], [12, '95.00'], [13, '85.00'], [11, '90.00']]) {
    const response = await request('/precios/mios', id);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.totalUSD, amount);
    assert.match(response.headers.get('cache-control'), /private, no-store/);
    assert.match(response.headers.get('vary'), /Cookie/);
    assert.equal(calls.at(-1).userId, id);
  }
});
for (const field of ['listaId', 'clienteId', 'precioBaseUSD', 'descuentoAplicado']) {
  test(`HTTP rechaza ${field} en body y query`, async () => {
    for (const [path, payload] of [['/precios/mios', { ...body, [field]: 999 }],
      [`/precios/mios?${field}=999`, body], ['/precios/mios', { ...body,
        productos: [{ ...body.productos[0], [field]: 999 }] }]]) {
      const response = await request(path, 11, payload);
      assert.equal(response.status, 400);
    }
    assert.equal(calls.length, 0);
  });
}
test('no existe ruta para consultar otro cliente', async () => {
  assert.equal((await request('/precios/mios/999', 11)).status, 404);
  assert.equal(calls.length, 0);
});
test('público con y sin cookie siempre recibe precio general sin lista ni cliente', async () => {
  for (const userId of [undefined, 11, 13]) {
    const response = await request('/precios', userId);
    const result = (await response.json()).data;
    assert.equal(result.totalUSD, '95.00');
    assert.equal(result.productos[0].origenDescuento, 'ESPECIAL_PUBLICO');
    assert.ok(!/clienteId|listaId|LISTA|porcentaje_descuento/.test(JSON.stringify(result)));
    assert.equal(calls.at(-1).userId, null);
  }
});
test('fallo operativo no filtra SQL, credenciales ni stack', async () => {
  broken = true;
  const response = await request('/precios/mios', 11);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { message: 'Error interno del servidor.' });
});
test('ARS sin calendario devuelve error comercial controlado', async () => {
  const response = await request('/precios/mios', 11, { ...body, moneda: 'ARS' });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, 'CALENDARIO_NO_VERIFICADO');
});
test('aplicación real monta el router con fuente productiva, sin base simulada', async () => {
  const realServer = productionApp.listen(0, '127.0.0.1');
  await once(realServer, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${realServer.address().port}/api/precios`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: process.env.APP_PUBLIC_ORIGIN }, body: JSON.stringify(body) });
    assert.equal(response.status, 500); // No DB initialized in this unit process.
  } finally { await new Promise(resolve => realServer.close(resolve)); }
});
