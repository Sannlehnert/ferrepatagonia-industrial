const { before, beforeEach, after } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { childProfile, connectOwned, assertDatabaseOptions } = require('./account-disposable.cjs');
const { seedDemo, clearDemo, demoOrder, demoPayment } = require('../../../database/fixtures/fer19-demo.cjs');

function accountContext() {
  const ctx = {};
  before(async () => {
    const profile = childProfile();
    for (let attempt = 0; ; attempt++) {
      try {
        ctx.session = await connectOwned(profile);
        break;
      } catch (error) {
        if (error.code !== 'ER_CONNECTION_TIMEOUT' || attempt === 4) throw error;
        await delay(250);
      }
    }
    ctx.db = ctx.session.connection;
    ctx.database = require('../../dist/config/database.config');
    assertDatabaseOptions(ctx.session, ctx.database.dataSource);
    ctx.repo = require('../../dist/repositories/cuentaCorriente.repository');
    await ctx.database.dataSource.initialize();
  });
  beforeEach(async () => {
    await clearDemo(ctx.session);
    ctx.fixture = await seedDemo(ctx.session);
    ctx.a = ctx.fixture.clients.empresa30;
  });
  after(async () => {
    try { if (ctx.database) await ctx.database.destroyDatabase(); }
    finally { await ctx.db?.end(); }
  });
  ctx.order = (client = ctx.a, amount = '1.00') => demoOrder(ctx.db, client, amount);
  ctx.payment = (client, amount, options) => demoPayment(ctx.db, client, amount, options);
  ctx.charge = async (client, amount, extra = {}) => ctx.repo.registrarCargoPorPedido({
    id_cuenta_corriente: client.accountId, id_pedido: await ctx.order(client, amount), monto: amount, ...extra,
  });
  ctx.credit = async (client, amount, options) => ctx.repo.registrarAbonoPorPago({
    id_cuenta_corriente: client.accountId, id_pago: await ctx.payment(client, amount, options), monto: amount,
  });
  return ctx;
}
module.exports = { accountContext };
