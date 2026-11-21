// #333 / T-S7-10.2 — Declaración, revisión documental y acreditación de pagos
// sobre cuentas corrientes. Requiere MariaDB 11.4 descartable preparada por
// test/helpers/run-cuenta-corriente-mariadb.cjs (modo payments).
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { after, before, test } = require('node:test');
const { childProfile, connectOwned } = require('./helpers/cc260-disposable.cjs');

let session, db, database, ledger, signToken, server, base;
let admin, admin2, adminInactive;
let particular;
let origin;

const idem = () => randomUUID();

function pricingReference() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const previous = new Date(`${today}T12:00:00Z`);
  const days = {};
  let reference = null;
  for (let i = 0; i < 15; i++) {
    previous.setUTCDate(previous.getUTCDate() - 1);
    const key = previous.toISOString().slice(0, 10);
    const weekend = previous.getUTCDay() === 0 || previous.getUTCDay() === 6;
    days[key] = !weekend;
    if (!weekend && reference === null) reference = key;
  }
  return { reference, days };
}

async function insert(sql, params = []) {
  return Number((await db.query(sql, params)).insertId);
}

async function verifiedQuote(rate) {
  const version = `fer333-${randomUUID()}`;
  const { reference, days } = pricingReference();
  assert.ok(reference, 'la referencia de cotización debe existir');
  await insert(`
    INSERT INTO FER17_CALENDARIO (version, dias_json, evidencia, id_admin, verificado_utc, activo, sintetica)
    VALUES (?, ?, 'DEMO calendario verificado', ?, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND), 1, 0)
  `, [version, JSON.stringify(days), admin.id]);
  const [existing] = await db.query(
    'SELECT id_cotizacion FROM COTIZACION WHERE fecha_referencia = ?', [reference],
  );
  let quoteId;
  if (existing) {
    quoteId = Number(existing.id_cotizacion);
    await db.query('UPDATE COTIZACION SET tasa = ?, valida = 1 WHERE id_cotizacion = ?', [rate, quoteId]);
  } else {
    quoteId = await insert(`
      INSERT INTO COTIZACION (tasa, fecha_referencia, fecha_carga, actor, valida)
      VALUES (?, ?, DATE_FORMAT(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 3 HOUR), '%Y-%m-%d %H:%i:%s'), 'DEMO BNA', 1)
    `, [rate, reference]);
  }
  await db.query(`
    INSERT INTO FER17_COTIZACION_VERIFICACION
      (id_cotizacion, tasa_verificada, referencia_verificada, cargada_utc,
       actor_carga_verificado, banco, tipo, evidencia, id_admin, verificado_utc, valida, sintetica)
    VALUES (?, ?, ?, UTC_TIMESTAMP(3), 'DEMO BNA', 'BNA', 'VENDEDOR',
      'DEMO verificación de cotización', ?, UTC_TIMESTAMP(3), 1, 0)
    ON DUPLICATE KEY UPDATE
      tasa_verificada = VALUES(tasa_verificada),
      referencia_verificada = VALUES(referencia_verificada),
      valida = 1, sintetica = 0
  `, [quoteId, rate, reference, admin.id]);
  return quoteId;
}

async function newCompany(label, { charge = '100.00', complete = true, enabled = 1 } = {}) {
  const suffix = randomUUID();
  const clientId = await insert(`
    INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, email,
      estado_aprobacion_empresa, es_fiel, activo)
    VALUES ('EMPRESA', ?, ?, 'APROBADA', 0, 1)
  `, [`EMPRESA ${label}`, `${label}-${suffix}@example.test`]);
  const userId = await insert(`
    INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo)
    VALUES (?, ?, 'test-only', 'CLIENTE', 1)
  `, [clientId, `${label}-${suffix}@example.test`]);
  const accountId = await insert(`
    INSERT INTO CUENTA_CORRIENTE (id_cliente, limite_credito, habilitada, cobertura, plazo_dias,
      moneda_limite, evidencia_limite, evidencia_plazo, evidencia_cobertura,
      cobertura_desde_utc, origen_datos, revision)
    VALUES (?, 10000.00, 1, ?, 30, 'USD', 'DEMO límite', 'DEMO plazo', ?, ?, 'REAL', 0)
  `, [clientId, complete ? 'COMPLETA' : 'PARCIAL',
    complete ? 'DEMO cobertura completa' : null,
    complete ? '2020-01-01 00:00:00' : null]);
  const orderId = await insert(`
    INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total,
      moneda_total, evidencia_total_usd)
    VALUES (?, 'CONFIRMADO', 'CUENTA_CORRIENTE', ?, 0, ?, 'USD', 'DEMO total histórico')
  `, [clientId, charge, charge]);
  if (charge !== '0.00') {
    await ledger.registrarCargoPorPedido({
      id_cuenta_corriente: accountId,
      id_pedido: orderId,
      monto: charge,
      moneda: 'USD',
    });
  }
  if (enabled !== 1) {
    await db.query('UPDATE CUENTA_CORRIENTE SET habilitada = ? WHERE id_cuenta_corriente = ?', [enabled, accountId]);
  }
  return {
    label,
    clientId,
    userId,
    accountId,
    orderId,
    token: signToken({ id: userId, rol: 'CLIENTE' }),
  };
}

async function newReceipt(company, { orderId = null, user = null } = {}) {
  const receiptId = randomUUID();
  await insert(`
    INSERT INTO COMPROBANTE_PAGO (id_comprobante, id_cliente, id_usuario_carga,
      id_pedido, id_cuenta_corriente, tipo_mime, bytes, sha256, fecha_utc)
    VALUES (?, ?, ?, ?, ?, 'application/pdf', 10, UNHEX(SHA2(?, 256)), UTC_TIMESTAMP(3))
  `, [receiptId, company.clientId, user ?? company.userId, orderId, company.accountId, receiptId]);
  return receiptId;
}

