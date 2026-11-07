const { before, beforeEach, after } = require('node:test');
const { childProfile, connectOwned } = require('./account-disposable.cjs');
const { seedDemo, clearDemo } = require('../../../database/fixtures/fer19-demo.cjs');

function accountContext() {
  const ctx = {};
  before(async () => {
    // Guard before importing production modules (including dotenv/DataSource).
    ctx.session = await connectOwned(childProfile());
    ctx.db = ctx.session.connection;
    ctx.database = require('../../dist/config/database.config');
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
    finally { if (ctx.session) await ctx.db.end(); }
  });
  ctx.order = async (client = ctx.a, amount = '1.00') => Number((await ctx.db.query(`INSERT INTO PEDIDO(id_cliente,estado,modalidad_pago,subtotal,descuento,total)
    VALUES(?,'DEMO_CONFIRMADO','DEMO_CUENTA_CORRIENTE',?,0,?)`, [client.clientId, amount, amount])).insertId);
  ctx.charge = async (client, amount, extra = {}) => ctx.repo.registrarCargoPorPedido({
    id_cuenta_corriente: client.accountId, id_pedido: await ctx.order(client, amount), monto: amount,
    dias_vencimiento: client.term || 30, ...extra });
  return ctx;
}
module.exports = { accountContext };
