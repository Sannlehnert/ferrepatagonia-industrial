const assert = require('node:assert/strict');
const {
  childProfile,
  connectOwned,
  assertOwned,
} = require('./cc260-disposable.cjs');

async function main() {
  const [mode, rawUserId, rawClientId, key] = process.argv.slice(2);
  assert.ok(['before-commit', 'after-commit', 'recover'].includes(mode));

  const userId = Number(rawUserId);
  const clientId = Number(rawClientId);

  assert.ok(Number.isSafeInteger(userId) && userId > 0);
  assert.ok(Number.isSafeInteger(clientId) && clientId > 0);
  assert.match(
    key,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );

  const session = await connectOwned(childProfile());
  await assertOwned(session);

  const database = require('../../dist/config/database.config.js');
  const service = require(
    '../../dist/services/orders/account-order.service.js'
  );

  try {
    await database.initializeDatabase();

    const auth = { id: userId, rol: 'CLIENTE' };
    const eligibility = await service.getAccountOrderEligibility(auth);
    const quoteToken = eligibility.body.data.cotizacion;

    if (mode === 'recover') {
      const previous = await service.getAccountOrderResult(auth, key);
      const confirmed = await service.confirmAccountOrder(auth, key, quoteToken);
      const recovered = await service.getAccountOrderResult(auth, key);

      process.stdout.write(
        `${JSON.stringify({ previous, confirmed, recovered })}\n`,
      );
      return;
    }

    const createRunner = database.dataSource.createQueryRunner
      .bind(database.dataSource);

    database.dataSource.createQueryRunner = (...args) => {
      const runner = createRunner(...args);
      const commit = runner.commitTransaction.bind(runner);

      runner.commitTransaction = async () => {
        const root = runner.transactionDepth === 1;

        if (root && mode === 'before-commit') {
          const [row] = await runner.query(`
            SELECT estado FROM CONFIRMACION_PEDIDO_CC
            WHERE id_cliente = ? AND clave = ?
          `, [clientId, key]);

          if (row?.estado === 'CONFIRMADO') {
            process.exit(87);
          }
        }

        await commit();

        if (root && mode === 'after-commit') {
          const [row] = await session.connection.query(`
            SELECT estado FROM CONFIRMACION_PEDIDO_CC
            WHERE id_cliente = ? AND clave = ?
          `, [clientId, key]);

          if (row?.estado === 'CONFIRMADO') {
            process.exit(86);
          }
        }
      };

      return runner;
    };

    await service.confirmAccountOrder(auth, key, quoteToken);
    throw new Error('No se alcanzó el punto de interrupción esperado.');
  } finally {
    try {
      await database.destroyDatabase();
    } finally {
      await session.connection.end();
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
