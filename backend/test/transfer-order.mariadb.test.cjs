const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { PDFDocument } = require('pdf-lib');

const {
  childProfile,
  connectOwned,
  assertOwned,
} = require('./helpers/cc260-disposable.cjs');
const {
  fetchFromBrowser,
} = require('./helpers/browser-request.cjs');

let session;
let db;
let database;
let server;
let apiBase;
let transferBase;
let signToken;
let samplePdf;

before(async () => {
  session = await connectOwned(childProfile());
  await assertOwned(session);
  db = session.connection;

  database = require('../dist/config/database.config.js');
  await database.initializeDatabase();

  ({ signToken } = require('../dist/services/token.service.js'));
  const { app } = require('../dist/app.js');

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  apiBase = `http://127.0.0.1:${server.address().port}/api`;
  transferBase = `${apiBase}/pedidos/transferencia`;

  const doc = await PDFDocument.create();
  doc.addPage().drawText('Comprobante transferencia #322');
  samplePdf = Buffer.from(await doc.save());
});

after(async () => {
  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
        server.closeIdleConnections?.();
      });
    }
  } finally {
    try {
      await database?.destroyDatabase();
    } finally {
      await session?.connection.end();
    }
  }
});

async function createTransferFixture(options = {}) {
  await assertOwned(session);
  const insert = async (sql, values) =>
    Number((await db.query(sql, values)).insertId);

  const {
    clientType = 'PARTICULAR',
    companyApproval = clientType === 'EMPRESA' ? 'APROBADA' : null,
    clientActive = 1,
    userActive = 1,
    withAccount = false,
    accountEnabled = 1,
    accountCoverage = 'COMPLETA',
    accountLimit = '1000.00',
    price = '15.00',
    discount = null,
    quantity = 2,
    stock = 5,
    verified = true,
    synthetic = false,
    sharedProductId = null,
  } = options;

  const adminId = await insert(`
    INSERT INTO USUARIO (email, password_hash, rol, activo)
    VALUES (?, 'fixture-no-login', 'ADMIN', 1)
  `, [`${randomUUID()}@example.test`]);

  const listId = discount === null ? null : await insert(`
    INSERT INTO LISTA_PRECIO (nombre, porcentaje_descuento, activa)
    VALUES ('Lista Transfer #322', ?, 1)
  `, [discount]);

  const clientId = await insert(`
    INSERT INTO CLIENTE (
      tipo_cliente, nombre_razon_social,
      estado_aprobacion_empresa, es_fiel, activo, id_lista_precio
    ) VALUES (?, ?, ?, 0, ?, ?)
  `, [
    clientType,
    `Cliente ${clientType} #322`,
    companyApproval,
    clientActive,
    listId,
  ]);

  const userId = await insert(`
    INSERT INTO USUARIO (
      id_cliente, email, password_hash, rol, activo
    ) VALUES (?, ?, 'fixture-no-login', 'CLIENTE', ?)
  `, [clientId, `${randomUUID()}@example.test`, userActive]);

  let accountId = null;
  if (withAccount) {
    accountId = await insert(`
      INSERT INTO CUENTA_CORRIENTE (
        id_cliente, limite_credito, habilitada,
        cobertura, plazo_dias, moneda_limite,
        evidencia_limite, evidencia_plazo, evidencia_cobertura,
        cobertura_desde_utc, origen_datos
      ) VALUES (
        ?, ?, ?, ?, 30, 'USD',
        'Evidencia #322', 'Evidencia #322', 'Evidencia #322',
        UTC_TIMESTAMP(3) - INTERVAL 1 DAY, 'REAL'
      )
    `, [clientId, accountLimit, accountEnabled, accountCoverage]);
  }

  let categoryId = null;
  let productId = sharedProductId;

  if (productId === null) {
    categoryId = await insert(`
      INSERT INTO CATEGORIA (nombre, activo)
      VALUES ('Cat Transfer #322', 1)
    `);

    productId = await insert(`
      INSERT INTO PRODUCTO (
        id_categoria, codigo, nombre, precio, stock, activo
      ) VALUES (?, ?, 'Producto Transfer #322', ?, ?, 1)
    `, [categoryId, randomUUID(), price, stock]);

    if (verified && price !== null) {
      await db.query(`
        INSERT INTO PRECIO_USD_EVIDENCIA (
          id_producto, precio_verificado, evidencia,
          id_admin, verificado_utc, valida, sintetica
        ) VALUES (
          ?, ?, 'Evidencia USD #322', ?,
          UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE, 1, ?
        )
      `, [productId, price, adminId, Number(synthetic)]);
    }
  }

  const cartId = await insert(
    'INSERT INTO CARRITO (id_cliente) VALUES (?)',
    [clientId],
  );

  if (quantity > 0) {
    await db.query(`
      INSERT INTO ITEM_CARRITO (id_carrito, id_producto, cantidad)
      VALUES (?, ?, ?)
    `, [cartId, productId, quantity]);
  }

  return {
    clientId,
    userId,
    adminId,
    accountId,
    categoryId,
    productId,
    cartId,
    listId,
    auth: { id: userId, rol: 'CLIENTE' },
  };
}

