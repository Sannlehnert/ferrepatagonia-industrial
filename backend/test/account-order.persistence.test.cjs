const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const {
  childProfile,
  connectOwned,
  assertOwned,
} = require('./helpers/cc260-disposable.cjs');

let session;
let db;
let originalDefinition;

const table = 'CONFIRMACION_PEDIDO_CC';

async function definition() {
  const [row] = await db.query(`SHOW CREATE TABLE ${table}`);
  return row['Create Table'];
}

before(async () => {
  session = await connectOwned(childProfile());
  db = session.connection;
  await assertOwned(session);

  originalDefinition = await definition();

  // Solo esta tabla de la base descartable del runner.
  await db.query(`DROP TABLE ${table}`);

  const migration = readFileSync(path.resolve(
    __dirname,
    '../../database/migrate-fer-20-order-confirmation.sql',
  ), 'utf8');

  for (let application = 0; application < 2; application++) {
    for (const sql of migration.split(';').filter(value => value.trim())) {
      await db.query(sql);
    }
  }
});

after(async () => {
  await db?.end();
});

async function client() {
  const result = await db.query(`
    INSERT INTO CLIENTE (
      tipo_cliente, nombre_razon_social,
      estado_aprobacion_empresa, es_fiel, activo
    ) VALUES ('EMPRESA', 'DEMO #261', 'APROBADA', 0, 1)
  `);
  return Number(result.insertId);
}

async function confirmedFixture() {
  const clientId = await client();

  const account = await db.query(`
    INSERT INTO CUENTA_CORRIENTE (
      id_cliente, limite_credito, habilitada
    ) VALUES (?, 1000, 1)
  `, [clientId]);

  const order = await db.query(`
    INSERT INTO PEDIDO (
      id_cliente, estado, modalidad_pago,
      subtotal, descuento, total
    ) VALUES (?, 'CONFIRMADO', 'CUENTA_CORRIENTE', 10, 0, 10)
  `, [clientId]);

  const orderId = Number(order.insertId);

  const charge = await db.query(`
    INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE (
      id_cuenta_corriente, tipo_movimiento,
      origen, id_pedido, monto, moneda
    ) VALUES (?, 'CARGO', 'PEDIDO', ?, 10, 'USD')
  `, [Number(account.insertId), orderId]);

  return {
    clientId,
    orderId,
    chargeId: Number(charge.insertId),
  };
}

async function insertConfirmed(fixture, key) {
  const response = JSON.stringify({
    data: {
      pedidoId: fixture.orderId,
      estado: 'CONFIRMADO',
      modalidadPago: 'CUENTA_CORRIENTE',
      moneda: 'USD',
      totalUSD: '10.00',
      cargoId: String(fixture.chargeId),
      venceEl: '2026-12-08',
    },
  });

  await db.query(`
    INSERT INTO CONFIRMACION_PEDIDO_CC (
      id_cliente, clave, estado, id_pedido,
      id_cargo, http_status, respuesta_json
    ) VALUES (?, ?, 'CONFIRMADO', ?, ?, 201, ?)
  `, [
    fixture.clientId,
    key,
    fixture.orderId,
    fixture.chargeId,
    response,
  ]);

  return response;
}

test('#261: schema y doble migración producen la misma tabla', async () => {
  assert.equal(await definition(), originalDefinition);
});

test('#261: cliente y clave identifican un único intento', async () => {
  const first = await client();
  const second = await client();
  const key = randomUUID();

  const insert = id => db.query(`
    INSERT INTO CONFIRMACION_PEDIDO_CC (
      id_cliente, clave, estado
    ) VALUES (?, ?, 'PENDIENTE')
  `, [id, key]);

  await insert(first);
  await insert(second);

  await assert.rejects(
    insert(first),
    error => Number(error.errno) === 1062,
  );

  const [row] = await db.query(`
    SELECT COUNT(*) AS cantidad
    FROM CONFIRMACION_PEDIDO_CC
    WHERE id_cliente = ? AND clave = ?
  `, [first, key]);

  assert.equal(Number(row.cantidad), 1);
});

test('#261: rechaza resultados incompletos y JSON inválido', async () => {
  const id = await client();

  for (const [state, status, response] of [
    ['CONFIRMADO', 201, '{}'],
    ['RECHAZADO', null, '{}'],
    ['RECHAZADO', 503, '{}'],
    ['RECHAZADO', 422, '{invalido'],
    ['PENDIENTE', 201, '{}'],
  ]) {
    await assert.rejects(
      db.query(`
        INSERT INTO CONFIRMACION_PEDIDO_CC (
          id_cliente, clave, estado, http_status, respuesta_json
        ) VALUES (?, ?, ?, ?, ?)
      `, [id, randomUUID(), state, status, response]),
      error => Number(error.errno) === 4025,
    );
  }
});

test('#261: un pedido y cargo no pertenecen a dos resultados', async () => {
  const fixture = await confirmedFixture();
  await insertConfirmed(fixture, randomUUID());

  await assert.rejects(
    insertConfirmed(fixture, randomUUID()),
    error => Number(error.errno) === 1062,
  );
});

test('#261: rollback no conserva un resultado confirmado', async () => {
  const fixture = await confirmedFixture();
  const key = randomUUID();

  await db.beginTransaction();
  try {
    await insertConfirmed(fixture, key);
  } finally {
    await db.rollback();
  }

  const [row] = await db.query(`
    SELECT COUNT(*) AS cantidad
    FROM CONFIRMACION_PEDIDO_CC
    WHERE id_cliente = ? AND clave = ?
  `, [fixture.clientId, key]);

  assert.equal(Number(row.cantidad), 0);
});

test('#261: una conexión nueva recupera el resultado persistido', async () => {
  const fixture = await confirmedFixture();
  const key = randomUUID();
  const expected = await insertConfirmed(fixture, key);
  const fresh = await connectOwned(childProfile());

  try {
    const [row] = await fresh.connection.query(`
      SELECT estado, respuesta_json
      FROM CONFIRMACION_PEDIDO_CC
      WHERE id_cliente = ? AND clave = ?
    `, [fixture.clientId, key]);

    assert.equal(row.estado, 'CONFIRMADO');
    assert.deepEqual(
      JSON.parse(row.respuesta_json),
      JSON.parse(expected),
    );
  } finally {
    await fresh.connection.end();
  }
});