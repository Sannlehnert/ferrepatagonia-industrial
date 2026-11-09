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
let results;

before(async () => {
  session = await connectOwned(childProfile());
  await assertOwned(session);

  database = require('../dist/config/database.config.js');
  attempts = require(
    '../dist/repositories/accountOrderAttempt.repository.js'
  );
  results = require(
    '../dist/repositories/accountOrderResult.repository.js'
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

async function fixture() {
  await assertOwned(session);
  const db = session.connection;

  const client = await db.query(`
    INSERT INTO CLIENTE (
      tipo_cliente, nombre_razon_social,
      estado_aprobacion_empresa, es_fiel, activo
    ) VALUES ('EMPRESA', 'DEMO resultado #261', 'APROBADA', 0, 1)
  `);
  const clientId = Number(client.insertId);

  const account = await db.query(`
    INSERT INTO CUENTA_CORRIENTE (
      id_cliente, limite_credito, habilitada
    ) VALUES (?, 1000, 1)
  `, [clientId]);

  const order = await db.query(`
    INSERT INTO PEDIDO (
      id_cliente, estado, modalidad_pago,
      subtotal, descuento, total,
      moneda_total, evidencia_total_usd
    ) VALUES (
      ?, 'CONFIRMADO', 'CUENTA_CORRIENTE',
      10, 0, 10, 'USD', 'DEMO persistencia #261'
    )
  `, [clientId]);
  const orderId = Number(order.insertId);

  const charge = await db.query(`
    INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE (
      id_cuenta_corriente, tipo_movimiento,
      origen, id_pedido, monto, moneda,
      fecha_base_civil, plazo_aplicado, vence_el
    ) VALUES (
      ?, 'CARGO', 'PEDIDO', ?, 10, 'USD',
      '2026-11-08', 30, '2026-12-08'
    )
  `, [Number(account.insertId), orderId]);

  const key = randomUUID();
  await attempts.reserveAccountOrderAttempt(clientId, key);

  return {
    clientId,
    key,
    orderId,
    chargeId: Number(charge.insertId),
  };
}

function complete(manager, f) {
  return results.completeAccountOrderAttempt(
    manager,
    f.clientId,
    f.key,
    f.orderId,
    f.chargeId,
  );
}

test('#261: guarda y conserva el resultado original al reservar otra vez', async () => {
  const f = await fixture();
  const response = await database.inTransaction(
    manager => complete(manager, f),
  );

  assert.deepEqual(response.data, {
    pedidoId: f.orderId,
    estado: 'CONFIRMADO',
    modalidadPago: 'CUENTA_CORRIENTE',
    moneda: 'USD',
    totalUSD: '10.00',
    cargoId: String(f.chargeId),
    venceEl: '2026-12-08',
  });

  const recovered = await attempts.reserveAccountOrderAttempt(
    f.clientId,
    f.key,
  );

  assert.equal(recovered.state, 'CONFIRMADO');
  assert.deepEqual(JSON.parse(recovered.responseJson), response);
});

test('#261: no confirma el pedido y cargo de otro cliente', async () => {
  const owner = await fixture();
  const other = await fixture();

  await assert.rejects(
    database.inTransaction(manager => complete(manager, {
      ...other,
      orderId: owner.orderId,
      chargeId: owner.chargeId,
    })),
    error => error.code === 'RESULTADO_PEDIDO_INCONSISTENTE',
  );

  assert.equal(
    (await attempts.findAccountOrderAttempt(
      other.clientId,
      other.key,
    )).state,
    'PENDIENTE',
  );
});

test('#261: rechaza diferencias entre el total del pedido y su cargo', async () => {
  const f = await fixture();

  await session.connection.query(
    'UPDATE PEDIDO SET total = 20 WHERE id_pedido = ?',
    [f.orderId],
  );

  await assert.rejects(
    database.inTransaction(manager => complete(manager, f)),
    error => error.code === 'RESULTADO_PEDIDO_INCONSISTENTE',
  );
});

test('#261: un rollback revierte el guardado del resultado', async () => {
  const f = await fixture();

  await assert.rejects(
    database.inTransaction(async manager => {
      await complete(manager, f);
      throw new Error('FALLO_SIMULADO_261');
    }),
    /FALLO_SIMULADO_261/,
  );

  const recovered = await attempts.findAccountOrderAttempt(
    f.clientId,
    f.key,
  );

  assert.equal(recovered.state, 'PENDIENTE');
  assert.equal(recovered.orderId, null);
  assert.equal(recovered.responseJson, null);
});