function request({
  method = 'GET',
  path: reqPath = '',
  auth,
  key,
  body,
  headers = {},
  baseUrl = transferBase,
}) {
  const requestHeaders = { ...headers };

  if (auth) {
    requestHeaders.Cookie = `jwt_token=${signToken(auth)}`;
  }

  if (key !== undefined) {
    requestHeaders['Idempotency-Key'] = key;
  }

  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  return fetchFromBrowser(`${baseUrl}${reqPath}`, {
    method,
    headers: requestHeaders,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
}

async function responseBody(response, expectedStatus) {
  const raw = await response.text();
  assert.equal(
    response.status,
    expectedStatus,
    `HTTP ${response.status} != ${expectedStatus}: ${raw}`,
  );
  assert.equal(response.headers.get('cache-control'), 'private, no-store');

  const vary = response.headers.get('vary') ?? '';
  assert.ok(
    vary.split(',').some(value => value.trim().toLowerCase() === 'cookie'),
    'La respuesta debe variar según la cookie de sesión',
  );

  const parsed = JSON.parse(raw);

  if (expectedStatus >= 400) {
    assert.equal(typeof parsed.code, 'string');
    assert.ok(parsed.code.length > 0);
    assert.equal(typeof parsed.message, 'string');
    assert.ok(parsed.message.length > 0);
  }

  return parsed;
}

async function quoteFor(auth) {
  const body = await responseBody(
    await request({ path: '/eligibilidad', auth }),
    200,
  );
  assert.equal(body.data.elegible, true);
  assert.equal(body.data.modalidadPago, 'TRANSFERENCIA');
  assert.equal(typeof body.data.cotizacion, 'string');
  return body.data.cotizacion;
}

function confirm(f, key, cotizacion, headers) {
  return request({
    method: 'POST',
    auth: f.auth,
    key,
    body: { cotizacion },
    headers,
  });
}

async function transferState(f) {
  const orders = await db.query(`
    SELECT id_pedido, estado, modalidad_pago, subtotal, descuento, total,
           moneda_total, evidencia_total_usd, fecha_utc
    FROM PEDIDO
    WHERE id_cliente = ?
    ORDER BY id_pedido
  `, [f.clientId]);

  const movements = f.accountId
    ? await db.query(`
        SELECT id_movimiento_cuenta, id_pedido, tipo_movimiento, estado, monto
        FROM MOVIMIENTO_CUENTA_CORRIENTE
        WHERE id_cuenta_corriente = ?
        ORDER BY id_movimiento_cuenta
      `, [f.accountId])
    : [];

  const payments = await db.query(`
    SELECT p.id_pago, p.id_pedido, p.estado, p.monto
    FROM PAGO p
    INNER JOIN PEDIDO o ON o.id_pedido = p.id_pedido
    WHERE o.id_cliente = ?
    ORDER BY p.id_pago
  `, [f.clientId]);

  const items = await db.query(`
    SELECT id_producto, cantidad
    FROM ITEM_CARRITO
    WHERE id_carrito = ?
    ORDER BY id_producto
  `, [f.cartId]);

  const [product] = await db.query(
    'SELECT stock FROM PRODUCTO WHERE id_producto = ?',
    [f.productId],
  );

  const [transferAttempts] = await db.query(
    'SELECT COUNT(*) AS c FROM CONFIRMACION_PEDIDO_TRANSFERENCIA WHERE id_cliente = ?',
    [f.clientId],
  );

  const [ccAttempts] = await db.query(
    'SELECT COUNT(*) AS c FROM CONFIRMACION_PEDIDO_CC WHERE id_cliente = ?',
    [f.clientId],
  );

  return {
    orders,
    movements,
    payments,
    items,
    stock: Number(product.stock),
    transferAttempts: Number(transferAttempts.c),
    ccAttempts: Number(ccAttempts.c),
  };
}

async function waitFor(check, message, interval = 10) {
  const deadline = performance.now() + 2000;
  do {
    if (await check()) return;
    await delay(interval);
  } while (performance.now() < deadline);
  assert.fail(message);
}

async function waitForLock(blocker, count = 1) {
  await waitFor(async () => {
    const [row] = await db.query(`
      SELECT COUNT(DISTINCT w.requesting_trx_id) AS waiting
      FROM information_schema.INNODB_LOCK_WAITS w
      JOIN information_schema.INNODB_TRX t ON t.trx_id = w.blocking_trx_id
      WHERE t.trx_mysql_thread_id = ?
    `, [blocker]);
    return Number(row.waiting) === count;
  }, `MariaDB no mostró ${count} transacciones esperando a la sesión ${blocker}`, 125);
}

async function whileHoldingTransaction(work) {
  const runner = database.dataSource.createQueryRunner();
  const requests = [];
  const track = promise => {
    requests.push(promise);
    promise.catch(() => {});
    return promise;
  };
  await runner.connect();
  try {
    await runner.startTransaction('READ COMMITTED');
    const [{ id }] = await runner.query('SELECT CONNECTION_ID() AS id');
    await work(runner, id, track);
  } finally {
    try {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
    } finally {
      try {
        await runner.release();
      } finally {
        await Promise.allSettled(requests);
      }
    }
  }
}

test('#322 Persistencia SQL: schema.sql, doble migración idempotente y restricciones CHECK/UNIQUE de CONFIRMACION_PEDIDO_TRANSFERENCIA', async () => {
  await assertOwned(session);
  const [beforeRow] = await db.query('SHOW CREATE TABLE CONFIRMACION_PEDIDO_TRANSFERENCIA');
  const originalDdl = beforeRow['Create Table'];

  await db.query('DROP TABLE IF EXISTS CONFIRMACION_PEDIDO_TRANSFERENCIA');

  const migration = readFileSync(
    path.resolve(__dirname, '../../database/migrate-s7-06-1-transfer-order-confirmation.sql'),
    'utf8',
  );

  for (let i = 0; i < 2; i++) {
    for (const sql of migration.split(';').filter(s => s.trim())) {
      await db.query(sql);
    }
  }

  const [afterRow] = await db.query('SHOW CREATE TABLE CONFIRMACION_PEDIDO_TRANSFERENCIA');
  assert.equal(afterRow['Create Table'], originalDdl);

  const f = await createTransferFixture({ clientType: 'PARTICULAR' });

  // 1. Clave no UUID v4 rechazada por chk_confirmacion_transferencia_clave (errno 4025)
  for (const invalidKey of [
    'no-es-uuid-v4',
    '00000000-0000-1000-8000-000000000000',
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
  ]) {
    await assert.rejects(
      db.query(`
        INSERT INTO CONFIRMACION_PEDIDO_TRANSFERENCIA (
          id_cliente, clave, estado
        ) VALUES (?, ?, 'PENDIENTE')
      `, [f.clientId, invalidKey]),
      error => Number(error.errno) === 4025,
    );
  }

  // 2. Estado inválido, JSON inválido y resultados inconsistentes rechazados por CHECK (errno 4025)
  for (const [state, status, response] of [
    ['INVALIDO', null, null],
    ['CONFIRMADO', 201, '{}'],
    ['RECHAZADO', null, '{}'],
    ['RECHAZADO', 503, '{}'],
    ['RECHAZADO', 422, '{json-invalido'],
    ['PENDIENTE', 201, '{}'],
  ]) {
    await assert.rejects(
      db.query(`
        INSERT INTO CONFIRMACION_PEDIDO_TRANSFERENCIA (
          id_cliente, clave, estado, http_status, respuesta_json
        ) VALUES (?, ?, ?, ?, ?)
      `, [f.clientId, randomUUID(), state, status, response]),
      error => Number(error.errno) === 4025,
    );
  }

  // 3. Unicidad de (id_cliente, clave) y de id_pedido (errno 1062)
  const dupKey = randomUUID();
  await db.query(`
    INSERT INTO CONFIRMACION_PEDIDO_TRANSFERENCIA (
      id_cliente, clave, estado
    ) VALUES (?, ?, 'PENDIENTE')
  `, [f.clientId, dupKey]);
  await assert.rejects(
    db.query(`
      INSERT INTO CONFIRMACION_PEDIDO_TRANSFERENCIA (
        id_cliente, clave, estado
      ) VALUES (?, ?, 'PENDIENTE')
    `, [f.clientId, dupKey]),
    error => Number(error.errno) === 1062,
  );
});

test('#322 Elegibilidad y seguridad: anónimo (401), JWT inválido (401), ADMIN (403), cliente inactivo (403) y usuario inactivo (401)', async () => {
  const f = await createTransferFixture({ clientType: 'PARTICULAR' });
  const cotizacion = await quoteFor(f.auth);
  const key = randomUUID();

  const actors = [
    { input: {}, status: 401, code: 'NO_AUTENTICADO' },
    { input: { headers: { Cookie: 'jwt_token=token.invalido.firma' } }, status: 401, code: 'NO_AUTENTICADO' },
    { input: { auth: { id: f.adminId, rol: 'ADMIN' } }, status: 403, code: 'NO_AUTORIZADO' },
  ];

  for (const { input, status, code } of actors) {
    const elig = await responseBody(
      await request({ path: '/eligibilidad', ...input }),
      status,
    );
    assert.equal(elig.code, code);

    const conf = await responseBody(
      await request({ method: 'POST', ...input, key, body: { cotizacion } }),
      status,
    );
    assert.equal(conf.code, code);

    const rec = await responseBody(
      await request({ path: `/${key}`, ...input }),
      status,
    );
    assert.equal(rec.code, code);
  }

  const inactiveClient = await createTransferFixture({ clientType: 'PARTICULAR', clientActive: 0 });
  const rejClient = await responseBody(
    await request({ path: '/eligibilidad', auth: inactiveClient.auth }),
    403,
  );
  assert.equal(rejClient.code, 'CLIENTE_NO_HABILITADO');

  const inactiveUser = await createTransferFixture({ clientType: 'PARTICULAR', userActive: 0 });
  const rejUser = await responseBody(
    await request({ path: '/eligibilidad', auth: inactiveUser.auth }),
    401,
  );
  assert.equal(rejUser.code, 'NO_AUTENTICADO');
});

test('#322 Elegibilidad y rechazo de EMPRESA PENDIENTE y RECHAZADA (403 EMPRESA_NO_HABILITADA)', async () => {
  for (const approval of ['PENDIENTE', 'RECHAZADA']) {
    const f = await createTransferFixture({
      clientType: 'EMPRESA',
      companyApproval: approval,
    });

    const elig = await responseBody(
      await request({ path: '/eligibilidad', auth: f.auth }),
      200,
    );
    assert.deepEqual(elig.data, {
      elegible: false,
      modalidadPago: 'TRANSFERENCIA',
      moneda: 'USD',
      totalUSD: null,
      codigo: 'EMPRESA_NO_HABILITADA',
      mensaje: 'La empresa no está aprobada para esta operación.',
      cotizacion: null,
    });

    // Si la empresa tenía una cotización previa cuando estaba APROBADA y luego pasa a PENDIENTE/RECHAZADA (TOCTOU)
    const approvedCompany = await createTransferFixture({
      clientType: 'EMPRESA',
      companyApproval: 'APROBADA',
    });
    const cotizacion = await quoteFor(approvedCompany.auth);
    await db.query(
      'UPDATE CLIENTE SET estado_aprobacion_empresa = ? WHERE id_cliente = ?',
      [approval, approvedCompany.clientId],
    );
    const before = await transferState(approvedCompany);
    const key = randomUUID();
    const rejected = await responseBody(
      await confirm(approvedCompany, key, cotizacion),
      403,
    );
    assert.equal(rejected.code, 'EMPRESA_NO_HABILITADA');
    assert.equal(rejected.estado, 'RECHAZADO');

    const after = await transferState(approvedCompany);
    assert.equal(after.orders.length, 0);
    assert.equal(after.stock, before.stock);
    assert.deepEqual(after.items, before.items);
    assert.equal(after.transferAttempts, 1);
    assert.equal(after.ccAttempts, 0);

    // Replay del rechazo con la misma Idempotency-Key
    const replay = await responseBody(
      await confirm(approvedCompany, key, cotizacion),
      403,
    );
    assert.deepEqual(replay, rejected);
  }
});

test('#322 Compra exitosa PARTICULAR y EMPRESA APROBADA (sin CC, con CC inhabilitada y con CC habilitada) + compatibilidad #275', async () => {
  const profiles = [
    {
      label: 'PARTICULAR activo sin cuenta corriente',
      options: { clientType: 'PARTICULAR', discount: '10.00' },
    },
    {
      label: 'EMPRESA APROBADA sin cuenta corriente',
      options: { clientType: 'EMPRESA', companyApproval: 'APROBADA', withAccount: false },
    },
    {
      label: 'EMPRESA APROBADA con cuenta corriente inhabilitada y sin cobertura',
      options: {
        clientType: 'EMPRESA',
        companyApproval: 'APROBADA',
        withAccount: true,
        accountEnabled: 0,
        accountCoverage: 'NO_ACREDITADA',
        accountLimit: '0.00',
      },
    },
    {
      label: 'EMPRESA APROBADA con cuenta corriente habilitada (elige transferencia sin tocar su crédito)',
      options: {
        clientType: 'EMPRESA',
        companyApproval: 'APROBADA',
        withAccount: true,
        accountEnabled: 1,
        accountCoverage: 'COMPLETA',
        accountLimit: '1000.00',
      },
    },
  ];

  for (const { label, options } of profiles) {
    const f = await createTransferFixture(options);
    const key = randomUUID();
    const cotizacion = await quoteFor(f.auth);

    const created = await responseBody(await confirm(f, key, cotizacion), 201);
    const expectedTotal = options.discount ? '27.00' : '30.00';
    const expectedDiscount = options.discount ? '3.00' : '0.00';

    assert.deepEqual(created, {
      data: {
        pedidoId: created.data.pedidoId,
        estado: 'CONFIRMADO',
        modalidadPago: 'TRANSFERENCIA',
        moneda: 'USD',
        totalUSD: expectedTotal,
      },
    }, label);
    assert.equal('cargoId' in created.data, false);
    assert.equal('venceEl' in created.data, false);

    const state = await transferState(f);
    assert.equal(state.orders.length, 1, label);
    assert.equal(state.orders[0].id_pedido, created.data.pedidoId);
    assert.equal(state.orders[0].estado, 'CONFIRMADO');
    assert.equal(state.orders[0].modalidad_pago, 'TRANSFERENCIA');
    assert.equal(state.orders[0].subtotal, '30.00');
    assert.equal(state.orders[0].descuento, expectedDiscount);
    assert.equal(state.orders[0].total, expectedTotal);
    assert.equal(state.orders[0].moneda_total, 'USD');
    assert.match(state.orders[0].evidencia_total_usd, /^FER17-v1:SHA256:[a-f0-9]{64}$/);
    assert.ok(state.orders[0].fecha_utc, 'fecha_utc debe registrarse con UTC_TIMESTAMP(3)');

    // 0 movimientos en cuenta corriente y 0 pagos acreditados
    assert.deepEqual(state.movements, []);
    assert.deepEqual(state.payments, []);
    assert.equal(state.stock, 3);
    assert.deepEqual(state.items, []);
    assert.equal(state.transferAttempts, 1);
    assert.equal(state.ccAttempts, 0);

    // Verificar DETALLE_PEDIDO y DETALLE_PEDIDO_CC_PRECIO
    const details = await db.query(`
      SELECT d.cantidad, d.precio_unitario, d.descuento, d.subtotal,
             p.regla, p.snapshot_json
      FROM DETALLE_PEDIDO d
      INNER JOIN DETALLE_PEDIDO_CC_PRECIO p
        ON p.id_detalle_pedido = d.id_detalle_pedido
      WHERE d.id_pedido = ?
    `, [created.data.pedidoId]);
    assert.equal(details.length, 1);
    assert.equal(Number(details[0].cantidad), 2);
    assert.equal(details[0].precio_unitario, '15.00');
    assert.equal(details[0].descuento, expectedDiscount);
    assert.equal(details[0].subtotal, expectedTotal);
    assert.equal(details[0].regla, 'FER17-v1');
    assert.equal(JSON.parse(details[0].snapshot_json).regla, 'FER17-v1');

    // Replay idempotente (200) y recuperación GET /:clave (200)
    const replay = await responseBody(await confirm(f, key, cotizacion), 200);
    const recovered = await responseBody(
      await request({ path: `/${key}`, auth: f.auth }),
      200,
    );
    assert.deepEqual(replay, created);
    assert.deepEqual(recovered, created);

    // Historial y detalle de pedidos del cliente (#273)
    const detail = await responseBody(
      await request({
        baseUrl: `${apiBase}/pedidos`,
        path: `/${created.data.pedidoId}`,
        auth: f.auth,
      }),
      200,
    );
    assert.equal(detail.data.pedidoId, created.data.pedidoId);
    assert.equal(detail.data.estado, 'CONFIRMADO');
    assert.equal(detail.data.modalidadPago, 'TRANSFERENCIA');
    assert.equal(detail.data.cargoId, null);
    assert.equal(detail.data.venceEl, null);
    assert.equal(detail.data.totalUSD, expectedTotal);

    // Compatibilidad con carga de comprobantes de pago (#275): POST /api/pedidos/:pedidoId/comprobantes
    const receiptRes = await fetchFromBrowser(
      `${apiBase}/pedidos/${created.data.pedidoId}/comprobantes`,
      {
        method: 'POST',
        headers: {
          Cookie: `jwt_token=${signToken(f.auth)}`,
          'Content-Type': 'application/pdf',
        },
        body: samplePdf,
        signal: AbortSignal.timeout(15000),
      },
    );
    const receiptBody = await responseBody(receiptRes, 201);
    assert.equal(receiptBody.data.pedidoId, created.data.pedidoId);
    assert.equal(receiptBody.data.cuentaCorrienteId, null);
    assert.equal(receiptBody.data.estadoRevision, 'PENDIENTE');

    // Verificar que subir comprobante tampoco crea PAGO ni MOVIMIENTO_CUENTA_CORRIENTE
    const afterReceipt = await transferState(f);
    assert.deepEqual(afterReceipt.movements, []);
    assert.deepEqual(afterReceipt.payments, []);
  }
});

test('#322 Concurrencia TOCTOU: dos compradores compitiendo por la última unidad de stock (201 vs 409 STOCK_INSUFICIENTE)', async () => {
  const first = await createTransferFixture({
    clientType: 'PARTICULAR',
    stock: 1,
    quantity: 1,
  });
  const second = await createTransferFixture({
    clientType: 'EMPRESA',
    companyApproval: 'APROBADA',
    quantity: 1,
    sharedProductId: first.productId,
  });

  const buyers = [first, second];
  const quotes = await Promise.all(buyers.map(b => quoteFor(b.auth)));

  await whileHoldingTransaction(async (runner, blocker, track) => {
    await runner.query(
      'SELECT stock FROM PRODUCTO WHERE id_producto = ? FOR UPDATE',
      [first.productId],
    );
    const purchases = buyers.map((b, i) => track(confirm(b, randomUUID(), quotes[i])));
    await waitForLock(blocker, 2);
    await runner.commitTransaction();

    const responses = await Promise.all(purchases);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);

    for (const [index, response] of responses.entries()) {
      const b = buyers[index];
      const after = await transferState(b);
      assert.equal(after.stock, 0);
      assert.deepEqual(after.movements, []);
      assert.deepEqual(after.payments, []);

      if (response.status === 201) {
        const { data } = await responseBody(response, 201);
        assert.equal(data.modalidadPago, 'TRANSFERENCIA');
        assert.deepEqual(after.orders.map(o => o.id_pedido), [data.pedidoId]);
        assert.deepEqual(after.items, []);
      } else {
        const body = await responseBody(response, 409);
        assert.equal(body.code, 'STOCK_INSUFICIENTE');
        assert.equal(body.estado, 'RECHAZADO');
        assert.deepEqual(after.orders, []);
        assert.deepEqual(after.items, [{ id_producto: first.productId, cantidad: 1 }]);
      }
    }
  });
});

test('#322 Concurrencia e Idempotencia: doble POST simultáneo con la misma Idempotency-Key y estado 202 en vuelo', async t => {
  const f = await createTransferFixture({ clientType: 'PARTICULAR' });
  const cotizacion = await quoteFor(f.auth);
  const key = randomUUID();
  const before = await transferState(f);
  const { cartAdmission } = require('../dist/services/cart.admission.js');
  const enqueue = cartAdmission.enqueue.bind(cartAdmission);
  const queue = t.mock.method(cartAdmission, 'enqueue', (...args) => enqueue(...args));

  await whileHoldingTransaction(async (runner, blocker, track) => {
    await runner.query(
      'SELECT stock FROM PRODUCTO WHERE id_producto = ? FOR UPDATE',
      [f.productId],
    );
    const first = track(confirm(f, key, cotizacion));
    await waitForLock(blocker, 1);
    const second = track(confirm(f, key, cotizacion));
    await waitFor(() => queue.mock.callCount() === 1, 'El segundo POST no entró en la cola del usuario');

    // Mientras está en vuelo, GET /:clave devuelve 202 + Retry-After: 1
    const lookup = await request({ auth: f.auth, path: `/${key}` });
    assert.equal(lookup.headers.get('retry-after'), '1');
    const pending = await responseBody(lookup, 202);
    assert.equal(pending.data.estado, 'PENDIENTE');
    assert.equal(pending.data.code, 'CONFIRMACION_PENDIENTE');
    assert.equal((await transferState(f)).orders.length, before.orders.length);

    await runner.commitTransaction();

    const firstBody = await responseBody(await first, 201);
    const secondBody = await responseBody(await second, 200);
    assert.deepEqual(secondBody, firstBody);

    const after = await transferState(f);
    assert.deepEqual(after.orders.map(o => o.id_pedido), [firstBody.data.pedidoId]);
    assert.equal(after.stock, 3);
    assert.deepEqual(after.items, []);
    assert.equal(after.transferAttempts, 1);
  });
});

test('#322 Validación de DTOs, anti-IDOR de clave, cotización desactualizada y rollback limpio ante fallos SQL', async () => {
  const f = await createTransferFixture({ clientType: 'PARTICULAR' });
  const other = await createTransferFixture({ clientType: 'PARTICULAR' });
  const key = randomUUID();

  // 1. DTOs inválidos rechazados con 400 antes de reservar intento
  for (const invalid of [
    { body: { cotizacion: 'a'.repeat(40) } },
    { key: 'no-es-uuid', body: { cotizacion: 'a'.repeat(40) } },
    { key },
    { key, body: [] },
    { key, body: { clienteId: f.clientId } },
    { key, body: { totalUSD: '0.01' } },
    { key, body: { cotizacion: 'a'.repeat(40), modalidadPago: 'TRANSFERENCIA' } },
    { key, body: { cotizacion: 'a'.repeat(40) }, path: '?clienteId=1' },
  ]) {
    await responseBody(
      await request({ method: 'POST', auth: f.auth, ...invalid }),
      400,
    );
  }
  assert.equal((await transferState(f)).transferAttempts, 0);

  // 2. Cotización desactualizada por cambio de carrito o de precio
  const staleQuote = await quoteFor(f.auth);
  await db.query(
    'UPDATE ITEM_CARRITO SET cantidad = 3 WHERE id_carrito = ? AND id_producto = ?',
    [f.cartId, f.productId],
  );
  const staleKey = randomUUID();
  const staleRes = await responseBody(
    await confirm(f, staleKey, staleQuote),
    409,
  );
  assert.equal(staleRes.code, 'COTIZACION_DESACTUALIZADA');
  assert.equal((await transferState(f)).orders.length, 0);
  assert.equal((await transferState(f)).stock, 5);

  // Restaurar cantidad y probar rollback ante fallo pre-COMMIT en PEDIDO y PRODUCTO
  await db.query(
    'UPDATE ITEM_CARRITO SET cantidad = 2 WHERE id_carrito = ? AND id_producto = ?',
    [f.cartId, f.productId],
  );
  const validQuote = await quoteFor(f.auth);
  const retryKey = randomUUID();
  const beforeRollback = await transferState(f);

  await db.query(`
    CREATE TRIGGER fail_transfer_322 BEFORE UPDATE ON PRODUCTO FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FALLO_PRE_COMMIT_322'
  `);
  try {
    const failed = await responseBody(
      await confirm(f, retryKey, validQuote),
      503,
    );
    assert.equal(failed.code, 'CONFIRMACION_NO_DISPONIBLE');
    const pending = await responseBody(
      await request({ auth: f.auth, path: `/${retryKey}` }),
      202,
    );
    assert.equal(pending.data.estado, 'PENDIENTE');
    const during = await transferState(f);
    assert.equal(during.orders.length, 0);
    assert.equal(during.stock, beforeRollback.stock);
    assert.deepEqual(during.items, beforeRollback.items);
  } finally {
    await db.query('DROP TRIGGER fail_transfer_322');
  }

  // Reintento con la misma clave tras superar el fallo transitorio confirma 201
  const recoveredConfirm = await responseBody(
    await confirm(f, retryKey, validQuote),
    201,
  );
  assert.equal(recoveredConfirm.data.estado, 'CONFIRMADO');
  assert.equal(recoveredConfirm.data.modalidadPago, 'TRANSFERENCIA');

  // 3. Anti-IDOR: otro cliente no puede consultar la clave de f
  const foreignLookup = await responseBody(
    await request({ auth: other.auth, path: `/${retryKey}` }),
    404,
  );
  assert.equal(foreignLookup.code, 'INTENTO_NO_ENCONTRADO');
});

test('#322 Precios sintéticos (#286) rechazados en elegibilidad y confirmación de transferencia', async () => {
  const f = await createTransferFixture({ clientType: 'PARTICULAR' });
  const cotizacion = await quoteFor(f.auth);

  await db.query(
    'UPDATE PRECIO_USD_EVIDENCIA SET sintetica = 1, evidencia = ? WHERE id_producto = ?',
    [`SINTETICO ACADEMICO #286 SHA256:${'a'.repeat(64)}`, f.productId],
  );
  const before = await transferState(f);
  const headers = { 'X-Academic-Checkout': 'true' };

  const eligibility = await responseBody(
    await request({ path: '/eligibilidad', auth: f.auth, headers }),
    200,
  );
  assert.equal(eligibility.data.elegible, false);
  assert.equal(eligibility.data.codigo, 'PRECIO_SINTETICO');
  assert.equal(eligibility.data.cotizacion, null);

  const rejected = await responseBody(
    await confirm(f, randomUUID(), cotizacion, headers),
    422,
  );
  assert.equal(rejected.code, 'PRECIO_SINTETICO');
  assert.equal(rejected.estado, 'RECHAZADO');

  const after = await transferState(f);
  assert.equal(after.orders.length, 0);
  assert.equal(after.stock, before.stock);
  assert.deepEqual(after.items, before.items);
});

test('#322 Notificaciones post-COMMIT: confirmTransferOrder emite notifyCommittedChange solo tras COMMIT exitoso', async () => {
  const { confirmTransferOrder } = require('../dist/services/orders/transfer-order.service.js');
  const f = await createTransferFixture({ clientType: 'PARTICULAR' });
  const cotizacion = await quoteFor(f.auth);
  const key = randomUUID();
  const notifications = [];

  const result = await confirmTransferOrder(
    f.auth,
    key,
    cotizacion,
    change => notifications.push(change),
  );
  assert.equal(result.status, 201);
  assert.deepEqual(notifications, [
    {
      kind: 'order',
      clientId: f.clientId,
      order: {
        pedidoId: result.body.data.pedidoId,
        estado: 'CONFIRMADO',
        modalidadPago: 'TRANSFERENCIA',
      },
      productIds: [f.productId],
    },
  ]);

  // Replay con la misma clave NO vuelve a emitir notifyCommittedChange
  const replay = await confirmTransferOrder(
    f.auth,
    key,
    cotizacion,
    change => notifications.push(change),
  );
  assert.equal(replay.status, 200);
  assert.equal(notifications.length, 1);
});

test('#322 Recuperación idempotente tras fallo incierto post-COMMIT (DatabaseOutcomeUnknownError)', async t => {
  const { DatabaseOutcomeUnknownError } = require('../dist/config/database-policy.js');
  const f = await createTransferFixture({ clientType: 'PARTICULAR' });
  const cotizacion = await quoteFor(f.auth);
  const key = randomUUID();
  const attemptsRepo = require('../dist/repositories/transferOrderAttempt.repository.js');
  const originalFind = attemptsRepo.findTransferOrderAttempt;
  const createRunner = database.dataSource.createQueryRunner.bind(database.dataSource);

  let commitDropped = false;
  let transientRecoverFailure = false;
  let capturedInTransactionError = null;

  const originalInTransaction = database.inTransaction.bind(database);
  t.mock.method(database, 'inTransaction', async (...args) => {
    try {
      return await originalInTransaction(...args);
    } catch (error) {
      if (commitDropped && !capturedInTransactionError) {
        capturedInTransactionError = error;
      }
      throw error;
    }
  });

  t.mock.method(database.dataSource, 'createQueryRunner', (...args) => {
    const runner = createRunner(...args);
    const commit = runner.commitTransaction.bind(runner);

    runner.commitTransaction = async () => {
      const rootTransaction = runner.transactionDepth === 1;
      await commit();

      if (!rootTransaction || commitDropped) return;

      const [row] = await db.query(`
        SELECT estado FROM CONFIRMACION_PEDIDO_TRANSFERENCIA
        WHERE id_cliente = ? AND clave = ?
      `, [f.clientId, key]);

      if (row?.estado === 'CONFIRMADO') {
        commitDropped = true;
        transientRecoverFailure = true;
        throw new Error('ACUSE_COMMIT_PERDIDO_322');
      }
    };

    return runner;
  });

  // Simular que la primera lectura de recuperación inmediatamente posterior al
  // DatabaseOutcomeUnknownError también falla transitoriamente (devuelve 202 PENDIENTE),
  // obligando al cliente a recuperar con GET /api/pedidos/transferencia/:clave.
  t.mock.method(attemptsRepo, 'findTransferOrderAttempt', async (clientId, attemptKey) => {
    if (transientRecoverFailure && clientId === f.clientId && attemptKey === key) {
      transientRecoverFailure = false;
      throw new Error('FALLO_LECTURA_RECUPERACION_322');
    }
    return originalFind(clientId, attemptKey);
  });

  const uncertainPost = await confirm(f, key, cotizacion);
  assert.equal(commitDropped, true);
  assert.ok(
    capturedInTransactionError instanceof DatabaseOutcomeUnknownError,
    'El fallo post-COMMIT debe traducirse en DatabaseOutcomeUnknownError',
  );
  assert.equal(uncertainPost.headers.get('retry-after'), '1');
  const pendingBody = await responseBody(uncertainPost, 202);
  assert.equal(pendingBody.data.estado, 'PENDIENTE');
  assert.equal(pendingBody.data.code, 'CONFIRMACION_PENDIENTE');

  // GET /api/pedidos/transferencia/:clave recupera el pedido confirmado sin duplicarlo
  const recoveredGet = await responseBody(
    await request({ path: `/${key}`, auth: f.auth }),
    200,
  );
  assert.deepEqual(recoveredGet, {
    data: {
      pedidoId: recoveredGet.data.pedidoId,
      estado: 'CONFIRMADO',
      modalidadPago: 'TRANSFERENCIA',
      moneda: 'USD',
      totalUSD: '30.00',
    },
  });

  // Reintentar POST con la misma clave devuelve el mismo resultado (200) sin volver a descontar stock
  const replayPost = await responseBody(
    await confirm(f, key, cotizacion),
    200,
  );
  assert.deepEqual(replayPost, recoveredGet);

  const after = await transferState(f);
  assert.equal(after.orders.length, 1);
  assert.equal(after.orders[0].id_pedido, recoveredGet.data.pedidoId);
  assert.equal(after.stock, 3);
  assert.deepEqual(after.items, []);
  assert.deepEqual(after.movements, []);
  assert.deepEqual(after.payments, []);
  assert.equal(after.transferAttempts, 1);
});

