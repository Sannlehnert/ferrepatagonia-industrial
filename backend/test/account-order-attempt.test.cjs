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
let attempts;

before(async () => {
  session = await connectOwned(childProfile());
  await assertOwned(session);

  database = require('../dist/config/database.config.js');
  attempts = require(
    '../dist/repositories/accountOrderAttempt.repository.js'
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

async function client() {
  await assertOwned(session);

  const result = await session.connection.query(`
    INSERT INTO CLIENTE (
      tipo_cliente, nombre_razon_social,
      estado_aprobacion_empresa, es_fiel, activo
    ) VALUES ('EMPRESA', 'DEMO intento #261', 'APROBADA', 0, 1)
  `);

  return Number(result.insertId);
}

test('#261: reserva un intento pendiente sin resultado ficticio', async () => {
  const clientId = await client();
  const key = randomUUID();

  const result = await attempts.reserveAccountOrderAttempt(
    clientId,
    key,
  );

  assert.deepEqual(result, {
    clientId,
    key,
    state: 'PENDIENTE',
    orderId: null,
    chargeId: null,
    httpStatus: null,
    responseJson: null,
  });
});

test('#261: repetir una reserva conserva el mismo intento', async () => {
  const clientId = await client();
  const key = randomUUID();

  const original = await attempts.reserveAccountOrderAttempt(
    clientId,
    key,
  );

  const repeated = await attempts.reserveAccountOrderAttempt(
    clientId,
    key,
  );

  assert.deepEqual(repeated, original);
});

test('#261: una clave ajena no expone el intento de otro cliente', async () => {
  const first = await client();
  const second = await client();
  const key = randomUUID();

  await attempts.reserveAccountOrderAttempt(first, key);

  assert.equal(
    await attempts.findAccountOrderAttempt(second, key),
    null,
  );

  const own = await attempts.reserveAccountOrderAttempt(second, key);

  assert.equal(own.clientId, second);
  assert.equal(
    (await attempts.findAccountOrderAttempt(first, key)).clientId,
    first,
  );
});

test('#261: reservas simultáneas no duplican el intento', async () => {
  const clientId = await client();
  const key = randomUUID();

  const results = await Promise.all([
    attempts.reserveAccountOrderAttempt(clientId, key),
    attempts.reserveAccountOrderAttempt(clientId, key),
  ]);

  assert.deepEqual(results[0], results[1]);

  const [row] = await session.connection.query(`
    SELECT COUNT(*) AS cantidad
    FROM CONFIRMACION_PEDIDO_CC
    WHERE id_cliente = ? AND clave = ?
  `, [clientId, key]);

  assert.equal(Number(row.cantidad), 1);
});

test('#261: rechaza un bloqueo fuera de una transacción', async () => {
  await assert.rejects(
    async () => attempts.lockAccountOrderAttempt(
      database.dataSource.manager,
      await client(),
      randomUUID(),
    ),
    /transacción activa/,
  );
});