async function api(path, { method = 'GET', token, key, body, headers = {} } = {}) {
  const requestHeaders = {
    Origin: origin,
    Connection: 'close',
    ...headers,
  };
  if (token) requestHeaders.Cookie = `jwt_token=${token}`;
  if (key) requestHeaders['Idempotency-Key'] = key;
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const response = await fetch(base + path, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  return { status: response.status, body: payload, headers: response.headers };
}

async function declare(company, amount, options = {}) {
  const receiptId = options.receiptId ?? await newReceipt(company, { orderId: options.orderId });
  const key = options.key ?? idem();
  const response = await api('/cuenta-corriente/pagos', {
    method: 'POST',
    token: options.token ?? company.token,
    key,
    body: {
      monto: amount,
      moneda: options.currency ?? 'USD',
      comprobanteId: receiptId,
      ...(options.observaciones === undefined ? {} : { observaciones: options.observaciones }),
    },
  });
  return { ...response, key, receiptId };
}

async function review(paymentId, decision, options = {}) {
  return api(`/admin/pagos/${paymentId}/revision`, {
    method: 'PATCH',
    token: options.token ?? admin.token,
    body: { decision, ...(options.motivo === undefined ? {} : { motivo: options.motivo }) },
  });
}

async function accredit(paymentId, options = {}) {
  return api(`/admin/pagos/${paymentId}/acreditar`, {
    method: 'POST',
    token: options.token ?? admin.token,
    key: options.key ?? idem(),
    body: { evidencia: options.evidencia ?? 'Extracto bancario verificado por ADMIN' },
  });
}

async function preparedPayment(company, amount, options = {}) {
  const declaration = await declare(company, amount, options);
  assert.equal(declaration.status, 201, JSON.stringify(declaration.body));
  const paymentId = declaration.body.data.id;
  const validation = await review(paymentId, 'APROBADO');
  assert.equal(validation.status, 200, JSON.stringify(validation.body));
  return { paymentId, declaration, receiptId: declaration.receiptId };
}

async function balance(accountId) {
  const state = await ledger.calcularEstadoCuenta(accountId);
  return state ? state.deuda_vigente : null;
}

async function ledgerSnapshot(accountId) {
  return {
    movements: await db.query(`
      SELECT id_movimiento_cuenta, tipo_movimiento, id_pedido, id_pago, monto, moneda,
             estado, autorizado_por, huella_registro, evidencia_origen
      FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?
      ORDER BY id_movimiento_cuenta
    `, [accountId]),
    imputations: await db.query(`
      SELECT id_imputacion, id_cargo, id_abono, monto_imputado, estado, evento
      FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_cuenta_corriente = ?
      ORDER BY id_imputacion
    `, [accountId]),
    saldo: await balance(accountId),
  };
}

async function paymentsFor(accountId) {
  return db.query(`
    SELECT id_pago, estado, estado_documental, monto, monto_usd, moneda,
           id_cotizacion, tasa_historica,
           id_usuario_declarante, id_admin_revision, id_admin_acreditacion,
           clave_idempotencia, huella_declaracion, clave_acreditacion, id_comprobante,
           fecha_acreditacion_utc, evidencia_acreditacion, revision_utc, motivo_revision
    FROM PAGO WHERE id_cuenta_corriente = ? ORDER BY id_pago
  `, [accountId]);
}

async function movementForPayment(paymentId) {
  return db.query(`
    SELECT id_movimiento_cuenta, tipo_movimiento, monto, moneda, estado,
           monto_original, moneda_original, id_cotizacion, tasa_historica,
           autorizado_por, huella_registro, evidencia_origen
    FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago = ?
  `, [paymentId]);
}

before(async () => {
  session = await connectOwned(childProfile());
  db = session.connection;
  database = require('../dist/config/database.config');
  await database.initializeDatabase();
  ({ signToken } = require('../dist/services/token.service'));
  ledger = require('../dist/repositories/cuentaCorriente.repository');
  origin = process.env.APP_PUBLIC_ORIGIN || 'http://browser.test';

  const adminId = await insert(`
    INSERT INTO USUARIO (email, password_hash, rol, activo)
    VALUES (?, 'test-only', 'ADMIN', 1)
  `, [`admin-${randomUUID()}@example.test`]);
  admin = { id: adminId, token: signToken({ id: adminId, rol: 'ADMIN' }) };
  const admin2Id = await insert(`
    INSERT INTO USUARIO (email, password_hash, rol, activo)
    VALUES (?, 'test-only', 'ADMIN', 1)
  `, [`admin2-${randomUUID()}@example.test`]);
  admin2 = { id: admin2Id, token: signToken({ id: admin2Id, rol: 'ADMIN' }) };
  const inactiveId = await insert(`
    INSERT INTO USUARIO (email, password_hash, rol, activo)
    VALUES (?, 'test-only', 'ADMIN', 0)
  `, [`admin-inactive-${randomUUID()}@example.test`]);
  adminInactive = { id: inactiveId, token: signToken({ id: inactiveId, rol: 'ADMIN' }) };

  const particularClient = await insert(`
    INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, email, es_fiel, activo)
    VALUES ('PARTICULAR', 'Particular #333', ?, 0, 1)
  `, [`particular-${randomUUID()}@example.test`]);
  const particularUser = await insert(`
    INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo)
    VALUES (?, ?, 'test-only', 'CLIENTE', 1)
  `, [particularClient, `particular-${randomUUID()}@example.test`]);
  particular = {
    clientId: particularClient,
    userId: particularUser,
    token: signToken({ id: particularUser, rol: 'CLIENTE' }),
  };

  server = require('../dist/app').app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  try {
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await database?.destroyDatabase();
  } finally {
    await session?.connection.end();
  }
});

test('#333 declaración inicial: PAGO PENDIENTE sin movimientos, imputaciones ni cambio de saldo', async () => {
  const company = await newCompany('declaracion', { charge: '100.00' });
  const receiptId = await newReceipt(company, { orderId: company.orderId });
  const before = await ledgerSnapshot(company.accountId);

  const response = await declare(company, '40.00', { receiptId, observaciones: 'Pago parcial de prueba' });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const payment = response.body.data;
  assert.equal(payment.estado, 'PENDIENTE');
  assert.equal(payment.estadoDocumental, 'PENDIENTE');
  assert.equal(payment.monto, '40.00');
  assert.equal(payment.montoUsd, null);
  assert.equal(payment.moneda, 'USD');
  assert.equal(payment.observaciones, 'Pago parcial de prueba');
  assert.equal(payment.comprobanteId, receiptId);
  assert.equal(payment.pedidoId, company.orderId);
  assert.equal(payment.acreditadoEn, null);
  assert.equal(payment.clienteId, undefined, 'el cliente no recibe identidad de otros clientes');

  const afterDeclaration = await ledgerSnapshot(company.accountId);
  assert.deepEqual(afterDeclaration.movements, before.movements);
  assert.deepEqual(afterDeclaration.imputations, before.imputations);
  assert.equal(afterDeclaration.saldo, before.saldo);

  const [row] = await paymentsFor(company.accountId);
  assert.equal(row.estado, 'PENDIENTE');
  assert.equal(row.estado_documental, 'PENDIENTE');
  assert.equal(Number(row.id_usuario_declarante), company.userId);
  assert.equal(row.clave_idempotencia, response.key);
  assert.equal(row.id_comprobante, receiptId);
  assert.ok(row.huella_declaracion);

  // La revisión documental del comprobante (#275) tampoco acredita dinero.
  const receiptReview = await api(`/admin/comprobantes/${receiptId}/revision`, {
    method: 'PATCH', token: admin.token,
  });
  assert.equal(receiptReview.status, 200, JSON.stringify(receiptReview.body));
  assert.equal((await paymentsFor(company.accountId))[0].estado, 'PENDIENTE');
  const afterReceiptReview = await ledgerSnapshot(company.accountId);
  assert.deepEqual(afterReceiptReview.movements, before.movements);
  assert.deepEqual(afterReceiptReview.imputations, before.imputations);
  assert.equal(afterReceiptReview.saldo, before.saldo);
});

test('#333 declaración idempotente: misma clave y contenido no duplica; contenido distinto se rechaza', async () => {
  const company = await newCompany('declaracion-idem', { charge: '50.00' });
  const receiptId = await newReceipt(company);
  const key = idem();
  const body = { monto: '10.00', moneda: 'USD', comprobanteId: receiptId, observaciones: 'Reintento' };

  const first = await api('/cuenta-corriente/pagos', {
    method: 'POST', token: company.token, key, body,
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const second = await api('/cuenta-corriente/pagos', {
    method: 'POST', token: company.token, key, body,
  });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.data.id, first.body.data.id);
  assert.equal(second.body.meta.replay, true);

  const changed = await api('/cuenta-corriente/pagos', {
    method: 'POST', token: company.token, key,
    body: { ...body, monto: '11.00' },
  });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');

  const sameReceiptNewKey = await api('/cuenta-corriente/pagos', {
    method: 'POST', token: company.token, key: idem(), body,
  });
  assert.equal(sameReceiptNewKey.status, 200, JSON.stringify(sameReceiptNewKey.body));
  assert.equal(sameReceiptNewKey.body.data.id, first.body.data.id);

  const sameReceiptDifferentAmount = await api('/cuenta-corriente/pagos', {
    method: 'POST', token: company.token, key: idem(),
    body: { ...body, monto: '12.00' },
  });
  assert.equal(sameReceiptDifferentAmount.status, 409);
  assert.equal(sameReceiptDifferentAmount.body.code, 'COMPROBANTE_YA_DECLARADO');

  assert.equal((await paymentsFor(company.accountId)).length, 1);
});

test('#333 declaraciones simultáneas con la misma clave crean una sola fila', async () => {
  const company = await newCompany('declaracion-concurrente', { charge: '50.00' });
  const receiptId = await newReceipt(company);
  const key = idem();
  const body = { monto: '10.00', moneda: 'USD', comprobanteId: receiptId };
  const [first, second] = await Promise.all([
    api('/cuenta-corriente/pagos', { method: 'POST', token: company.token, key, body }),
    api('/cuenta-corriente/pagos', { method: 'POST', token: company.token, key, body }),
  ]);
  assert.deepEqual([first.status, second.status].sort((a, b) => a - b), [200, 201],
    JSON.stringify({ first, second }));
  assert.equal(first.body.data.id, second.body.data.id);
  assert.equal((await paymentsFor(company.accountId)).length, 1);
  assert.equal((await ledgerSnapshot(company.accountId)).movements.length, 1);
});

test('#333 revisión documental no acredita y el rechazo bloquea la acreditación', async () => {
  const company = await newCompany('revision', { charge: '30.00' });
  const declaration = await declare(company, '10.00');
  assert.equal(declaration.status, 201, JSON.stringify(declaration.body));
  const paymentId = declaration.body.data.id;
  const before = await ledgerSnapshot(company.accountId);

  const premature = await accredit(paymentId);
  assert.equal(premature.status, 409, JSON.stringify(premature.body));
  assert.equal(premature.body.code, 'PAGO_PENDIENTE_REVISION');
  assert.deepEqual((await ledgerSnapshot(company.accountId)).movements, before.movements);
  assert.equal((await paymentsFor(company.accountId))[0].estado, 'PENDIENTE');

  const validation = await review(paymentId, 'APROBADO');
  assert.equal(validation.status, 200, JSON.stringify(validation.body));
  assert.equal(validation.body.data.estado, 'PENDIENTE');
  assert.equal(validation.body.data.estadoDocumental, 'APROBADO');
  assert.ok(validation.body.data.revisadoEn.endsWith('Z'));
  const [reviewed] = await paymentsFor(company.accountId);
  assert.equal(Number(reviewed.id_admin_revision), admin.id);
  assert.ok(reviewed.revision_utc);
  const afterValidation = await ledgerSnapshot(company.accountId);
  assert.deepEqual(afterValidation.movements, before.movements);
  assert.deepEqual(afterValidation.imputations, before.imputations);
  assert.equal(afterValidation.saldo, before.saldo);

  const repeated = await review(paymentId, 'APROBADO');
  assert.equal(repeated.status, 200, JSON.stringify(repeated.body));
  assert.equal(repeated.body.data.revisadoEn, validation.body.data.revisadoEn);
  assert.equal(Number((await paymentsFor(company.accountId))[0].id_admin_revision), admin.id);

  // P2-04: un pago PENDIENTE puede rechazarse financieramente aunque su
  // revisión documental ya esté APROBADA. El rechazo es terminal y no mueve saldo.
  const contradictory = await review(paymentId, 'RECHAZADO', { motivo: 'Cambio de decisión' });
  assert.equal(contradictory.status, 200, JSON.stringify(contradictory.body));
  assert.equal(contradictory.body.data.estado, 'RECHAZADO');
  assert.equal(contradictory.body.data.estadoDocumental, 'RECHAZADO');
  assert.equal(contradictory.body.data.motivoRevision, 'Cambio de decisión');
  const afterContradictory = await ledgerSnapshot(company.accountId);
  assert.deepEqual(afterContradictory.movements, before.movements);
  assert.deepEqual(afterContradictory.imputations, before.imputations);
  assert.equal(afterContradictory.saldo, before.saldo);
  const blockedAfterRejection = await accredit(paymentId);
  assert.equal(blockedAfterRejection.status, 409, JSON.stringify(blockedAfterRejection.body));
  assert.equal(blockedAfterRejection.body.code, 'TRANSICION_PAGO_INVALIDA');
  assert.equal((await movementForPayment(paymentId)).length, 0);

  const rejectedDeclaration = await declare(company, '5.00');
  assert.equal(rejectedDeclaration.status, 201, JSON.stringify(rejectedDeclaration.body));
  const rejectedId = rejectedDeclaration.body.data.id;
  const rejection = await review(rejectedId, 'RECHAZADO', { motivo: 'Comprobante ilegible' });
  assert.equal(rejection.status, 200, JSON.stringify(rejection.body));
  assert.equal(rejection.body.data.estado, 'RECHAZADO');
  assert.equal(rejection.body.data.estadoDocumental, 'RECHAZADO');
  assert.equal(rejection.body.data.motivoRevision, 'Comprobante ilegible');
  const rejectedPayment = (await paymentsFor(company.accountId)).find(row => row.id_pago === rejectedId);
  assert.equal(rejectedPayment.estado, 'RECHAZADO');
  assert.equal(Number(rejectedPayment.id_admin_revision), admin.id);

  const rejectedAccreditation = await accredit(rejectedId);
  assert.equal(rejectedAccreditation.status, 409, JSON.stringify(rejectedAccreditation.body));
  assert.equal(rejectedAccreditation.body.code, 'TRANSICION_PAGO_INVALIDA');
  assert.equal((await movementForPayment(rejectedId)).length, 0);

  const withoutReason = await declare(company, '6.00');
  const withoutReasonId = withoutReason.body.data.id;
  const invalidRejection = await review(withoutReasonId, 'RECHAZADO');
  assert.equal(invalidRejection.status, 400);
});

test('#333 acreditación autorizada: pago parcial, movimiento único y trazabilidad del actor', async () => {
  const company = await newCompany('acreditacion', { charge: '100.00' });
  const { paymentId } = await preparedPayment(company, '40.00');
  const before = await balance(company.accountId);

  const response = await accredit(paymentId, { evidencia: 'Transferencia confirmada en extracto BNA' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.estado, 'ACREDITADO');
  assert.equal(response.body.data.estadoDocumental, 'APROBADO');
  assert.equal(response.body.data.montoUsd, '40.00');
  assert.equal(response.body.data.acreditadoPorUsuarioId, admin.id);
  assert.ok(response.body.data.acreditadoEn.endsWith('Z'));
  assert.equal(response.body.data.evidenciaAcreditacion, 'Transferencia confirmada en extracto BNA');

  const [payment] = (await paymentsFor(company.accountId)).filter(row => row.id_pago === paymentId);
  assert.equal(payment.estado, 'ACREDITADO');
  assert.equal(payment.monto_usd, '40.00');
  assert.equal(Number(payment.id_admin_acreditacion), admin.id);
  assert.equal(payment.evidencia_acreditacion, 'Transferencia confirmada en extracto BNA');
  assert.ok(payment.fecha_acreditacion_utc);
  assert.equal(payment.clave_acreditacion, response.body.data.claveAcreditacion);

  const movements = await movementForPayment(paymentId);
  assert.equal(movements.length, 1);
  assert.equal(movements[0].tipo_movimiento, 'ABONO');
  assert.equal(movements[0].monto, '40.00');
  assert.equal(movements[0].moneda, 'USD');
  assert.equal(movements[0].estado, 'ACREDITADO');
  assert.equal(movements[0].autorizado_por, String(admin.id));
  assert.equal(JSON.parse(movements[0].evidencia_origen).referencia, 'Transferencia confirmada en extracto BNA');
  assert.equal(await balance(company.accountId), '60.00');
  assert.equal(Number((await db.query(
    'SELECT COUNT(*) n FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente = ?',
    [company.accountId],
  ))[0].n), 2);

  const [imputation] = await db.query(`
    SELECT monto_imputado, estado FROM IMPUTACION_MOVIMIENTO_CUENTA
    WHERE id_abono = ? AND estado = 'VIGENTE'
  `, [movements[0].id_movimiento_cuenta]);
  assert.equal(imputation.monto_imputado, '40.00');

  const replay = await accredit(paymentId, {
    key: response.body.data.claveAcreditacion,
    evidencia: 'Transferencia confirmada en extracto BNA',
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.meta.replay, true);
  assert.equal((await movementForPayment(paymentId)).length, 1);
  assert.equal(await balance(company.accountId), '60.00');

  const duplicated = await accredit(paymentId);
  assert.equal(duplicated.status, 409);
  assert.equal(duplicated.body.code, 'PAGO_YA_ACREDITADO');
  assert.equal((await movementForPayment(paymentId)).length, 1);
});

test('#333 pago total cancela la deuda sin exceder el importe declarado', async () => {
  const company = await newCompany('pago-total', { charge: '75.50' });
  const { paymentId } = await preparedPayment(company, '75.50');
  const response = await accredit(paymentId);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(await balance(company.accountId), '0.00');
  const due = await ledger.consultarVencimientos(company.accountId);
  assert.deepEqual(due, []);
  const [movement] = await movementForPayment(paymentId);
  assert.equal(movement.monto, '75.50');
});

test('#333 dos ADMIN concurrentes: una sola acreditación efectiva', async () => {
  const company = await newCompany('concurrentes', { charge: '100.00' });
  const { paymentId } = await preparedPayment(company, '30.00');
  const before = await balance(company.accountId);

  const [first, second] = await Promise.all([
    accredit(paymentId, { token: admin.token, evidencia: 'ADMIN A confirmó el ingreso' }),
    accredit(paymentId, { token: admin2.token, evidencia: 'ADMIN B confirmó el ingreso' }),
  ]);
  const statuses = [first.status, second.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409], JSON.stringify({ first, second }));
  const conflict = first.status === 409 ? first : second;
  assert.ok(['PAGO_YA_ACREDITADO', 'CONFLICTO_CONCURRENCIA'].includes(conflict.body.code));
  assert.equal((await movementForPayment(paymentId)).length, 1);
  assert.equal(await balance(company.accountId), '70.00');
  assert.notEqual(await balance(company.accountId), before);
});

test('#333 misma clave concurrente: replay idempotente sin doble movimiento', async () => {
  const company = await newCompany('concurrentes-key', { charge: '100.00' });
  const { paymentId } = await preparedPayment(company, '25.00');
  const key = idem();

  const [first, second] = await Promise.all([
    accredit(paymentId, { key, evidencia: 'Misma evidencia' }),
    accredit(paymentId, { key, evidencia: 'Misma evidencia' }),
  ]);
  assert.equal(first.status, 200, JSON.stringify(first));
  assert.equal(second.status, 200, JSON.stringify(second));
  assert.equal((await movementForPayment(paymentId)).length, 1);
  assert.equal(await balance(company.accountId), '75.00');

  const changed = await accredit(paymentId, { key, evidencia: 'Evidencia distinta' });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
  assert.equal((await movementForPayment(paymentId)).length, 1);
});

test('#333 error SQL en declaración: rollback total y sin PAGO parcial', async () => {
  const company = await newCompany('fallo-declaracion', { charge: '20.00' });
  const receiptId = await newReceipt(company);
  const key = idem();
  await db.query(`CREATE TRIGGER payment_test_declaration_fail BEFORE INSERT ON PAGO
    FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SIMULATED_DECLARATION_FAILURE'`);
  try {
    const response = await api('/cuenta-corriente/pagos', {
      method: 'POST', token: company.token, key,
      body: { monto: '10.00', moneda: 'USD', comprobanteId: receiptId },
    });
    assert.equal(response.status, 500, JSON.stringify(response.body));
    assert.equal((await db.query(
      'SELECT id_pago FROM PAGO WHERE id_cuenta_corriente = ?', [company.accountId],
    )).length, 0);
    assert.equal(await balance(company.accountId), '20.00');
  } finally {
    await db.query('DROP TRIGGER IF EXISTS payment_test_declaration_fail');
  }
});

test('#333 error SQL en acreditación: rollback de PAGO y ausencia de movimiento', async () => {
  const company = await newCompany('fallo-acreditacion', { charge: '100.00' });
  const { paymentId } = await preparedPayment(company, '40.00');
  const before = await ledgerSnapshot(company.accountId);
  await db.query(`CREATE TRIGGER payment_test_movement_fail BEFORE INSERT ON MOVIMIENTO_CUENTA_CORRIENTE
    FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SIMULATED_ACCREDITATION_FAILURE'`);
  try {
    const response = await accredit(paymentId);
    assert.equal(response.status, 500, JSON.stringify(response.body));
    const after = await ledgerSnapshot(company.accountId);
    assert.deepEqual(after.movements, before.movements);
    assert.deepEqual(after.imputations, before.imputations);
    assert.equal(after.saldo, before.saldo);
    const [payment] = (await paymentsFor(company.accountId)).filter(row => row.id_pago === paymentId);
    assert.equal(payment.estado, 'PENDIENTE');
    assert.equal(payment.estado_documental, 'APROBADO');
    assert.equal(payment.fecha_acreditacion_utc, null);
    assert.equal(payment.id_admin_acreditacion, null);
  } finally {
    await db.query('DROP TRIGGER IF EXISTS payment_test_movement_fail');
  }
  const retry = await accredit(paymentId);
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal((await movementForPayment(paymentId)).length, 1);
  assert.equal(await balance(company.accountId), '60.00');
});

test('#333 permisos, sesiones cruzadas y ausencia de datos financieros ajenos', async () => {
  const companyA = await newCompany('idor-a', { charge: '50.00' });
  const companyB = await newCompany('idor-b', { charge: '50.00' });
  const receiptA = await newReceipt(companyA);
  const receiptB = await newReceipt(companyB);
  const declarationA = await declare(companyA, '10.00', { receiptId: receiptA });
  assert.equal(declarationA.status, 201, JSON.stringify(declarationA.body));
  const paymentA = declarationA.body.data.id;

  const noSession = await api('/cuenta-corriente/pagos', {
    method: 'POST', key: idem(),
    body: { monto: '1.00', moneda: 'USD', comprobanteId: receiptA },
  });
  assert.equal(noSession.status, 401);

  const particularDeclaration = await declare(particular, '1.00', { receiptId: receiptA });
  assert.equal(particularDeclaration.status, 404);
  assert.equal(particularDeclaration.body.code, 'CUENTA_NO_ENCONTRADA');

  const clientAccreditation = await api(`/admin/pagos/${paymentA}/acreditar`, {
    method: 'POST', token: companyA.token, key: idem(), body: { evidencia: 'Intento de cliente' },
  });
  assert.equal(clientAccreditation.status, 403);

  const foreignDetail = await api(`/cuenta-corriente/pagos/${paymentA}`, { token: companyB.token });
  assert.equal(foreignDetail.status, 404);
  assert.equal(foreignDetail.body.code, 'PAGO_NO_ENCONTRADO');

  const foreignReceipt = await declare(companyA, '10.00', { receiptId: receiptB });
  assert.equal(foreignReceipt.status, 404);
  assert.equal(foreignReceipt.body.code, 'COMPROBANTE_NO_ENCONTRADO');

  const ownerDetail = await api(`/cuenta-corriente/pagos/${paymentA}`, { token: companyA.token });
  assert.equal(ownerDetail.status, 200, JSON.stringify(ownerDetail.body));
  assert.equal(ownerDetail.headers.get('cache-control'), 'private, no-store');
  assert.equal(ownerDetail.body.data.clienteId, undefined);
  assert.equal(ownerDetail.body.data.acreditadoPorUsuarioId, undefined);

  const adminList = await api('/admin/pagos', { token: admin.token });
  assert.equal(adminList.status, 200, JSON.stringify(adminList.body));
  const adminRow = adminList.body.data.items.find(item => item.id === paymentA);
  assert.ok(adminRow);
  assert.equal(adminRow.clienteId, companyA.clientId);
  assert.ok(adminRow.cliente.includes('idor-a'));

  const clientList = await api('/cuenta-corriente/pagos', { token: companyA.token });
  assert.equal(clientList.status, 200, JSON.stringify(clientList.body));
  assert.ok(clientList.body.data.items.every(item => item.id === paymentA));
  const foreignList = await api('/cuenta-corriente/pagos', { token: companyB.token });
  assert.equal(foreignList.status, 200);
  assert.ok(foreignList.body.data.items.every(item => item.id !== paymentA));

  const inactiveAdmin = await api(`/admin/pagos/${paymentA}/acreditar`, {
    method: 'POST', token: adminInactive.token, key: idem(),
    body: { evidencia: 'ADMIN inactivo' },
  });
  assert.equal(inactiveAdmin.status, 401);

  const forbiddenBody = await api('/cuenta-corriente/pagos', {
    method: 'POST', token: companyA.token, key: idem(),
    body: { monto: '5.00', moneda: 'USD', comprobanteId: receiptA, clienteId: companyB.clientId },
  });
  assert.equal(forbiddenBody.status, 400);
  assert.equal((await paymentsFor(companyA.accountId)).length, 1);
});

test('#333 vínculo de comprobante: inexistente, ajeno o con cuenta inconsistente se rechaza', async () => {
  const companyA = await newCompany('binding-a', { charge: '50.00' });
  const companyB = await newCompany('binding-b', { charge: '50.00' });

  const nonexistent = await declare(companyA, '10.00', { receiptId: randomUUID() });
  assert.equal(nonexistent.status, 404);
  assert.equal(nonexistent.body.code, 'COMPROBANTE_NO_ENCONTRADO');

  const foreignReceipt = await newReceipt(companyB);
  const foreign = await declare(companyA, '10.00', { receiptId: foreignReceipt });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.code, 'COMPROBANTE_NO_ENCONTRADO');

  // Sin FK física, el servicio debe rechazar una fila inconsistente que declare
  // el cliente A pero apunte a la cuenta corriente de B.
  const inconsistentReceipt = randomUUID();
  await insert(`
    INSERT INTO COMPROBANTE_PAGO (id_comprobante, id_cliente, id_usuario_carga,
      id_pedido, id_cuenta_corriente, tipo_mime, bytes, sha256, fecha_utc)
    VALUES (?, ?, ?, NULL, ?, 'application/pdf', 10, UNHEX(SHA2(?, 256)), UTC_TIMESTAMP(3))
  `, [inconsistentReceipt, companyA.clientId, companyA.userId, companyB.accountId, inconsistentReceipt]);
  const inconsistent = await declare(companyA, '10.00', { receiptId: inconsistentReceipt });
  assert.equal(inconsistent.status, 404);
  assert.equal(inconsistent.body.code, 'COMPROBANTE_NO_ENCONTRADO');

  // Comprobante de A vinculado a un pedido ajeno: el join de titularidad debe
  // impedir que se use como evidencia de la cuenta de A.
  const foreignOrderReceipt = randomUUID();
  await insert(`
    INSERT INTO COMPROBANTE_PAGO (id_comprobante, id_cliente, id_usuario_carga,
      id_pedido, id_cuenta_corriente, tipo_mime, bytes, sha256, fecha_utc)
    VALUES (?, ?, ?, ?, ?, 'application/pdf', 10, UNHEX(SHA2(?, 256)), UTC_TIMESTAMP(3))
  `, [foreignOrderReceipt, companyA.clientId, companyA.userId, companyB.orderId,
    companyA.accountId, foreignOrderReceipt]);
  const foreignOrder = await declare(companyA, '10.00', { receiptId: foreignOrderReceipt });
  assert.equal(foreignOrder.status, 404);
  assert.equal(foreignOrder.body.code, 'COMPROBANTE_NO_ENCONTRADO');

  assert.equal((await paymentsFor(companyA.accountId)).length, 0);
  assert.equal(await balance(companyA.accountId), '50.00');
});

test('#333 límite DECIMAL(12,2): máximo exacto aceptado y un centavo superior rechazado', async () => {
  const company = await newCompany('limite-decimal', { charge: '1.00' });
  const maxReceipt = await newReceipt(company);
  const accepted = await declare(company, '9999999999.99', { receiptId: maxReceipt });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
  assert.equal(accepted.body.data.monto, '9999999999.99');

  const overReceipt = await newReceipt(company);
  const rejected = await declare(company, '10000000000.00', { receiptId: overReceipt });
  assert.equal(rejected.status, 400);
  assert.equal((await paymentsFor(company.accountId)).length, 1);
  assert.equal((await movementForPayment(accepted.body.data.id)).length, 0);
  assert.equal(await balance(company.accountId), '1.00');
});

test('#333 cuenta restringida: cobertura incompleta y libro mixto bloquean la acreditación', async () => {
  const restricted = await newCompany('restringida', { charge: '100.00' });
  const { paymentId: restrictedPayment } = await preparedPayment(restricted, '25.00');
  await db.query(`
    UPDATE CUENTA_CORRIENTE SET cobertura = 'PARCIAL', evidencia_cobertura = NULL,
      cobertura_desde_utc = NULL WHERE id_cuenta_corriente = ?
  `, [restricted.accountId]);
  const restrictedBefore = await ledgerSnapshot(restricted.accountId);
  const restrictedResponse = await accredit(restrictedPayment);
  assert.equal(restrictedResponse.status, 409, JSON.stringify(restrictedResponse.body));
  assert.equal(restrictedResponse.body.code, 'CUENTA_NO_ACREDITADA');
  assert.deepEqual((await ledgerSnapshot(restricted.accountId)).movements, restrictedBefore.movements);
  const [restrictedRow] = (await paymentsFor(restricted.accountId)).filter(row => row.id_pago === restrictedPayment);
  assert.equal(restrictedRow.estado, 'PENDIENTE');
  assert.equal(restrictedRow.estado_documental, 'APROBADO');
  assert.equal(restrictedRow.fecha_acreditacion_utc, null);

  const mixed = await newCompany('mixta', { charge: '100.00' });
  const { paymentId: mixedPayment } = await preparedPayment(mixed, '10.00');
  const demoOrder = await insert(`
    INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total,
      moneda_total, evidencia_total_usd)
    VALUES (?, 'CONFIRMADO', 'CUENTA_CORRIENTE', 1.00, 0, 1.00, 'USD', 'DEMO total')
  `, [mixed.clientId]);
  await ledger.registrarCargoPorPedido({
    id_cuenta_corriente: mixed.accountId,
    id_pedido: demoOrder,
    monto: '1.00',
    moneda: 'USD',
    origen: 'DEMO',
  });
  const mixedBefore = await balance(mixed.accountId);
  const mixedResponse = await accredit(mixedPayment);
  assert.equal(mixedResponse.status, 409, JSON.stringify(mixedResponse.body));
  assert.equal(mixedResponse.body.code, 'CUENTA_RESTRINGIDA');
  assert.equal(await balance(mixed.accountId), mixedBefore);
  assert.equal((await movementForPayment(mixedPayment)).length, 0);
});

test('#333 cuenta inhabilitada conserva la posibilidad de acreditar el pago de deuda', async () => {
  const company = await newCompany('inhabilitada-pago', { charge: '80.00', enabled: 0 });
  const { paymentId } = await preparedPayment(company, '30.00');
  const response = await accredit(paymentId);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.estado, 'ACREDITADO');
  assert.equal(await balance(company.accountId), '50.00');
  assert.equal((await movementForPayment(paymentId)).length, 1);
});

test('#333 importes inválidos y campos financieros no permitidos se rechazan sin escrituras', async () => {
  const company = await newCompany('importes', { charge: '30.00' });
  const receiptId = await newReceipt(company);
  for (const monto of ['0.00', '-1.00', '1.001', '10000000000.00', '1e2', 100]) {
    const response = await api('/cuenta-corriente/pagos', {
      method: 'POST', token: company.token, key: idem(),
      body: { monto, moneda: 'USD', comprobanteId: receiptId },
    });
    assert.equal(response.status, 400, JSON.stringify({ monto, response }));
  }
  assert.equal((await paymentsFor(company.accountId)).length, 0);

  const { paymentId } = await preparedPayment(company, '10.00');
  const tampered = await api(`/admin/pagos/${paymentId}/acreditar`, {
    method: 'POST', token: admin.token, key: idem(),
    body: { evidencia: 'Intento de cambiar importe', monto: '999.00' },
  });
  assert.equal(tampered.status, 400);
  assert.equal((await movementForPayment(paymentId)).length, 0);
  assert.equal(await balance(company.accountId), '30.00');

  const missingEvidence = await api(`/admin/pagos/${paymentId}/acreditar`, {
    method: 'POST', token: admin.token, key: idem(), body: {},
  });
  assert.equal(missingEvidence.status, 400);
  assert.equal((await movementForPayment(paymentId)).length, 0);
});

test('#333 pago en ARS: sin cotización verificada no acredita; con cotización FER17-v1 convierte una sola vez', async () => {
  const company = await newCompany('ars', { charge: '100.00' });
  const declaration = await declare(company, '1000.00', { currency: 'ARS' });
  assert.equal(declaration.status, 201, JSON.stringify(declaration.body));
  const paymentId = declaration.body.data.id;
  const validation = await review(paymentId, 'APROBADO');
  assert.equal(validation.status, 200, JSON.stringify(validation.body));

  // Sin calendario FER17 verificado no se puede convertir: error funcional 422,
  // nunca un 500 genérico, y sin movimientos.
  const withoutCalendar = await accredit(paymentId);
  assert.equal(withoutCalendar.status, 422, JSON.stringify(withoutCalendar.body));
  assert.equal(withoutCalendar.body.code, 'COTIZACION_INVALIDA');
  assert.equal((await movementForPayment(paymentId)).length, 0);
  assert.equal(await balance(company.accountId), '100.00');

  const version = `fer333-${randomUUID()}`;
  const rate = '1000.00000000';
  const { reference, days } = pricingReference();
  assert.ok(reference, 'la referencia de cotización debe existir');
  await insert(`
    INSERT INTO FER17_CALENDARIO (version, dias_json, evidencia, id_admin, verificado_utc, activo, sintetica)
    VALUES (?, ?, 'DEMO calendario verificado', ?, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND), 1, 0)
  `, [version, JSON.stringify(days), admin.id]);

  // Con calendario pero sin cotización diaria en FER17_CALENDARIO: 409 funcional.
  const withoutDailyQuote = await accredit(paymentId);
  assert.equal(withoutDailyQuote.status, 409, JSON.stringify(withoutDailyQuote.body));
  assert.equal(withoutDailyQuote.body.code, 'COTIZACION_AUSENTE');
  assert.equal((await movementForPayment(paymentId)).length, 0);
  assert.equal(await balance(company.accountId), '100.00');

  const quoteId = await insert(`
    INSERT INTO COTIZACION (tasa, fecha_referencia, fecha_carga, actor, valida)
    VALUES (?, ?, DATE_FORMAT(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 3 HOUR), '%Y-%m-%d %H:%i:%s'), 'DEMO BNA', 1)
  `, [rate, reference]);

  // Cotización cargada pero no verificada: tampoco es acreditable ni deja rastros.
  const unverifiedQuote = await accredit(paymentId);
  assert.equal(unverifiedQuote.status, 422, JSON.stringify(unverifiedQuote.body));
  assert.equal(unverifiedQuote.body.code, 'COTIZACION_INVALIDA');
  assert.equal((await movementForPayment(paymentId)).length, 0);
  assert.equal(await balance(company.accountId), '100.00');

  await insert(`
    INSERT INTO FER17_COTIZACION_VERIFICACION
      (id_cotizacion, tasa_verificada, referencia_verificada, cargada_utc,
       actor_carga_verificado, banco, tipo, evidencia, id_admin, verificado_utc, valida, sintetica)
    VALUES (?, ?, ?, UTC_TIMESTAMP(3), 'DEMO BNA', 'BNA', 'VENDEDOR',
      'DEMO verificación de cotización', ?, UTC_TIMESTAMP(3), 1, 0)
  `, [quoteId, rate, reference, admin.id]);

  const response = await accredit(paymentId, { evidencia: 'Pago ARS verificado' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.montoUsd, '1.00');
  const [movement] = await movementForPayment(paymentId);
  assert.equal(movement.monto, '1.00');
  assert.equal(movement.moneda, 'USD');
  assert.equal(movement.monto_original, '1000.00');
  assert.equal(movement.moneda_original, 'ARS');
  assert.equal(Number(movement.id_cotizacion), quoteId);
  assert.equal(movement.tasa_historica, rate);
  assert.equal(await balance(company.accountId), '99.00');

  const [payment] = (await paymentsFor(company.accountId)).filter(row => row.id_pago === paymentId);
  assert.equal(payment.monto_usd, '1.00');
  assert.equal(Number(payment.id_cotizacion), quoteId);
  assert.equal(payment.tasa_historica, rate);
  assert.equal(payment.estado, 'ACREDITADO');
});

test('#333 cliente propio inactivo recibe 403 CLIENTE_INACTIVO y no un 404 ambiguo', async () => {
  const company = await newCompany('cliente-inactivo', { charge: '20.00' });
  const receiptId = await newReceipt(company);
  await db.query('UPDATE CLIENTE SET activo = 0 WHERE id_cliente = ?', [company.clientId]);

  const declaration = await declare(company, '5.00', { receiptId });
  assert.equal(declaration.status, 403, JSON.stringify(declaration.body));
  assert.equal(declaration.body.code, 'CLIENTE_INACTIVO');
  assert.equal((await paymentsFor(company.accountId)).length, 0);

  const list = await api('/cuenta-corriente/pagos', { token: company.token });
  assert.equal(list.status, 403, JSON.stringify(list.body));
  assert.equal(list.body.code, 'CLIENTE_INACTIVO');
});

test('#333 revalida el comprobante en revisión y acreditación antes de mover saldos', async () => {
  const companyA = await newCompany('receipt-revalidation-a', { charge: '50.00' });
  const companyB = await newCompany('receipt-revalidation-b', { charge: '50.00' });

  // Comprobante eliminado antes de la revisión documental.
  const first = await declare(companyA, '10.00');
  assert.equal(first.status, 201, JSON.stringify(first.body));
  await db.query('DELETE FROM COMPROBANTE_PAGO WHERE id_comprobante = ?', [first.receiptId]);
  const missingReview = await review(first.body.data.id, 'APROBADO');
  assert.equal(missingReview.status, 404, JSON.stringify(missingReview.body));
  assert.equal(missingReview.body.code, 'COMPROBANTE_NO_ENCONTRADO');
  const [firstRow] = (await paymentsFor(companyA.accountId)).filter(row => row.id_pago === first.body.data.id);
  assert.equal(firstRow.estado, 'PENDIENTE');
  assert.equal(firstRow.estado_documental, 'PENDIENTE');
  assert.equal(firstRow.fecha_acreditacion_utc, null);

  // Comprobante eliminado después de aprobar la revisión, antes de acreditar.
  const second = await declare(companyA, '12.00');
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal((await review(second.body.data.id, 'APROBADO')).status, 200);
  await db.query('DELETE FROM COMPROBANTE_PAGO WHERE id_comprobante = ?', [second.receiptId]);
  const before = await ledgerSnapshot(companyA.accountId);
  const missingAccreditation = await accredit(second.body.data.id);
  assert.equal(missingAccreditation.status, 404, JSON.stringify(missingAccreditation.body));
  assert.equal(missingAccreditation.body.code, 'COMPROBANTE_NO_ENCONTRADO');
  assert.deepEqual((await ledgerSnapshot(companyA.accountId)).movements, before.movements);
  assert.equal((await movementForPayment(second.body.data.id)).length, 0);
  const [secondRow] = (await paymentsFor(companyA.accountId)).filter(row => row.id_pago === second.body.data.id);
  assert.equal(secondRow.estado, 'PENDIENTE');
  assert.equal(secondRow.estado_documental, 'APROBADO');
  assert.equal(secondRow.fecha_acreditacion_utc, null);

  // Comprobante de otra empresa/cuenta vinculado a la declaración.
  const foreignReceipt = await newReceipt(companyB);
  const third = await declare(companyA, '7.00');
  assert.equal(third.status, 201, JSON.stringify(third.body));
  assert.equal((await review(third.body.data.id, 'APROBADO')).status, 200);
  await db.query('UPDATE PAGO SET id_comprobante = ? WHERE id_pago = ?', [foreignReceipt, third.body.data.id]);
  const beforeForeign = await ledgerSnapshot(companyA.accountId);
  const foreign = await accredit(third.body.data.id);
  assert.equal(foreign.status, 404, JSON.stringify(foreign.body));
  assert.equal(foreign.body.code, 'COMPROBANTE_NO_ENCONTRADO');
  assert.deepEqual((await ledgerSnapshot(companyA.accountId)).movements, beforeForeign.movements);
  assert.equal((await movementForPayment(third.body.data.id)).length, 0);
});

test('#333 cabeceras privadas en /api/admin/pagos incluso ante rechazos tempranos', async () => {
  for (const response of [
    await api('/admin/pagos'),
    await api('/admin/pagos?otro=1', { token: admin.token }),
    await api('/admin/pagos/abc', { token: admin.token }),
  ]) {
    assert.ok([400, 401].includes(response.status), JSON.stringify(response));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(response.headers.get('vary') ?? '', /Cookie/i);
  }
});

test('#333 filtra pagos DEMO_REGISTRADO y libros DEMO o mixtos también fuera de test', async () => {
  const company = await newCompany('demo-filter-real', { charge: '20.00' });
  const visible = await declare(company, '5.00');
  assert.equal(visible.status, 201, JSON.stringify(visible.body));
  const visibleId = visible.body.data.id;

  const demoPaymentId = await insert(`
    INSERT INTO PAGO (id_cuenta_corriente, fecha, monto, metodo_pago, estado, moneda)
    VALUES (?, UTC_TIMESTAMP(), 1.00, 'DEMO_METODO', 'DEMO_REGISTRADO', 'USD')
  `, [company.accountId]);

  const mixed = await newCompany('demo-filter-mixed', { charge: '20.00' });
  const hidden = await declare(mixed, '5.00');
  assert.equal(hidden.status, 201, JSON.stringify(hidden.body));
  const hiddenId = hidden.body.data.id;
  const demoOrder = await insert(`
    INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total,
      moneda_total, evidencia_total_usd)
    VALUES (?, 'CONFIRMADO', 'CUENTA_CORRIENTE', 1.00, 0, 1.00, 'USD', 'DEMO total')
  `, [mixed.clientId]);
  await ledger.registrarCargoPorPedido({
    id_cuenta_corriente: mixed.accountId,
    id_pedido: demoOrder,
    monto: '1.00',
    moneda: 'USD',
    origen: 'DEMO',
  });
  const blockedAfterMix = await declare(mixed, '1.00');
  assert.equal(blockedAfterMix.status, 409, JSON.stringify(blockedAfterMix.body));
  assert.equal(blockedAfterMix.body.code, 'CUENTA_RESTRINGIDA');

  const adminList = await api('/admin/pagos', { token: admin.token });
  assert.equal(adminList.status, 200, JSON.stringify(adminList.body));
  const adminIds = adminList.body.data.items.map(item => item.id);
  assert.ok(adminIds.includes(visibleId));
  assert.equal(adminIds.includes(demoPaymentId), false);
  assert.equal(adminIds.includes(hiddenId), false);

  const demoDetail = await api(`/admin/pagos/${demoPaymentId}`, { token: admin.token });
  assert.equal(demoDetail.status, 404);
  assert.equal(demoDetail.body.code, 'PAGO_NO_ENCONTRADO');
  const hiddenDetail = await api(`/admin/pagos/${hiddenId}`, { token: admin.token });
  assert.equal(hiddenDetail.status, 404);
  assert.equal(hiddenDetail.body.code, 'PAGO_NO_ENCONTRADO');

  const clientList = await api('/cuenta-corriente/pagos', { token: mixed.token });
  assert.equal(clientList.status, 200);
  assert.equal(clientList.body.data.items.some(item => item.id === hiddenId), false);
});

test('#333 conversión ARS que redondea a USD 0.00 se rechaza sin escribir', async () => {
  const company = await newCompany('ars-cero', { charge: '10.00' });
  const declaration = await declare(company, '0.01', { currency: 'ARS' });
  assert.equal(declaration.status, 201, JSON.stringify(declaration.body));
  const paymentId = declaration.body.data.id;
  assert.equal((await review(paymentId, 'APROBADO')).status, 200);
  await verifiedQuote('1000.00000000');

  const response = await accredit(paymentId);
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'MONTO_USD_INVALIDO');
  assert.equal((await movementForPayment(paymentId)).length, 0);
  assert.equal(await balance(company.accountId), '10.00');
  const [row] = (await paymentsFor(company.accountId)).filter(item => item.id_pago === paymentId);
  assert.equal(row.estado, 'PENDIENTE');
  assert.equal(row.monto_usd, null);
  assert.equal(row.id_cotizacion, null);
  assert.equal(row.tasa_historica, null);
});

test('#333 claves de idempotencia son globales entre cuentas y flujos', async () => {
  const companyA = await newCompany('global-key-a', { charge: '20.00' });
  const companyB = await newCompany('global-key-b', { charge: '20.00' });
  const receiptB = await newReceipt(companyB);
  const key = idem();
  const first = await declare(companyA, '5.00', { key });
  assert.equal(first.status, 201, JSON.stringify(first.body));

  const reused = await api('/cuenta-corriente/pagos', {
    method: 'POST', token: companyB.token, key,
    body: { monto: '5.00', moneda: 'USD', comprobanteId: receiptB },
  });
  assert.equal(reused.status, 409, JSON.stringify(reused.body));
  assert.equal(reused.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
  assert.equal((await paymentsFor(companyB.accountId)).length, 0);
});
