const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const { readdir } = require('node:fs/promises');
const path = require('node:path');
const { after, before, test } = require('node:test');
const mariadb = require('mariadb');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');
const { io } = require('socket.io-client');
const { fetchFromBrowser } = require('./helpers/browser-request.cjs');

const ORIGIN = process.env.APP_PUBLIC_ORIGIN;
const storage = process.env.RECEIPT_STORAGE_DIR;
const waitFor = (socket, event) => once(socket, event, { signal: AbortSignal.timeout(5000) });

let db;
let dataSource;
let backend;
let base;
let signToken;
let ledger;
let pdf1;
let pdf2;
let png1;
let jpg1;
let admin1;
let admin2;
let verifiedQuoteId;

async function q(sql, params = []) {
  return dataSource.query(sql, params);
}

async function insert(sql, params = []) {
  return Number((await q(sql, params)).insertId);
}

function cookie(auth) {
  return `jwt_token=${signToken(auth)}`;
}

async function api(path, { method = 'GET', auth, key, body, headers = {}, baseUrl = base } = {}) {
  const reqHeaders = {
    ...(auth ? { Cookie: cookie(auth) } : {}),
    ...(key ? { 'Idempotency-Key': key } : {}),
    ...(body !== undefined && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}),
    ...headers,
  };
  const response = await fetchFromBrowser(`${baseUrl}/api${path}`, {
    method,
    headers: reqHeaders,
    ...(body !== undefined ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, headers: response.headers, body: json };
}

async function financialSnapshot() {
  const result = {};
  for (const [table, orderCol] of [
    ['PEDIDO', 'id_pedido'],
    ['PAGO', 'id_pago'],
    ['CUENTA_CORRIENTE', 'id_cuenta_corriente'],
    ['MOVIMIENTO_CUENTA_CORRIENTE', 'id_movimiento_cuenta'],
    ['IMPUTACION_MOVIMIENTO_CUENTA', 'id_imputacion'],
  ]) {
    result[table] = await q(`SELECT * FROM ${table} ORDER BY ${orderCol}`);
  }
  return JSON.stringify(result, (_, v) => typeof v === 'bigint' ? String(v) : v);
}

async function createClient({
  type = 'PARTICULAR',
  approval = type === 'EMPRESA' ? 'APROBADA' : null,
  withAccount = false,
  habilitada = 1,
  cobertura = 'COMPLETA',
  origen = 'REAL',
  limite = '5000.00',
  plazo = 30,
} = {}) {
  const clientId = await insert(`
    INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, email, estado_aprobacion_empresa, es_fiel, activo)
    VALUES (?, ?, ?, ?, 0, 1)
  `, [type, `Cliente ${type} ${randomUUID().slice(0, 8)}`, `${randomUUID()}@s704.test`, approval]);
  const userId = await insert(`
    INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo)
    VALUES (?, ?, 'test-only', 'CLIENTE', 1)
  `, [clientId, `${randomUUID()}@s704.test`]);

  let accountId = null;
  if (withAccount) {
    accountId = await insert(`
      INSERT INTO CUENTA_CORRIENTE (
        id_cliente, limite_credito, habilitada, cobertura, plazo_dias,
        moneda_limite, evidencia_limite, evidencia_plazo, evidencia_cobertura,
        cobertura_desde_utc, origen_datos
      ) VALUES (?, ?, ?, ?, ?, 'USD', 'ACTA-S704', 'PLAZO-S704', ?, ?, ?)
    `, [
      clientId,
      limite,
      habilitada,
      cobertura,
      plazo,
      cobertura === 'COMPLETA' ? 'ALTA-S704' : null,
      cobertura === 'COMPLETA' ? '2020-01-01 00:00:00.000' : null,
      origen,
    ]);
  }
  return { clientId, userId, accountId, auth: { id: userId, rol: 'CLIENTE' } };
}

async function createOrder(clientId, {
  modalidad = 'TRANSFERENCIA',
  estado = 'CONFIRMADO',
  total = '200.00',
  moneda = 'USD',
  evidencia = 'FER17-v1:TEST',
} = {}) {
  return insert(`
    INSERT INTO PEDIDO (
      id_cliente, estado, modalidad_pago, subtotal, descuento, total,
      moneda_total, evidencia_total_usd, fecha_utc
    ) VALUES (?, ?, ?, ?, 0.00, ?, ?, ?, UTC_TIMESTAMP(3))
  `, [clientId, estado, modalidad, total, total, moneda, evidencia]);
}

async function seedVerifiedBnaQuote(adminId) {
  await q(`
    INSERT INTO FER17_CALENDARIO (version, dias_json, evidencia, id_admin, verificado_utc, activo, sintetica)
    VALUES ('s704-real-cal', ?, 'BCRA 2026 oficial', ?, '2026-10-02 12:00:00.000', 1, 0)
    ON DUPLICATE KEY UPDATE activo = 1, sintetica = 0
  `, [JSON.stringify({ '2026-10-01': true }), adminId]);

  await q(`
    INSERT INTO COTIZACION (tasa, fecha_referencia, fecha_carga, actor, valida)
    VALUES (1000.00000000, '2026-10-01', '2026-10-02 09:00:00', 'BNA Oficial', 1)
    ON DUPLICATE KEY UPDATE tasa = 1000.00000000, valida = 1
  `);
  const [quoteRow] = await q("SELECT id_cotizacion FROM COTIZACION WHERE fecha_referencia = '2026-10-01'");
  const qid = Number(quoteRow.id_cotizacion);

  await q(`
    INSERT INTO FER17_COTIZACION_VERIFICACION (
      id_cotizacion, tasa_verificada, referencia_verificada, cargada_utc,
      actor_carga_verificado, banco, tipo, evidencia, id_admin, verificado_utc, valida, sintetica
    ) VALUES (
      ?, 1000.00000000, '2026-10-01', '2026-10-02 12:00:00.000',
      'BNA Oficial', 'BNA', 'VENDEDOR', 'Verificacion BNA 2026-10-01', ?, '2026-10-02 12:30:00.000', 1, 0
    )
    ON DUPLICATE KEY UPDATE tasa_verificada = 1000.00000000, valida = 1, sintetica = 0
  `, [qid, adminId]);

  // Cotizacion sintetica separada para probar rechazo en cuentas REAL (NEG-10)
  await q(`
    INSERT INTO COTIZACION (tasa, fecha_referencia, fecha_carga, actor, valida)
    VALUES (1200.00000000, '2026-09-15', '2026-09-16 09:00:00', 'DEMO BNA', 1)
    ON DUPLICATE KEY UPDATE tasa = 1200.00000000, valida = 1
  `);
  const [synRow] = await q("SELECT id_cotizacion FROM COTIZACION WHERE fecha_referencia = '2026-09-15'");
  await q(`
    INSERT INTO FER17_COTIZACION_VERIFICACION (
      id_cotizacion, tasa_verificada, referencia_verificada, cargada_utc,
      actor_carga_verificado, banco, tipo, evidencia, id_admin, verificado_utc, valida, sintetica
    ) VALUES (
      ?, 1200.00000000, '2026-09-15', '2026-09-16 12:00:00.000',
      'DEMO BNA', 'BNA', 'VENDEDOR', 'DEMO sintetica', ?, '2026-09-16 12:30:00.000', 1, 1
    )
    ON DUPLICATE KEY UPDATE tasa_verificada = 1200.00000000, valida = 1, sintetica = 1
  `, [Number(synRow.id_cotizacion), adminId]);

  return qid;
}

async function connectSocket(t, auth, targetBase = base) {
  const socket = io(targetBase, {
    autoConnect: false,
    forceNew: true,
    transports: ['websocket'],
    reconnection: false,
    timeout: 3000,
    extraHeaders: {
      Origin: ORIGIN,
      Cookie: cookie(auth),
    },
  });
  t.after(() => socket.disconnect());
  const events = {
    orderStatus: [],
    receipt: [],
    payment: [],
  };
  socket.on('pedido.estado.actualizado.v1', payload => events.orderStatus.push(payload));
  socket.on('comprobante.estado.actualizado.v1', payload => events.receipt.push(payload));
  socket.on('pago.acreditado.v1', payload => events.payment.push(payload));
  const connected = waitFor(socket, 'connect');
  socket.connect();
  await connected;
  return { socket, events };
}

async function flushSockets(...connections) {
  await backend.waitForNotifications();
  await Promise.all(connections.map(async conn => {
    const serverSocket = backend.io.sockets.sockets.get(conn.socket.id);
    if (!serverSocket || !conn.socket.connected) return;
    const seen = waitFor(conn.socket, 'test:flush');
    serverSocket.emit('test:flush');
    await seen;
  }));
}

before(async () => {
  assert.ok(storage, 'RECEIPT_STORAGE_DIR debe estar configurado por el runner');
  db = require('../dist/config/database.config');
  dataSource = db.dataSource;
  await db.initializeDatabase();
  ({ signToken } = require('../dist/services/token.service'));
  ledger = require('../dist/repositories/cuentaCorriente.repository');
  backend = require('../dist/http-server').createBackendServer();
  backend.server.listen(0, '127.0.0.1');
  await once(backend.server, 'listening');
  base = `http://127.0.0.1:${backend.server.address().port}`;

  admin1 = {
    id: await insert("INSERT INTO USUARIO (email, password_hash, rol, activo) VALUES ('admin1@s704.test', 'test-only', 'ADMIN', 1)"),
    rol: 'ADMIN',
  };
  admin2 = {
    id: await insert("INSERT INTO USUARIO (email, password_hash, rol, activo) VALUES ('admin2@s704.test', 'test-only', 'ADMIN', 1)"),
    rol: 'ADMIN',
  };
  verifiedQuoteId = await seedVerifiedBnaQuote(admin1.id);

  const d1 = await PDFDocument.create();
  d1.addPage().drawText('Comprobante S7-04 PDF #1');
  pdf1 = Buffer.from(await d1.save());

  const d2 = await PDFDocument.create();
  d2.addPage().drawText('Comprobante S7-04 PDF #2');
  pdf2 = Buffer.from(await d2.save());

  png1 = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'white' } }).png().toBuffer();
  jpg1 = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'blue' } }).jpeg().toBuffer();
});

after(async () => {
  try { await backend?.close(); }
  finally { await db?.destroyDatabase(); }
});

test('1. INV-01 + NEG-05/06/07/08/09/13: comprobantes (PENDIENTE/APROBADO/RECHAZADO) dejan en 0 cambios financieros', async () => {
  const particular = await createClient({ type: 'PARTICULAR' });
  const other = await createClient({ type: 'PARTICULAR' });
  const company = await createClient({ type: 'EMPRESA', withAccount: true, habilitada: 1 });
  const transferOrderId = await createOrder(particular.clientId, { modalidad: 'TRANSFERENCIA', total: '150.00' });
  const ccOrderId = await createOrder(company.clientId, { modalidad: 'CUENTA_CORRIENTE', total: '300.00' });
  await ledger.registrarCargoPorPedido({
    id_cuenta_corriente: company.accountId,
    id_pedido: ccOrderId,
    monto: '300.00',
    moneda: 'USD',
  });

  const snapshotBefore = await financialSnapshot();
  const ccBefore = await ledger.calcularEstadoCuenta(company.accountId);

  // Carga de comprobante TRANSFERENCIA y comprobante CC -> ambos nacen PENDIENTE
  const upTransfer = await api(`/pedidos/${transferOrderId}/comprobantes`, {
    method: 'POST', auth: particular.auth, body: pdf1, headers: { 'Content-Type': 'application/pdf' },
  });
  assert.equal(upTransfer.status, 201);
  assert.equal(upTransfer.body.data.estadoRevision, 'PENDIENTE');

  const upCc = await api(`/pedidos/${ccOrderId}/comprobantes`, {
    method: 'POST', auth: company.auth, body: png1, headers: { 'Content-Type': 'image/png' },
  });
  assert.equal(upCc.status, 201);
  assert.equal(upCc.body.data.estadoRevision, 'PENDIENTE');

  // NEG-05: CLIENTE intenta invocar PATCH /api/admin/comprobantes/:id/revision o /api/admin/pedidos/:id/estado -> 403
  assert.equal(
    (await api(`/admin/comprobantes/${upTransfer.body.data.id}/revision`, {
      method: 'PATCH', auth: particular.auth, key: randomUUID(), body: { estado: 'APROBADO' },
    })).status,
    403,
  );
  assert.equal(
    (await api(`/admin/pedidos/${transferOrderId}/estado`, {
      method: 'PATCH', auth: particular.auth, body: { estado: 'EN_PREPARACION' },
    })).status,
    403,
  );

  // NEG-06: CLIENTE intenta subir comprobante a pedido ajeno (IDOR) -> 404 OPERACION_NO_ENCONTRADA
  const idorUp = await api(`/pedidos/${transferOrderId}/comprobantes`, {
    method: 'POST', auth: other.auth, body: pdf2, headers: { 'Content-Type': 'application/pdf' },
  });
  assert.equal(idorUp.status, 404);
  assert.equal(idorUp.body.code, 'OPERACION_NO_ENCONTRADA');

  // NEG-08: Rechazar sin Idempotency-Key o sin motivo o con motivo vacio/no string -> 400
  const noKey = await api(`/admin/comprobantes/${upTransfer.body.data.id}/revision`, {
    method: 'PATCH', auth: admin1, body: { estado: 'RECHAZADO', motivo: 'Ilegible' },
  });
  assert.equal(noKey.status, 400);
  assert.equal(noKey.body.code, 'CLAVE_IDEMPOTENCIA_REQUERIDA');

  for (const badBody of [{ estado: 'RECHAZADO' }, { estado: 'RECHAZADO', motivo: '   ' }, { estado: 'RECHAZADO', motivo: 42 }]) {
    const bad = await api(`/admin/comprobantes/${upTransfer.body.data.id}/revision`, {
      method: 'PATCH', auth: admin1, key: randomUUID(), body: badBody,
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'SOLICITUD_INVALIDA');
  }

  // Aprobar comprobante de TRANSFERENCIA con Idempotency-Key
  const approveKey = randomUUID();
  const approved = await api(`/admin/comprobantes/${upTransfer.body.data.id}/revision`, {
    method: 'PATCH', auth: admin1, key: approveKey, body: { estado: 'APROBADO' },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.data.estadoRevision, 'APROBADO');
  assert.equal(approved.body.data.motivoRechazo, null);

  // Replay idempotente (misma clave y payload -> 200)
  const replay = await api(`/admin/comprobantes/${upTransfer.body.data.id}/revision`, {
    method: 'PATCH', auth: admin1, key: approveKey, body: { estado: 'APROBADO' },
  });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body.data, approved.body.data);

  // NEG-13: Misma clave con distinto payload -> 409 CLAVE_IDEMPOTENCIA_REUTILIZADA
  const reused = await api(`/admin/comprobantes/${upTransfer.body.data.id}/revision`, {
    method: 'PATCH', auth: admin1, key: approveKey, body: { estado: 'RECHAZADO', motivo: 'Cambio posterior' },
  });
  assert.equal(reused.status, 409);
  assert.equal(reused.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');

  // NEG-07: Intentar rechazar un comprobante ya APROBADO con otra clave -> 409 COMPROBANTE_YA_RESUELTO
  const alreadyApproved = await api(`/admin/comprobantes/${upTransfer.body.data.id}/revision`, {
    method: 'PATCH', auth: admin2, key: randomUUID(), body: { estado: 'RECHAZADO', motivo: 'Otro criterio' },
  });
  assert.equal(alreadyApproved.status, 409);
  assert.equal(alreadyApproved.body.code, 'COMPROBANTE_YA_RESUELTO');

  // Rechazar comprobante de CC y verificar NEG-07 al intentar aprobarlo luego
  const rejectKey = randomUUID();
  const rejected = await api(`/admin/comprobantes/${upCc.body.data.id}/revision`, {
    method: 'PATCH', auth: admin1, key: rejectKey, body: { estado: 'RECHAZADO', motivo: 'No coincide titularidad' },
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.estadoRevision, 'RECHAZADO');
  assert.equal(rejected.body.data.motivoRechazo, 'No coincide titularidad');

  const approveRejected = await api(`/admin/comprobantes/${upCc.body.data.id}/revision`, {
    method: 'PATCH', auth: admin1, key: randomUUID(), body: { estado: 'APROBADO' },
  });
  assert.equal(approveRejected.status, 409);
  assert.equal(approveRejected.body.code, 'COMPROBANTE_YA_RESUELTO');

  // NEG-09 + INV-01: CERO cambios en PAGO, MOVIMIENTO_CUENTA_CORRIENTE, IMPUTACION, PEDIDO.estado y saldo CC
  assert.equal(await financialSnapshot(), snapshotBefore);
  assert.deepEqual(await ledger.calcularEstadoCuenta(company.accountId), ccBefore);
});

test('2. INV-02 + NEG-01/02/03/04: ciclo comercial del pedido sin estado PAGADO y grafo acíclico estricto', async () => {
  const client = await createClient({ type: 'PARTICULAR' });
  const orderId = await createOrder(client.clientId, { modalidad: 'TRANSFERENCIA', total: '100.00' });
  const demoOrderId = await createOrder(client.clientId, {
    modalidad: 'DEMO_DIRECTO', estado: 'DEMO_REGISTRADO', total: '100.00',
  });

  // NEG-03: estado: 'PAGADO' o campos financieros extra -> 400
  const neg03a = await api(`/admin/pedidos/${orderId}/estado`, {
    method: 'PATCH', auth: admin1, body: { estado: 'PAGADO' },
  });
  assert.equal(neg03a.status, 400);
  assert.equal(neg03a.body.code, 'ESTADO_PEDIDO_NO_AUTORIZADO');

  const neg03b = await api(`/admin/pedidos/${orderId}/estado`, {
    method: 'PATCH', auth: admin1, body: { estado: 'EN_PREPARACION', pagado: true },
  });
  assert.equal(neg03b.status, 400);
  assert.equal(neg03b.body.code, 'CAMPOS_NO_PERMITIDOS');

  // NEG-01: saltar CONFIRMADO -> ENTREGADO o CONFIRMADO -> ENVIADO -> 409 TRANSICION_ESTADO_INVALIDA
  for (const skipped of ['ENVIADO', 'ENTREGADO']) {
    const res = await api(`/admin/pedidos/${orderId}/estado`, {
      method: 'PATCH', auth: admin1, body: { estado: skipped },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'TRANSICION_ESTADO_INVALIDA');
  }

  // NEG-04: transicionar pedido DEMO_REGISTRADO -> 409 TRANSICION_ESTADO_INVALIDA
  const demoRes = await api(`/admin/pedidos/${demoOrderId}/estado`, {
    method: 'PATCH', auth: admin1, body: { estado: 'EN_PREPARACION' },
  });
  assert.equal(demoRes.status, 409);
  assert.equal(demoRes.body.code, 'TRANSICION_ESTADO_INVALIDA');

  // Flujo valido CONFIRMADO -> EN_PREPARACION -> ENVIADO -> ENTREGADO
  assert.equal((await api(`/admin/pedidos/${orderId}/estado`, {
    method: 'PATCH', auth: admin1, body: { estado: 'EN_PREPARACION' },
  })).status, 200);
  assert.equal((await api(`/admin/pedidos/${orderId}/estado`, {
    method: 'PATCH', auth: admin1, body: { estado: 'ENVIADO' },
  })).status, 200);

  // NEG-02: retroceder ENVIADO -> EN_PREPARACION -> 409 TRANSICION_ESTADO_INVALIDA
  const back1 = await api(`/admin/pedidos/${orderId}/estado`, {
    method: 'PATCH', auth: admin1, body: { estado: 'EN_PREPARACION' },
  });
  assert.equal(back1.status, 409);
  assert.equal(back1.body.code, 'TRANSICION_ESTADO_INVALIDA');

  assert.equal((await api(`/admin/pedidos/${orderId}/estado`, {
    method: 'PATCH', auth: admin1, body: { estado: 'ENTREGADO' },
  })).status, 200);

  // NEG-02: retroceder ENTREGADO -> ENVIADO -> 409 TRANSICION_ESTADO_INVALIDA
  const back2 = await api(`/admin/pedidos/${orderId}/estado`, {
    method: 'PATCH', auth: admin1, body: { estado: 'ENVIADO' },
  });
  assert.equal(back2.status, 409);
  assert.equal(back2.body.code, 'TRANSICION_ESTADO_INVALIDA');
});

test('3. INV-03 + Proyección coherente ADMIN y CLIENTE (TRANSFERENCIA USD/ARS FER17-v1, sin falsos pagados)', async () => {
  const client = await createClient({ type: 'PARTICULAR' });
  const orderId = await createOrder(client.clientId, { modalidad: 'TRANSFERENCIA', total: '200.00', moneda: 'USD' });
  const legacyOrderId = await createOrder(client.clientId, { modalidad: 'TRANSFERENCIA', total: '50.00', moneda: null, evidencia: null });

  async function assertBothViews(targetOrderId, expected) {
    const adminDetail = (await api(`/admin/pedidos/${targetOrderId}`, { auth: admin1 })).body.data;
    const adminList = (await api(`/admin/pedidos?clienteId=${client.clientId}`, { auth: admin1 })).body.data.items
      .find(item => item.idPedido === targetOrderId);
    const clientDetail = (await api(`/pedidos/${targetOrderId}`, { auth: client.auth })).body.data;
    const clientList = (await api('/pedidos', { auth: client.auth })).body.data.items
      .find(item => item.pedidoId === targetOrderId);

    for (const [label, view] of [
      ['adminDetail', adminDetail],
      ['adminList', adminList],
      ['clientDetail', clientDetail],
      ['clientList', clientList],
    ]) {
      assert.equal(view.estadoPedido, expected.estadoPedido, label);
      assert.equal(view.estadoDocumental, expected.estadoDocumental, label);
      assert.equal(view.estadoFinanciero, expected.estadoFinanciero, label);
      assert.equal(view.montoAcreditadoUSD, expected.montoAcreditadoUSD, label);
    }
  }

  // Estado inicial: SIN_COMPROBANTE + SIN_PAGO_ACREDITADO
  await assertBothViews(orderId, {
    estadoPedido: 'CONFIRMADO',
    estadoDocumental: 'SIN_COMPROBANTE',
    estadoFinanciero: 'SIN_PAGO_ACREDITADO',
    montoAcreditadoUSD: '0.00',
  });
  await assertBothViews(legacyOrderId, {
    estadoPedido: 'CONFIRMADO',
    estadoDocumental: 'SIN_COMPROBANTE',
    estadoFinanciero: 'NO_DETERMINABLE',
    montoAcreditadoUSD: null,
  });

  // Subir comprobante -> PENDIENTE + SIN_PAGO_ACREDITADO
  const uploaded = await api(`/pedidos/${orderId}/comprobantes`, {
    method: 'POST', auth: client.auth, body: pdf1, headers: { 'Content-Type': 'application/pdf' },
  });
  assert.equal(uploaded.status, 201);
  await assertBothViews(orderId, {
    estadoPedido: 'CONFIRMADO',
    estadoDocumental: 'PENDIENTE',
    estadoFinanciero: 'SIN_PAGO_ACREDITADO',
    montoAcreditadoUSD: '0.00',
  });

  // Aprobar comprobante -> APROBADO, pero SIGUE SIN_PAGO_ACREDITADO (nunca "pagado"!)
  assert.equal((await api(`/admin/comprobantes/${uploaded.body.data.id}/revision`, {
    method: 'PATCH', auth: admin1, key: randomUUID(), body: { estado: 'APROBADO' },
  })).status, 200);
  await assertBothViews(orderId, {
    estadoPedido: 'CONFIRMADO',
    estadoDocumental: 'APROBADO',
    estadoFinanciero: 'SIN_PAGO_ACREDITADO',
    montoAcreditadoUSD: '0.00',
  });

  // Registrar pago preliminar PENDIENTE (80.00 USD) -> NO acredita ni computa como pagado
  const prelim = await api('/admin/pagos', {
    method: 'POST',
    auth: admin1,
    key: randomUUID(),
    body: { pedidoId: orderId, monto: '80.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE' },
  });
  assert.equal(prelim.status, 201);
  assert.equal(prelim.body.data.estado, 'PENDIENTE');
  assert.equal(prelim.body.data.montoUSD, null);
  await assertBothViews(orderId, {
    estadoPedido: 'CONFIRMADO',
    estadoDocumental: 'APROBADO',
    estadoFinanciero: 'SIN_PAGO_ACREDITADO',
    montoAcreditadoUSD: '0.00',
  });

  // Acreditar pago preliminar USD -> PAGO_PARCIAL (80.00 / 200.00), PEDIDO.estado intacto
  const accreditedUsd = await api(`/admin/pagos/${prelim.body.data.idPago}/acreditar`, {
    method: 'POST',
    auth: admin1,
    key: randomUUID(),
    body: { evidenciaAcreditacion: 'EXTRACTO-USD-001', fechaAcreditacionUtc: '2026-10-02T15:00:00Z' },
  });
  assert.equal(accreditedUsd.status, 200);
  assert.equal(accreditedUsd.body.data.estado, 'ACREDITADO');
  assert.equal(accreditedUsd.body.data.montoUSD, '80.00');
  await assertBothViews(orderId, {
    estadoPedido: 'CONFIRMADO',
    estadoDocumental: 'APROBADO',
    estadoFinanciero: 'PAGO_PARCIAL',
    montoAcreditadoUSD: '80.00',
  });

  // Acreditacion directa ARS con FER17-v1 (120000.00 ARS / 1000.00000000 = 120.00 USD) -> ACREDITADO (200.00 / 200.00)
  const accreditedArs = await api('/admin/pagos', {
    method: 'POST',
    auth: admin1,
    key: randomUUID(),
    body: {
      pedidoId: orderId,
      monto: '120000.00',
      moneda: 'ARS',
      metodoPago: 'TRANSFERENCIA',
      estado: 'ACREDITADO',
      evidenciaAcreditacion: 'EXTRACTO-ARS-002',
      fechaAcreditacionUtc: '2026-10-02T15:00:00Z',
    },
  });
  assert.equal(accreditedArs.status, 201);
  assert.equal(accreditedArs.body.data.montoUSD, '120.00');
  assert.equal(accreditedArs.body.data.idCotizacion, verifiedQuoteId);
  assert.equal(accreditedArs.body.data.tasaHistorica, '1000.00000000');
  assert.equal(accreditedArs.body.data.abonoMovimientoId, null);
  await assertBothViews(orderId, {
    estadoPedido: 'CONFIRMADO',
    estadoDocumental: 'APROBADO',
    estadoFinanciero: 'ACREDITADO',
    montoAcreditadoUSD: '200.00',
  });

  // Anular el pago ARS -> vuelve a PAGO_PARCIAL (80.00)
  const annulled = await api(`/admin/pagos/${accreditedArs.body.data.idPago}/anular`, {
    method: 'POST',
    auth: admin1,
    key: randomUUID(),
    body: { motivo: 'Contracargo bancario confirmado' },
  });
  assert.equal(annulled.status, 200);
  assert.equal(annulled.body.data.estado, 'ANULADO');
  await assertBothViews(orderId, {
    estadoPedido: 'CONFIRMADO',
    estadoDocumental: 'APROBADO',
    estadoFinanciero: 'PAGO_PARCIAL',
    montoAcreditadoUSD: '80.00',
  });

  // Ningun movimiento en cuenta corriente fue creado para pagos directos TRANSFERENCIA
  const [ccMovs] = await q(
    'SELECT COUNT(*) AS n FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago IN (?, ?)',
    [prelim.body.data.idPago, accreditedArs.body.data.idPago],
  );
  assert.equal(Number(ccMovs.n), 0);
});

test('4. INV-03 + CUENTA_CORRIENTE: acreditación ARS/USD genera ABONO + FIFO y anulación recalcula FIFO y proyección', async () => {
  const company = await createClient({ type: 'EMPRESA', withAccount: true, habilitada: 1, cobertura: 'COMPLETA' });
  const order1 = await createOrder(company.clientId, { modalidad: 'CUENTA_CORRIENTE', total: '60.00' });
  const order2 = await createOrder(company.clientId, { modalidad: 'CUENTA_CORRIENTE', total: '50.00' });
  const cargo1 = await ledger.registrarCargoPorPedido({ id_cuenta_corriente: company.accountId, id_pedido: order1, monto: '60.00', moneda: 'USD' });
  const cargo2 = await ledger.registrarCargoPorPedido({ id_cuenta_corriente: company.accountId, id_pedido: order2, monto: '50.00', moneda: 'USD' });

  const readState = async targetOrderId => {
    const a = (await api(`/admin/pedidos/${targetOrderId}`, { auth: admin1 })).body.data;
    const c = (await api(`/pedidos/${targetOrderId}`, { auth: clientAuth })).body.data;
    assert.equal(a.estadoFinanciero, c.estadoFinanciero);
    assert.equal(a.montoAcreditadoUSD, c.montoAcreditadoUSD);
    assert.equal(a.estadoDocumental, c.estadoDocumental);
    return a;
  };
  const clientAuth = company.auth;

  assert.equal((await readState(order1)).estadoFinanciero, 'CARGO_PENDIENTE');
  assert.equal((await readState(order2)).estadoFinanciero, 'CARGO_PENDIENTE');

  // Acreditar pago ARS (75000.00 ARS / 1000 = 75.00 USD) -> imputa 60.00 a cargo1 y 15.00 a cargo2 por FIFO
  const pay1 = await api('/admin/pagos', {
    method: 'POST',
    auth: admin1,
    key: randomUUID(),
    body: {
      cuentaCorrienteId: company.accountId,
      monto: '75000.00',
      moneda: 'ARS',
      metodoPago: 'TRANSFERENCIA',
      estado: 'ACREDITADO',
      evidenciaAcreditacion: 'CC-ARS-75K',
      fechaAcreditacionUtc: '2026-10-02T15:00:00Z',
    },
  });
  assert.equal(pay1.status, 201);
  assert.equal(pay1.body.data.montoUSD, '75.00');
  assert.ok(pay1.body.data.abonoMovimientoId > 0);
  assert.equal((await readState(order1)).estadoFinanciero, 'CANCELADO_EN_CC');
  assert.equal((await readState(order2)).estadoFinanciero, 'IMPUTADO_PARCIAL');
  assert.equal((await readState(order2)).montoAcreditadoUSD, '15.00');
  assert.equal((await ledger.calcularEstadoCuenta(company.accountId)).deuda_vigente, '35.00');

  // Segundo pago USD (35.00 USD) -> cancela por completo cargo2
  const pay2 = await api('/admin/pagos', {
    method: 'POST',
    auth: admin1,
    key: randomUUID(),
    body: {
      cuentaCorrienteId: company.accountId,
      monto: '35.00',
      moneda: 'USD',
      metodoPago: 'TRANSFERENCIA',
      estado: 'ACREDITADO',
      evidenciaAcreditacion: 'CC-USD-35',
      fechaAcreditacionUtc: '2026-10-02T16:00:00Z',
    },
  });
  assert.equal(pay2.status, 201);
  assert.equal((await readState(order2)).estadoFinanciero, 'CANCELADO_EN_CC');
  assert.equal((await ledger.calcularEstadoCuenta(company.accountId)).deuda_vigente, '0.00');

  // Anular pago #1 (75.00 USD): anula su ABONO y recalcula FIFO (los 35.00 del pago #2 pasan a cargo1)
  const annul1 = await api(`/admin/pagos/${pay1.body.data.idPago}/anular`, {
    method: 'POST',
    auth: admin1,
    key: randomUUID(),
    body: { motivo: 'Reversion bancaria de transferencia ARS' },
  });
  assert.equal(annul1.status, 200);
  assert.equal(annul1.body.data.estado, 'ANULADO');
  assert.equal((await ledger.calcularEstadoCuenta(company.accountId)).deuda_vigente, '75.00');
  assert.equal((await readState(order1)).estadoFinanciero, 'IMPUTADO_PARCIAL');
  assert.equal((await readState(order1)).montoAcreditadoUSD, '35.00');
  assert.equal((await readState(order2)).estadoFinanciero, 'CARGO_PENDIENTE');
  assert.equal((await readState(order2)).montoAcreditadoUSD, '0.00');

  // Anular cargo2 -> CARGO_ANULADO
  await ledger.anularMovimiento({
    id_cuenta_corriente: company.accountId,
    id_movimiento_cuenta: cargo2,
    evento: `TEST-ANULAR-CARGO-${randomUUID()}`,
    actor: String(admin1.id),
    motivo: 'Anulacion de cargo para prueba de proyeccion',
  });
  assert.equal((await readState(order2)).estadoFinanciero, 'CARGO_ANULADO');

  // Cuenta con cobertura NO_ACREDITADA -> NO_DETERMINABLE
  const unknownCo = await createClient({ type: 'EMPRESA', withAccount: true, habilitada: 0, cobertura: 'NO_ACREDITADA' });
  const unknownOrder = await createOrder(unknownCo.clientId, { modalidad: 'CUENTA_CORRIENTE', total: '20.00' });
  assert.equal((await api(`/admin/pedidos/${unknownOrder}`, { auth: admin1 })).body.data.estadoFinanciero, 'NO_DETERMINABLE');
  assert.equal((await api(`/pedidos/${unknownOrder}`, { auth: unknownCo.auth })).body.data.estadoFinanciero, 'NO_DETERMINABLE');
  assert.ok(cargo1 > 0);
});

test('5. NEG-10, NEG-11, NEG-12 (triggers SQL), NEG-13 y RBAC (401/403/404) en PAGO y MOVIMIENTO', async () => {
  const particular = await createClient({ type: 'PARTICULAR' });
  const company = await createClient({ type: 'EMPRESA', withAccount: true, habilitada: 1, cobertura: 'COMPLETA', origen: 'REAL' });
  const orderId = await createOrder(particular.clientId, { modalidad: 'TRANSFERENCIA', total: '100.00' });
  const ccOrder = await createOrder(company.clientId, { modalidad: 'CUENTA_CORRIENTE', total: '100.00' });
  await ledger.registrarCargoPorPedido({ id_cuenta_corriente: company.accountId, id_pedido: ccOrder, monto: '100.00', moneda: 'USD' });

  // RBAC: 401 anonimo, 403 CLIENTE, 404 inexistente + cabeceras private no-store
  const anon = await api('/admin/pagos');
  assert.equal(anon.status, 401);
  assert.equal(anon.headers.get('cache-control'), 'private, no-store');

  const clientTry = await api('/admin/pagos', {
    method: 'POST', auth: particular.auth, key: randomUUID(),
    body: { pedidoId: orderId, monto: '10.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE' },
  });
  assert.equal(clientTry.status, 403);

  const notFound = await api('/admin/pagos/2147483647', { auth: admin1 });
  assert.equal(notFound.status, 404);

  // NEG-10: sin evidencia, monto <= 0, ambos destinos, ARS sin cotizacion verificada, ARS con cotizacion sintetica en cuenta REAL
  assert.equal((await api('/admin/pagos', {
    method: 'POST', auth: admin1, key: randomUUID(),
    body: { pedidoId: orderId, monto: '10.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'ACREDITADO', fechaAcreditacionUtc: '2026-10-02T15:00:00Z' },
  })).status, 400);

  assert.equal((await api('/admin/pagos', {
    method: 'POST', auth: admin1, key: randomUUID(),
    body: { pedidoId: orderId, monto: '0.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE' },
  })).status, 400);

  assert.equal((await api('/admin/pagos', {
    method: 'POST', auth: admin1, key: randomUUID(),
    body: { pedidoId: orderId, cuentaCorrienteId: company.accountId, monto: '10.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE' },
  })).status, 400);

  // ARS sin cotizacion para fecha 2026-08-10 -> 422 COTIZACION_FER17_NO_VERIFICADA
  const noQuote = await api('/admin/pagos', {
    method: 'POST', auth: admin1, key: randomUUID(),
    body: {
      pedidoId: orderId, monto: '10000.00', moneda: 'ARS', metodoPago: 'TRANSFERENCIA',
      estado: 'ACREDITADO', evidenciaAcreditacion: 'REF-NO-QUOTE', fechaAcreditacionUtc: '2026-08-10T15:00:00Z',
    },
  });
  assert.equal(noQuote.status, 422);
  assert.equal(noQuote.body.code, 'COTIZACION_FER17_NO_VERIFICADA');

  // ARS con cotizacion sintetica sobre cuenta REAL -> 422
  const synQuote = await api('/admin/pagos', {
    method: 'POST', auth: admin1, key: randomUUID(),
    body: {
      cuentaCorrienteId: company.accountId, monto: '12000.00', moneda: 'ARS', metodoPago: 'TRANSFERENCIA',
      estado: 'ACREDITADO', evidenciaAcreditacion: 'REF-SYN', fechaAcreditacionUtc: '2026-09-16T15:00:00Z',
    },
  });
  assert.equal(synQuote.status, 422);
  assert.equal(synQuote.body.code, 'COTIZACION_FER17_NO_VERIFICADA');

  // NEG-11 + NEG-13: crear preliminar -> rechazar -> intentar acreditar rechazado (409) + idempotencia
  const kCreate = randomUUID();
  const created = await api('/admin/pagos', {
    method: 'POST', auth: admin1, key: kCreate,
    body: { pedidoId: orderId, monto: '40.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE' },
  });
  assert.equal(created.status, 201);

  // Replay mismo payload -> 200
  const replayCreate = await api('/admin/pagos', {
    method: 'POST', auth: admin1, key: kCreate,
    body: { pedidoId: orderId, monto: '40.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE' },
  });
  assert.equal(replayCreate.status, 200);
  assert.equal(replayCreate.body.meta.replay, true);
  assert.equal(replayCreate.body.data.idPago, created.body.data.idPago);

  // NEG-13: misma clave distinto payload -> 409 CLAVE_IDEMPOTENCIA_REUTILIZADA
  const conflictCreate = await api('/admin/pagos', {
    method: 'POST', auth: admin1, key: kCreate,
    body: { pedidoId: orderId, monto: '41.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE' },
  });
  assert.equal(conflictCreate.status, 409);
  assert.equal(conflictCreate.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');

  const kReject = randomUUID();
  const rejected = await api(`/admin/pagos/${created.body.data.idPago}/rechazar`, {
    method: 'POST', auth: admin1, key: kReject, body: { motivo: 'Transferencia rebotada' },
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.estado, 'RECHAZADO');

  // NEG-11: intentar acreditar un pago RECHAZADO -> 409 TRANSICION_PAGO_INVALIDA
  const accreditRejected = await api(`/admin/pagos/${created.body.data.idPago}/acreditar`, {
    method: 'POST', auth: admin1, key: randomUUID(),
    body: { evidenciaAcreditacion: 'REF-LATE', fechaAcreditacionUtc: '2026-10-02T15:00:00Z' },
  });
  assert.equal(accreditRejected.status, 409);
  assert.equal(accreditRejected.body.code, 'TRANSICION_PAGO_INVALIDA');

  // Crear pago CC acreditado -> anular -> NEG-11 acreditar anulado -> 409
  const ccPay = await api('/admin/pagos', {
    method: 'POST', auth: admin1, key: randomUUID(),
    body: {
      cuentaCorrienteId: company.accountId, monto: '25.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA',
      estado: 'ACREDITADO', evidenciaAcreditacion: 'REF-CC-25', fechaAcreditacionUtc: '2026-10-02T15:00:00Z',
    },
  });
  assert.equal(ccPay.status, 201);
  const abonoId = ccPay.body.data.abonoMovimientoId;
  const [impRow] = await q('SELECT id_imputacion FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_abono = ? LIMIT 1', [abonoId]);
  assert.ok(impRow);

  // NEG-12 (SQL): inmutabilidad de IMPUTACION_MOVIMIENTO_CUENTA (FER260_HISTORIAL_INMUTABLE)
  await assert.rejects(
    q('UPDATE IMPUTACION_MOVIMIENTO_CUENTA SET monto_imputado = 1.00 WHERE id_imputacion = ?', [impRow.id_imputacion]),
    /FER260_HISTORIAL_INMUTABLE/,
  );

  // Anular pago CC
  assert.equal((await api(`/admin/pagos/${ccPay.body.data.idPago}/anular`, {
    method: 'POST', auth: admin1, key: randomUUID(), body: { motivo: 'Error operativo' },
  })).status, 200);

  // NEG-11: intentar acreditar un pago ANULADO -> 409 TRANSICION_PAGO_INVALIDA
  const accreditAnnulled = await api(`/admin/pagos/${ccPay.body.data.idPago}/acreditar`, {
    method: 'POST', auth: admin1, key: randomUUID(),
    body: { evidenciaAcreditacion: 'REF-REAC', fechaAcreditacionUtc: '2026-10-02T16:00:00Z' },
  });
  assert.equal(accreditAnnulled.status, 409);
  assert.equal(accreditAnnulled.body.code, 'TRANSICION_PAGO_INVALIDA');

  // NEG-12 (SQL): triggers en PAGO, MOVIMIENTO_CUENTA_CORRIENTE y COMPROBANTE_PAGO
  await assert.rejects(q('DELETE FROM PAGO WHERE id_pago = ?', [ccPay.body.data.idPago]), /S704_PAGO_DELETE_NO_PERMITIDO/);
  await assert.rejects(q("UPDATE PAGO SET estado = 'PENDIENTE' WHERE id_pago = ?", [ccPay.body.data.idPago]), /S704_PAGO_ESTADO_TERMINAL_INMUTABLE/);
  await assert.rejects(q("UPDATE PAGO SET estado = 'ACREDITADO' WHERE id_pago = ?", [created.body.data.idPago]), /S704_PAGO_ESTADO_TERMINAL_INMUTABLE/);
  await assert.rejects(q('DELETE FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_movimiento_cuenta = ?', [abonoId]), /S704_MOVIMIENTO_DELETE_NO_PERMITIDO/);
  await assert.rejects(q("UPDATE MOVIMIENTO_CUENTA_CORRIENTE SET estado = 'ACREDITADO' WHERE id_movimiento_cuenta = ?", [abonoId]), /S704_MOVIMIENTO_ANULADO_INMUTABLE/);
  await assert.rejects(q("UPDATE IMPUTACION_MOVIMIENTO_CUENTA SET estado = 'VIGENTE' WHERE id_imputacion = ?", [impRow.id_imputacion]), /FER260_HISTORIAL_INMUTABLE/);

  // Comprobante terminal inmutable en SQL
  const receipt = (await api(`/pedidos/${orderId}/comprobantes`, {
    method: 'POST', auth: particular.auth, body: jpg1, headers: { 'Content-Type': 'image/jpeg' },
  })).body.data;
  await api(`/admin/comprobantes/${receipt.id}/revision`, {
    method: 'PATCH', auth: admin1, key: randomUUID(), body: { estado: 'APROBADO' },
  });
  await assert.rejects(
    q("UPDATE COMPROBANTE_PAGO SET estado_revision = 'PENDIENTE' WHERE id_comprobante = ?", [receipt.id]),
    /S704_COMPROBANTE_ESTADO_TERMINAL_INMUTABLE/,
  );

  // Listado GET /api/admin/pagos con filtros
  const listed = await api(`/admin/pagos?pedidoId=${orderId}&estado=RECHAZADO`, { auth: admin1 });
  assert.equal(listed.status, 200);
  assert.ok(listed.body.data.items.some(item => item.idPago === created.body.data.idPago));
});

test('6. TOCTOU-01 a TOCTOU-05: concurrencia real en MariaDB, orden de locks y revalidación transaccional', async () => {
  const client = await createClient({ type: 'PARTICULAR' });
  const company = await createClient({ type: 'EMPRESA', withAccount: true, habilitada: 1, cobertura: 'COMPLETA' });
  const orderId = await createOrder(client.clientId, { modalidad: 'TRANSFERENCIA', total: '100.00' });
  const ccOrder1 = await createOrder(company.clientId, { modalidad: 'CUENTA_CORRIENTE', total: '100.00' });
  const ccOrder2 = await createOrder(company.clientId, { modalidad: 'CUENTA_CORRIENTE', total: '80.00' });
  await ledger.registrarCargoPorPedido({ id_cuenta_corriente: company.accountId, id_pedido: ccOrder1, monto: '100.00', moneda: 'USD' });

  // TOCTOU-01: Dos ADMIN resuelven simultaneamente el mismo comprobante PENDIENTE (APROBADO vs RECHAZADO)
  const r1 = (await api(`/pedidos/${orderId}/comprobantes`, {
    method: 'POST', auth: client.auth, body: pdf1, headers: { 'Content-Type': 'application/pdf' },
  })).body.data;
  const [raceA, raceB] = await Promise.all([
    api(`/admin/comprobantes/${r1.id}/revision`, {
      method: 'PATCH', auth: admin1, key: randomUUID(), body: { estado: 'APROBADO' },
    }),
    api(`/admin/comprobantes/${r1.id}/revision`, {
      method: 'PATCH', auth: admin2, key: randomUUID(), body: { estado: 'RECHAZADO', motivo: 'Concurrencia' },
    }),
  ]);
  const statuses01 = [raceA.status, raceB.status].sort();
  assert.deepEqual(statuses01, [200, 409]);
  const loser01 = raceA.status === 409 ? raceA : raceB;
  assert.equal(loser01.body.code, 'COMPROBANTE_YA_RESUELTO');

  // TOCTOU-02: ADMIN desactivado entre Passport JWT y la transaccion (bloqueado en PEDIDO FOR UPDATE)
  const tempAdminId = await insert(
    "INSERT INTO USUARIO (email, password_hash, rol, activo) VALUES (?, 'test-only', 'ADMIN', 1)",
    [`toctou-${randomUUID()}@s704.test`],
  );
  const tempAdmin = { id: tempAdminId, rol: 'ADMIN' };
  const blocker = dataSource.createQueryRunner();
  await blocker.connect();
  await blocker.startTransaction('READ COMMITTED');
  try {
    await blocker.query('SELECT id_pedido FROM PEDIDO WHERE id_pedido = ? FOR UPDATE', [orderId]);
    const inFlight = api(`/admin/pedidos/${orderId}/estado`, {
      method: 'PATCH', auth: tempAdmin, body: { estado: 'EN_PREPARACION' },
    });
    // Esperar a que pase Passport JWT y quede esperando en PEDIDO FOR UPDATE
    await new Promise(resolve => setTimeout(resolve, 150));
    await q('UPDATE USUARIO SET activo = 0 WHERE id_usuario = ?', [tempAdminId]);
    await blocker.commitTransaction();
    const res02 = await inFlight;
    assert.equal(res02.status, 401);
    const [orderRow] = await q('SELECT estado FROM PEDIDO WHERE id_pedido = ?', [orderId]);
    assert.equal(orderRow.estado, 'CONFIRMADO', 'TOCTOU-02: pedido no debe mutar tras desactivacion');
  } finally {
    if (blocker.isTransactionActive) await blocker.rollbackTransaction();
    await blocker.release();
  }

  // TOCTOU-03: Resolucion de PAGO de CC por :pagoId (§10.3) en concurrencia con doble acreditacion y nuevo CARGO FER-20 (sin deadlock 1213!)
  const pendingCcPay = (await api('/admin/pagos', {
    method: 'POST', auth: admin1, key: randomUUID(),
    body: { cuentaCorrienteId: company.accountId, monto: '60.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE' },
  })).body.data;

  const [acc1, acc2, cargoRes] = await Promise.all([
    api(`/admin/pagos/${pendingCcPay.idPago}/acreditar`, {
      method: 'POST', auth: admin1, key: randomUUID(),
      body: { evidenciaAcreditacion: 'TOCTOU03-A', fechaAcreditacionUtc: '2026-10-02T15:00:00Z' },
    }),
    api(`/admin/pagos/${pendingCcPay.idPago}/acreditar`, {
      method: 'POST', auth: admin2, key: randomUUID(),
      body: { evidenciaAcreditacion: 'TOCTOU03-B', fechaAcreditacionUtc: '2026-10-02T15:00:00Z' },
    }),
    ledger.registrarCargoPorPedido({ id_cuenta_corriente: company.accountId, id_pedido: ccOrder2, monto: '80.00', moneda: 'USD' }),
  ]);
  assert.ok(cargoRes > 0);
  assert.deepEqual([acc1.status, acc2.status].sort(), [200, 409]);
  const accLoser = acc1.status === 409 ? acc1 : acc2;
  assert.equal(accLoser.body.code, 'TRANSICION_PAGO_INVALIDA');
  const [abonoCount] = await q('SELECT COUNT(*) AS n FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago = ?', [pendingCcPay.idPago]);
  assert.equal(Number(abonoCount.n), 1, 'TOCTOU-03: exactamente un ABONO');
  assert.equal((await ledger.calcularEstadoCuenta(company.accountId)).deuda_vigente, '120.00');

  // TOCTOU-04: Aprobacion de comprobante en paralelo con lecturas de CC y pedido -> nunca expone pagos inexistentes
  const ccReceipt = (await api(`/pedidos/${ccOrder2}/comprobantes`, {
    method: 'POST', auth: company.auth, body: png1, headers: { 'Content-Type': 'image/png' },
  })).body.data;
  const [rev04, orderRead04, ccRead04] = await Promise.all([
    api(`/admin/comprobantes/${ccReceipt.id}/revision`, {
      method: 'PATCH', auth: admin1, key: randomUUID(), body: { estado: 'APROBADO' },
    }),
    api(`/pedidos/${ccOrder2}`, { auth: company.auth }),
    ledger.calcularEstadoCuenta(company.accountId),
  ]);
  assert.equal(rev04.status, 200);
  assert.equal(orderRead04.status, 200);
  assert.equal(orderRead04.body.data.estadoFinanciero, 'CARGO_PENDIENTE');
  assert.equal(ccRead04.deuda_vigente, '120.00');

  // TOCTOU-05: Cargas simultaneas con identico sha256 se deduplican sin archivos huerfanos
  const filesBefore = await readdir(storage);
  const [dup1, dup2] = await Promise.all([
    api(`/pedidos/${orderId}/comprobantes`, { method: 'POST', auth: client.auth, body: pdf2, headers: { 'Content-Type': 'application/pdf' } }),
    api(`/pedidos/${orderId}/comprobantes`, { method: 'POST', auth: client.auth, body: pdf2, headers: { 'Content-Type': 'application/pdf' } }),
  ]);
  assert.deepEqual([dup1.status, dup2.status].sort(), [200, 201]);
  assert.equal(dup1.body.data.id, dup2.body.data.id);
  assert.equal((await readdir(storage)).length, filesBefore.length + 1);
});

test('7. Socket.IO §8: pedido.estado.actualizado.v1, comprobante.estado.actualizado.v1 y pago.acreditado.v1 post-COMMIT sin filtro canReceiveOrders', async t => {
  // PARTICULAR (canReceiveOrders = false) y EMPRESA con CC INHABILITADA (canReceiveOrders = false)
  const particular = await createClient({ type: 'PARTICULAR' });
  const disabledCompany = await createClient({ type: 'EMPRESA', withAccount: true, habilitada: 0, cobertura: 'COMPLETA' });
  const outsider = await createClient({ type: 'PARTICULAR' });

  const transferOrderId = await createOrder(particular.clientId, { modalidad: 'TRANSFERENCIA', total: '100.00' });
  const ccOrderId = await createOrder(disabledCompany.clientId, { modalidad: 'CUENTA_CORRIENTE', total: '90.00' });
  // Habilitar brevemente para crear cargo, luego inhabilitar para probar regularizacion de deuda
  await q('UPDATE CUENTA_CORRIENTE SET habilitada = 1 WHERE id_cuenta_corriente = ?', [disabledCompany.accountId]);
  await ledger.registrarCargoPorPedido({ id_cuenta_corriente: disabledCompany.accountId, id_pedido: ccOrderId, monto: '90.00', moneda: 'USD' });
  await q('UPDATE CUENTA_CORRIENTE SET habilitada = 0 WHERE id_cuenta_corriente = ?', [disabledCompany.accountId]);

  const sParticular = await connectSocket(t, particular.auth);
  const sDisabledCo = await connectSocket(t, disabledCompany.auth);
  const sOutsider = await connectSocket(t, outsider.auth);
  const sAdmin = await connectSocket(t, admin1);

  // 1) pedido.estado.actualizado.v1 en transicion valida (y silencio ante rechazo 409)
  assert.equal((await api(`/admin/pedidos/${transferOrderId}/estado`, {
    method: 'PATCH', auth: admin1, body: { estado: 'ENTREGADO' },
  })).status, 409);
  await flushSockets(sParticular, sDisabledCo, sOutsider, sAdmin);
  assert.equal(sParticular.events.orderStatus.length, 0);
  assert.equal(sAdmin.events.orderStatus.length, 0);

  assert.equal((await api(`/admin/pedidos/${transferOrderId}/estado`, {
    method: 'PATCH', auth: admin1, body: { estado: 'EN_PREPARACION' },
  })).status, 200);
  await flushSockets(sParticular, sDisabledCo, sOutsider, sAdmin);
  assert.equal(sParticular.events.orderStatus.length, 1);
  assert.equal(sAdmin.events.orderStatus.length, 1);
  assert.equal(sDisabledCo.events.orderStatus.length, 0);
  assert.equal(sOutsider.events.orderStatus.length, 0);
  assert.equal(sParticular.events.orderStatus[0].pedidoId, transferOrderId);
  assert.equal(sParticular.events.orderStatus[0].estadoAnterior, 'CONFIRMADO');
  assert.equal(sParticular.events.orderStatus[0].estadoNuevo, 'EN_PREPARACION');

  // 2) comprobante.estado.actualizado.v1 para EMPRESA con CC inhabilitada: carga + rechazo (sin motivo privado ni binarios)
  const up = await api(`/pedidos/${ccOrderId}/comprobantes`, {
    method: 'POST', auth: disabledCompany.auth, body: pdf1, headers: { 'Content-Type': 'application/pdf' },
  });
  assert.equal(up.status, 201);
  await flushSockets(sParticular, sDisabledCo, sOutsider, sAdmin);
  assert.equal(sDisabledCo.events.receipt.length, 1);
  assert.equal(sAdmin.events.receipt.length, 1);
  assert.equal(sOutsider.events.receipt.length, 0);
  assert.equal(sDisabledCo.events.receipt[0].estadoDocumental, 'PENDIENTE');

  const kRev = randomUUID();
  assert.equal((await api(`/admin/comprobantes/${up.body.data.id}/revision`, {
    method: 'PATCH', auth: admin1, key: kRev, body: { estado: 'RECHAZADO', motivo: 'Nota interna confidencial' },
  })).status, 200);
  // Replay no vuelve a emitir
  assert.equal((await api(`/admin/comprobantes/${up.body.data.id}/revision`, {
    method: 'PATCH', auth: admin1, key: kRev, body: { estado: 'RECHAZADO', motivo: 'Nota interna confidencial' },
  })).status, 200);
  await flushSockets(sParticular, sDisabledCo, sOutsider, sAdmin);
  assert.equal(sDisabledCo.events.receipt.length, 2);
  assert.equal(sAdmin.events.receipt.length, 2);
  assert.equal(sDisabledCo.events.receipt[1].estadoDocumental, 'RECHAZADO');
  assert.equal(sDisabledCo.events.receipt[1].motivoRechazo, undefined, 'No debe filtrar motivo privado en broadcast');
  assert.equal(sDisabledCo.events.receipt[1].bytes, undefined);

  // 3) pago.acreditado.v1 para EMPRESA con CC inhabilitada regularizando deuda (acreditacion + anulacion, sin evidencia/observaciones)
  const kPay = randomUUID();
  const pay = await api('/admin/pagos', {
    method: 'POST', auth: admin1, key: kPay,
    body: {
      cuentaCorrienteId: disabledCompany.accountId, monto: '50.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA',
      estado: 'ACREDITADO', evidenciaAcreditacion: 'SECRETO-EXTRACTO-99', fechaAcreditacionUtc: '2026-10-02T15:00:00Z',
      observaciones: 'Obs interna ADMIN',
    },
  });
  assert.equal(pay.status, 201);
  // Replay no vuelve a emitir
  assert.equal((await api('/admin/pagos', {
    method: 'POST', auth: admin1, key: kPay,
    body: {
      cuentaCorrienteId: disabledCompany.accountId, monto: '50.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA',
      estado: 'ACREDITADO', evidenciaAcreditacion: 'SECRETO-EXTRACTO-99', fechaAcreditacionUtc: '2026-10-02T15:00:00Z',
      observaciones: 'Obs interna ADMIN',
    },
  })).status, 200);
  await flushSockets(sParticular, sDisabledCo, sOutsider, sAdmin);
  assert.equal(sDisabledCo.events.payment.length, 1);
  assert.equal(sAdmin.events.payment.length, 1);
  assert.equal(sOutsider.events.payment.length, 0);
  assert.equal(sDisabledCo.events.payment[0].estadoPago, 'ACREDITADO');
  assert.equal(sDisabledCo.events.payment[0].montoUSD, '50.00');
  assert.ok(sDisabledCo.events.payment[0].revisionCuenta !== null);
  assert.equal(sDisabledCo.events.payment[0].evidenciaAcreditacion, undefined);
  assert.equal(sDisabledCo.events.payment[0].observaciones, undefined);

  // Revocar usuario PARTICULAR antes de acreditar un pago -> desconecta sin emitir
  await q('UPDATE USUARIO SET activo = 0 WHERE id_usuario = ?', [particular.userId]);
  const disconnected = waitFor(sParticular.socket, 'disconnect');
  assert.equal((await api('/admin/pagos', {
    method: 'POST', auth: admin1, key: randomUUID(),
    body: {
      pedidoId: transferOrderId, monto: '40.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA',
      estado: 'ACREDITADO', evidenciaAcreditacion: 'EXT-PART-40', fechaAcreditacionUtc: '2026-10-02T15:00:00Z',
    },
  })).status, 201);
  await disconnected;
  await flushSockets(sDisabledCo, sOutsider, sAdmin);
  assert.equal(sParticular.events.payment.length, 0, 'Usuario revocado no debe recibir pago.acreditado.v1');
  assert.equal(sAdmin.events.payment.length, 2);
});

test('8. P2-01 y P2-02: validación SQL ARS->USD/FER17, observaciones exactas en replay y unicidad global Idempotency-Key en PAGO', async () => {
  const client = await createClient({ type: 'PARTICULAR' });
  const companyA = await createClient({ type: 'EMPRESA', withAccount: true, habilitada: 1, cobertura: 'COMPLETA' });
  const companyB = await createClient({ type: 'EMPRESA', withAccount: true, habilitada: 1, cobertura: 'COMPLETA' });
  const orderA = await createOrder(client.clientId, { modalidad: 'TRANSFERENCIA', total: '200.00' });
  const orderB = await createOrder(client.clientId, { modalidad: 'TRANSFERENCIA', total: '200.00' });

  // --- P2-01: validación SQL en s704_pago_before_insert y s704_pago_before_update ---
  // 1) Cotización sin registro en FER17_COTIZACION_VERIFICACION -> rechazada con SQLSTATE 45000
  const unverifiedQuoteId = await insert(`
    INSERT INTO COTIZACION (tasa, fecha_referencia, fecha_carga, actor, valida)
    VALUES (950.00000000, '2026-07-01', '2026-07-01 09:00:00', 'BNA Sin Verif', 1)
  `);
  await assert.rejects(
    q(`INSERT INTO PAGO (
         id_pedido, monto, moneda, monto_usd, id_cotizacion, tasa_historica,
         metodo_pago, estado, fecha_acreditacion_utc, evidencia_acreditacion
       ) VALUES (?, 950.00, 'ARS', 1.00, ?, 950.00000000, 'TRANSFERENCIA', 'ACREDITADO', '2026-07-01 12:00:00.000', 'SQL-NO-VERIF')`,
    [orderA, unverifiedQuoteId]),
    err => err.sqlState === '45000' && /S704_PAGO_COTIZACION_NO_VERIFICADA/.test(err.message),
  );

  // 2) Cotización con valida = 0 en COTIZACION o en FER17_COTIZACION_VERIFICACION -> rechazada con SQLSTATE 45000
  const invalidQuoteId = await insert(`
    INSERT INTO COTIZACION (tasa, fecha_referencia, fecha_carga, actor, valida)
    VALUES (980.00000000, '2026-07-02', '2026-07-02 09:00:00', 'BNA Invalida', 1)
  `);
  await q(`
    INSERT INTO FER17_COTIZACION_VERIFICACION (
      id_cotizacion, tasa_verificada, referencia_verificada, cargada_utc,
      actor_carga_verificado, banco, tipo, evidencia, id_admin, verificado_utc, valida, sintetica
    ) VALUES (
      ?, 980.00000000, '2026-07-02', '2026-07-02 10:00:00.000',
      'BNA Invalida', 'BNA', 'VENDEDOR', 'Verif invalida', ?, '2026-07-02 11:00:00.000', 0, 0
    )
  `, [invalidQuoteId, admin1.id]);
  await assert.rejects(
    q(`INSERT INTO PAGO (
         id_pedido, monto, moneda, monto_usd, id_cotizacion, tasa_historica,
         metodo_pago, estado, fecha_acreditacion_utc, evidencia_acreditacion
       ) VALUES (?, 980.00, 'ARS', 1.00, ?, 980.00000000, 'TRANSFERENCIA', 'ACREDITADO', '2026-07-02 12:00:00.000', 'SQL-VERIF-0')`,
    [orderA, invalidQuoteId]),
    err => err.sqlState === '45000' && /S704_PAGO_COTIZACION_NO_VERIFICADA/.test(err.message),
  );

  // 3) tasa_historica distinta de COTIZACION.tasa -> rechazada con SQLSTATE 45000
  await assert.rejects(
    q(`INSERT INTO PAGO (
         id_pedido, monto, moneda, monto_usd, id_cotizacion, tasa_historica,
         metodo_pago, estado, fecha_acreditacion_utc, evidencia_acreditacion
       ) VALUES (?, 1000.00, 'ARS', 1.00, ?, 1000.00000001, 'TRANSFERENCIA', 'ACREDITADO', '2026-10-02 15:00:00.000', 'SQL-RATE-MISMATCH')`,
    [orderA, verifiedQuoteId]),
    err => err.sqlState === '45000' && /S704_PAGO_COTIZACION_NO_VERIFICADA/.test(err.message),
  );

  // 4) monto_usd incongruente con ROUND(monto / tasa_historica, 2) en INSERT -> rechazada con SQLSTATE 45000
  await assert.rejects(
    q(`INSERT INTO PAGO (
         id_pedido, monto, moneda, monto_usd, id_cotizacion, tasa_historica,
         metodo_pago, estado, fecha_acreditacion_utc, evidencia_acreditacion
       ) VALUES (?, 1005.00, 'ARS', 1.00, ?, 1000.00000000, 'TRANSFERENCIA', 'ACREDITADO', '2026-10-02 15:00:00.000', 'SQL-BAD-MATH-INS')`,
    [orderA, verifiedQuoteId]),
    err => err.sqlState === '45000' && /S704_PAGO_CONVERSION_INVALIDA/.test(err.message),
  );

  // 5) UPDATE directo de PENDIENTE ARS a ACREDITADO con monto_usd incongruente o cotización no verificada -> SQLSTATE 45000
  const sqlPendId = await insert(`
    INSERT INTO PAGO (id_pedido, monto, moneda, metodo_pago, estado)
    VALUES (?, 1005.00, 'ARS', 'TRANSFERENCIA', 'PENDIENTE')
  `, [orderA]);
  await assert.rejects(
    q(`UPDATE PAGO
       SET estado = 'ACREDITADO',
           monto_usd = 1.00,
           id_cotizacion = ?,
           tasa_historica = 1000.00000000,
           fecha_acreditacion_utc = '2026-10-02 15:00:00.000',
           evidencia_acreditacion = 'SQL-BAD-MATH-UPD'
       WHERE id_pago = ?`, [verifiedQuoteId, sqlPendId]),
    err => err.sqlState === '45000' && /S704_PAGO_CONVERSION_INVALIDA/.test(err.message),
  );
  await assert.rejects(
    q(`UPDATE PAGO
       SET estado = 'ACREDITADO',
           monto_usd = 1.01,
           id_cotizacion = ?,
           tasa_historica = 950.00000000,
           fecha_acreditacion_utc = '2026-10-02 15:00:00.000',
           evidencia_acreditacion = 'SQL-NO-VERIF-UPD'
       WHERE id_pago = ?`, [unverifiedQuoteId, sqlPendId]),
    err => err.sqlState === '45000' && /S704_PAGO_COTIZACION_NO_VERIFICADA/.test(err.message),
  );
  // UPDATE válido con ROUND(1005.00 / 1000.00000000, 2) = 1.01 -> permitido y rechazado luego si se intenta anular sin motivo o cambiar campos
  await q(`
    UPDATE PAGO
    SET estado = 'ACREDITADO',
        monto_usd = 1.01,
        id_cotizacion = ?,
        tasa_historica = 1000.00000000,
        fecha_acreditacion_utc = '2026-10-02 15:00:00.000',
        evidencia_acreditacion = 'SQL-OK-ARS'
    WHERE id_pago = ?
  `, [verifiedQuoteId, sqlPendId]);
  await q(`UPDATE PAGO SET estado = 'ANULADO', motivo_cierre = 'Limpieza SQL prueba P2-01' WHERE id_pago = ?`, [sqlPendId]);

  // --- P2-02: comparación exacta de observaciones en replay ---
  const kCreateObs = randomUUID();
  const pendObs = await api('/admin/pagos', {
    method: 'POST',
    auth: admin1,
    key: kCreateObs,
    body: {
      pedidoId: orderA,
      monto: '25.00',
      moneda: 'USD',
      metodoPago: 'TRANSFERENCIA',
      estado: 'PENDIENTE',
      observaciones: 'Obs inicial alta',
    },
  });
  assert.equal(pendObs.status, 201);

  for (const obsVariant of [{}, { observaciones: null }, { observaciones: 'Obs distinta' }]) {
    const bodyPayload = {
      pedidoId: orderA,
      monto: '25.00',
      moneda: 'USD',
      metodoPago: 'TRANSFERENCIA',
      estado: 'PENDIENTE',
      ...obsVariant,
    };
    const badReplay = await api('/admin/pagos', { method: 'POST', auth: admin1, key: kCreateObs, body: bodyPayload });
    assert.equal(badReplay.status, 409);
    assert.equal(badReplay.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
  }

  const kAccObs = randomUUID();
  const accWithObs = await api(`/admin/pagos/${pendObs.body.data.idPago}/acreditar`, {
    method: 'POST',
    auth: admin1,
    key: kAccObs,
    body: {
      evidenciaAcreditacion: 'EXT-OBS-01',
      fechaAcreditacionUtc: '2026-10-02T15:00:00Z',
      observaciones: 'Obs acreditacion exacta',
    },
  });
  assert.equal(accWithObs.status, 200);
  assert.equal(accWithObs.body.data.observaciones, 'Obs acreditacion exacta');

  // Replay de acreditación omitiendo observaciones o enviando null -> 409 CLAVE_IDEMPOTENCIA_REUTILIZADA
  for (const badAccBody of [
    { evidenciaAcreditacion: 'EXT-OBS-01', fechaAcreditacionUtc: '2026-10-02T15:00:00Z' },
    { evidenciaAcreditacion: 'EXT-OBS-01', fechaAcreditacionUtc: '2026-10-02T15:00:00Z', observaciones: null },
    { evidenciaAcreditacion: 'EXT-OBS-01', fechaAcreditacionUtc: '2026-10-02T15:00:00Z', observaciones: 'Otra' },
  ]) {
    const res = await api(`/admin/pagos/${pendObs.body.data.idPago}/acreditar`, {
      method: 'POST', auth: admin1, key: kAccObs, body: badAccBody,
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
  }

  // Replay de acreditación con observaciones idénticas -> 200 meta.replay=true
  const accReplayOk = await api(`/admin/pagos/${pendObs.body.data.idPago}/acreditar`, {
    method: 'POST',
    auth: admin1,
    key: kAccObs,
    body: {
      evidenciaAcreditacion: 'EXT-OBS-01',
      fechaAcreditacionUtc: '2026-10-02T15:00:00Z',
      observaciones: 'Obs acreditacion exacta',
    },
  });
  assert.equal(accReplayOk.status, 200);
  assert.equal(accReplayOk.body.meta.replay, true);

  // Replay de creación con payload original (incluso después de que acreditar sobrescribiera PAGO.observaciones) -> 200 replay
  const createReplayOk = await api('/admin/pagos', {
    method: 'POST',
    auth: admin1,
    key: kCreateObs,
    body: {
      pedidoId: orderA,
      monto: '25.00',
      moneda: 'USD',
      metodoPago: 'TRANSFERENCIA',
      estado: 'PENDIENTE',
      observaciones: 'Obs inicial alta',
    },
  });
  assert.equal(createReplayOk.status, 200);
  assert.equal(createReplayOk.body.meta.replay, true);

  // Caso inverso: acreditar omitiendo observaciones y luego reintentar enviando observaciones -> 409
  const pendNoObs = await api('/admin/pagos', {
    method: 'POST',
    auth: admin1,
    key: randomUUID(),
    body: {
      pedidoId: orderA, monto: '10.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE',
      observaciones: 'Obs previa que no debe habilitar replay',
    },
  });
  assert.equal(pendNoObs.status, 201);
  const kAccNoObs = randomUUID();
  assert.equal((await api(`/admin/pagos/${pendNoObs.body.data.idPago}/acreditar`, {
    method: 'POST',
    auth: admin1,
    key: kAccNoObs,
    body: { evidenciaAcreditacion: 'EXT-NO-OBS', fechaAcreditacionUtc: '2026-10-02T15:00:00Z' },
  })).status, 200);
  const badReplayAddingObs = await api(`/admin/pagos/${pendNoObs.body.data.idPago}/acreditar`, {
    method: 'POST',
    auth: admin1,
    key: kAccNoObs,
    body: {
      evidenciaAcreditacion: 'EXT-NO-OBS',
      fechaAcreditacionUtc: '2026-10-02T15:00:00Z',
      observaciones: 'Obs previa que no debe habilitar replay',
    },
  });
  assert.equal(badReplayAddingObs.status, 409);
  assert.equal(badReplayAddingObs.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');

  // Reutilización secuencial cross-operación de la misma clave -> 409 CLAVE_IDEMPOTENCIA_REUTILIZADA
  const reuseCreateKeyOnAccredit = await api(`/admin/pagos/${pendObs.body.data.idPago}/acreditar`, {
    method: 'POST',
    auth: admin1,
    key: kCreateObs,
    body: { evidenciaAcreditacion: 'EXT-OBS-01', fechaAcreditacionUtc: '2026-10-02T15:00:00Z', observaciones: 'Obs inicial alta' },
  });
  assert.equal(reuseCreateKeyOnAccredit.status, 409);
  assert.equal(reuseCreateKeyOnAccredit.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');

  const reuseAccKeyOnAnnul = await api(`/admin/pagos/${pendObs.body.data.idPago}/anular`, {
    method: 'POST', auth: admin1, key: kAccObs, body: { motivo: 'Reuso de clave' },
  });
  assert.equal(reuseAccKeyOnAnnul.status, 409);
  assert.equal(reuseAccKeyOnAnnul.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');

  // --- P2-02: carrera concurrente con misma Idempotency-Key entre POST /api/admin/pagos y POST /api/admin/pagos/:id/acreditar ---
  const racePendingOrder = await api('/admin/pagos', {
    method: 'POST',
    auth: admin1,
    key: randomUUID(),
    body: { pedidoId: orderB, monto: '30.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE' },
  });
  assert.equal(racePendingOrder.status, 201);

  const raceOrderKey = randomUUID();
  const [raceCreateOrder, raceAccreditOrder] = await Promise.all([
    api('/admin/pagos', {
      method: 'POST',
      auth: admin1,
      key: raceOrderKey,
      body: {
        pedidoId: orderA,
        monto: '30.00',
        moneda: 'USD',
        metodoPago: 'TRANSFERENCIA',
        estado: 'ACREDITADO',
        evidenciaAcreditacion: 'RACE-ORDER-CREATE',
        fechaAcreditacionUtc: '2026-10-02T15:00:00Z',
      },
    }),
    api(`/admin/pagos/${racePendingOrder.body.data.idPago}/acreditar`, {
      method: 'POST',
      auth: admin2,
      key: raceOrderKey,
      body: {
        evidenciaAcreditacion: 'RACE-ORDER-ACCREDIT',
        fechaAcreditacionUtc: '2026-10-02T15:00:00Z',
      },
    }),
  ]);
  const orderPair = [raceCreateOrder, raceAccreditOrder];
  const orderWinners = orderPair.filter(r => r.status === 200 || r.status === 201);
  const orderLosers = orderPair.filter(r => r.status === 409);
  assert.equal(orderWinners.length, 1, `Esperado 1 ganador: ${JSON.stringify(orderPair.map(r => [r.status, r.body]))}`);
  assert.equal(orderLosers.length, 1, `Esperado 1 rechazo 409: ${JSON.stringify(orderPair.map(r => [r.status, r.body]))}`);
  assert.equal(orderLosers[0].body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
  const [raceKeyRows] = await q('SELECT COUNT(*) AS n FROM PAGO_IDEMPOTENCIA WHERE clave_idempotencia = ?', [raceOrderKey]);
  assert.equal(Number(raceKeyRows.n), 1);

  // Carrera concurrente equivalente sobre dos CUENTA_CORRIENTE distintas (crea ABONO vs acredita pendiente)
  const racePendingCc = await api('/admin/pagos', {
    method: 'POST',
    auth: admin1,
    key: randomUUID(),
    body: { cuentaCorrienteId: companyB.accountId, monto: '45.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA', estado: 'PENDIENTE' },
  });
  assert.equal(racePendingCc.status, 201);

  const raceCcKey = randomUUID();
  const [raceCreateCc, raceAccreditCc] = await Promise.all([
    api('/admin/pagos', {
      method: 'POST',
      auth: admin1,
      key: raceCcKey,
      body: {
        cuentaCorrienteId: companyA.accountId,
        monto: '45.00',
        moneda: 'USD',
        metodoPago: 'TRANSFERENCIA',
        estado: 'ACREDITADO',
        evidenciaAcreditacion: 'RACE-CC-CREATE',
        fechaAcreditacionUtc: '2026-10-02T15:00:00Z',
      },
    }),
    api(`/admin/pagos/${racePendingCc.body.data.idPago}/acreditar`, {
      method: 'POST',
      auth: admin2,
      key: raceCcKey,
      body: {
        evidenciaAcreditacion: 'RACE-CC-ACCREDIT',
        fechaAcreditacionUtc: '2026-10-02T15:00:00Z',
      },
    }),
  ]);
  const ccPair = [raceCreateCc, raceAccreditCc];
  const ccWinners = ccPair.filter(r => r.status === 200 || r.status === 201);
  const ccLosers = ccPair.filter(r => r.status === 409);
  assert.equal(ccWinners.length, 1);
  assert.equal(ccLosers.length, 1);
  assert.equal(ccLosers[0].body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
  const [ccMovCount] = await q(
    'SELECT COUNT(*) AS n FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_cuenta_corriente IN (?, ?)',
    [companyA.accountId, companyB.accountId],
  );
  assert.equal(Number(ccMovCount.n), 1, 'El perdedor concurrente no debe crear ABONO en cuenta corriente');
});

test('9. R01: fallos SQL/concurrencia en consulta de cotización FER17 NO devuelven 422 COTIZACION_FER17_NO_VERIFICADA y hacen ROLLBACK', async t => {
  const company = await createClient({ type: 'EMPRESA', withAccount: true, habilitada: 1, cobertura: 'COMPLETA' });
  const ccOrder = await createOrder(company.clientId, { modalidad: 'CUENTA_CORRIENTE', total: '100.00' });
  await ledger.registrarCargoPorPedido({
    id_cuenta_corriente: company.accountId,
    id_pedido: ccOrder,
    monto: '100.00',
    moneda: 'USD',
  });

  const pendingArs = await api('/admin/pagos', {
    method: 'POST',
    auth: admin1,
    key: randomUUID(),
    body: {
      cuentaCorrienteId: company.accountId,
      monto: '25000.00',
      moneda: 'ARS',
      metodoPago: 'TRANSFERENCIA',
      estado: 'PENDIENTE',
    },
  });
  assert.equal(pendingArs.status, 201);
  const pagoId = pendingArs.body.data.idPago;

  const scenarios = [
    {
      label: 'ER_LOCK_DEADLOCK (1213)',
      error: Object.assign(new Error('Deadlock found when trying to get lock'), {
        name: 'QueryFailedError',
        code: 'ER_LOCK_DEADLOCK',
        errno: 1213,
        driverError: { code: 'ER_LOCK_DEADLOCK', errno: 1213 },
      }),
      expectedStatus: 409,
      expectedCode: 'CONFLICTO_CONCURRENCIA',
    },
    {
      label: 'ER_LOCK_WAIT_TIMEOUT (1205)',
      error: Object.assign(new Error('Lock wait timeout exceeded'), {
        name: 'QueryFailedError',
        code: 'ER_LOCK_WAIT_TIMEOUT',
        errno: 1205,
        driverError: { code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205 },
      }),
      expectedStatus: 409,
      expectedCode: 'CONFLICTO_CONCURRENCIA',
    },
    {
      label: 'Error SQL genérico sobre COTIZACION/FER17_CALENDARIO',
      error: Object.assign(new Error('Unknown error querying FER17_CALENDARIO / COTIZACION'), {
        name: 'QueryFailedError',
        code: 'ER_INTERNAL_ERROR',
        errno: 1815,
        driverError: { code: 'ER_INTERNAL_ERROR', errno: 1815 },
      }),
      expectedStatus: 500,
      expectedCode: undefined,
    },
  ];

  const origCreateQueryRunner = dataSource.createQueryRunner.bind(dataSource);
  for (const scenario of scenarios) {
    let injectedOnce = false;
    const seen = [];
    t.mock.method(dataSource, 'createQueryRunner', (...args) => {
      const runner = origCreateQueryRunner(...args);
      const origQuery = runner.query.bind(runner);
      runner.query = async (...qArgs) => {
        const sql = qArgs[0];
        if (typeof sql === 'string') seen.push(sql.slice(0, 60));
        if (!injectedOnce && typeof sql === 'string' && sql.includes('FER17_CALENDARIO')) {
          injectedOnce = true;
          throw scenario.error;
        }
        return origQuery(...qArgs);
      };
      return runner;
    });

    const key = randomUUID();
    const res = await api(`/admin/pagos/${pagoId}/acreditar`, {
      method: 'POST',
      auth: admin1,
      key,
      body: { evidenciaAcreditacion: `R01-${scenario.label}`, fechaAcreditacionUtc: '2026-10-02T15:00:00Z' },
    });
    assert.equal(injectedOnce, true, `${scenario.label} status=${res.status} body=${JSON.stringify(res.body)} seen=${JSON.stringify(seen)}`);
    assert.equal(res.status, scenario.expectedStatus, `${scenario.label}: ${JSON.stringify(res.body)}`);
    assert.notEqual(res.status, 422, `${scenario.label} nunca debe mapearse a 422`);
    assert.notEqual(res.body?.code, 'COTIZACION_FER17_NO_VERIFICADA', scenario.label);
    if (scenario.expectedCode !== undefined) {
      assert.equal(res.body.code, scenario.expectedCode, scenario.label);
    }

    // Verificar ROLLBACK íntegro: PAGO sigue PENDIENTE, sin ABONO ni clave persistida
    const [pagoRow] = await q('SELECT estado, monto_usd, clave_idempotencia_acreditacion FROM PAGO WHERE id_pago = ?', [pagoId]);
    assert.equal(pagoRow.estado, 'PENDIENTE', scenario.label);
    assert.equal(pagoRow.monto_usd, null, scenario.label);
    assert.equal(pagoRow.clave_idempotencia_acreditacion, null, scenario.label);
    const [idemRow] = await q('SELECT COUNT(*) AS n FROM PAGO_IDEMPOTENCIA WHERE clave_idempotencia = ?', [key]);
    assert.equal(Number(idemRow.n), 0, scenario.label);
    const [abonoRow] = await q('SELECT COUNT(*) AS n FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago = ?', [pagoId]);
    assert.equal(Number(abonoRow.n), 0, scenario.label);

    t.mock.restoreAll();
  }
});

test('10. R03: contrato unificado /api/admin/pagos* (#317 + #333), guardia documental 409, idempotencia global y flujo completo con FER17-v1 + Socket.IO', async t => {
  const company = await createClient({ type: 'EMPRESA', withAccount: true, habilitada: 1, cobertura: 'COMPLETA' });
  const ccOrder = await createOrder(company.clientId, { modalidad: 'CUENTA_CORRIENTE', total: '120.00' });
  await ledger.registrarCargoPorPedido({
    id_cuenta_corriente: company.accountId,
    id_pedido: ccOrder,
    monto: '120.00',
    moneda: 'USD',
  });

  const sClient = await connectSocket(t, company.auth);
  const sAdmin = await connectSocket(t, admin1);

  // 1) Alta directa ADMIN con clave_idempotencia e id_usuario_declarante IS NULL (chk_pago_declaracion unificado)
  const directKey = randomUUID();
  const directAdminPay = await api('/admin/pagos', {
    method: 'POST',
    auth: admin1,
    key: directKey,
    body: {
      cuentaCorrienteId: company.accountId,
      monto: '20.00',
      moneda: 'USD',
      metodoPago: 'TRANSFERENCIA',
      estado: 'PENDIENTE',
    },
  });
  assert.equal(directAdminPay.status, 201, JSON.stringify(directAdminPay.body));
  assert.equal(directAdminPay.body.data.declaranteUsuarioId, null);
  const [directIdem] = await q(
    'SELECT operacion FROM PAGO_IDEMPOTENCIA WHERE clave_idempotencia = ?',
    [directKey],
  );
  assert.equal(directIdem.operacion, 'CREAR');

  // 2) Cliente sube comprobante (#275) y declara pago ARS (#333)
  const up1 = await api(`/cuenta-corriente/comprobantes?pedidoId=${ccOrder}`, {
    method: 'POST',
    auth: company.auth,
    body: pdf1,
    headers: { 'Content-Type': 'application/pdf' },
  });
  assert.equal(up1.status, 201);
  const receiptId1 = up1.body.data.id;

  const declKey1 = randomUUID();
  const declared1 = await api('/cuenta-corriente/pagos', {
    method: 'POST',
    auth: company.auth,
    key: declKey1,
    body: {
      monto: '50000.00',
      moneda: 'ARS',
      comprobanteId: receiptId1,
      observaciones: 'Declaración ARS integrada R03',
    },
  });
  assert.equal(declared1.status, 201, JSON.stringify(declared1.body));
  const declaredId1 = declared1.body.data.id;
  const [declIdemRow] = await q(
    'SELECT operacion, id_pago FROM PAGO_IDEMPOTENCIA WHERE clave_idempotencia = ?',
    [declKey1],
  );
  assert.equal(declIdemRow.operacion, 'DECLARAR');
  assert.equal(Number(declIdemRow.id_pago), declaredId1);

  // Colisión cross-operación: reusar clave de DECLARAR en POST /api/admin/pagos o /acreditar -> 409 CLAVE_IDEMPOTENCIA_REUTILIZADA
  const crossReuseCreate = await api('/admin/pagos', {
    method: 'POST',
    auth: admin1,
    key: declKey1,
    body: {
      cuentaCorrienteId: company.accountId,
      monto: '10.00',
      moneda: 'USD',
      metodoPago: 'TRANSFERENCIA',
      estado: 'PENDIENTE',
    },
  });
  assert.equal(crossReuseCreate.status, 409);
  assert.equal(crossReuseCreate.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');

  // 3) Guardia obligatoria R03: acreditar pago declarado por cliente con estado_documental = PENDIENTE -> 409 sin ABONO ni evento
  const prematureAccredit = await api(`/admin/pagos/${declaredId1}/acreditar`, {
    method: 'POST',
    auth: admin1,
    key: randomUUID(),
    body: { evidencia: 'Intento prematuro sin revisión', fechaAcreditacionUtc: '2026-10-02T15:00:00Z' },
  });
  assert.equal(prematureAccredit.status, 409, JSON.stringify(prematureAccredit.body));
  assert.equal(prematureAccredit.body.code, 'PAGO_PENDIENTE_REVISION');
  assert.equal(Number((await q('SELECT COUNT(*) AS n FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago = ?', [declaredId1]))[0].n), 0);
  assert.equal((await ledger.calcularEstadoCuenta(company.accountId)).deuda_vigente, '120.00');
  await flushSockets(sClient, sAdmin);
  assert.equal(sClient.events.payment.length, 0);

  // 4) Guardia obligatoria R03: comprobante rechazado en COMPROBANTE_PAGO bloquea acreditación con 409 PAGO_DOCUMENTALMENTE_RECHAZADO
  const up2 = await api('/cuenta-corriente/comprobantes', {
    method: 'POST',
    auth: company.auth,
    body: png1,
    headers: { 'Content-Type': 'image/png' },
  });
  assert.equal(up2.status, 201);
  const receiptId2 = up2.body.data.id;
  const declared2 = await api('/cuenta-corriente/pagos', {
    method: 'POST',
    auth: company.auth,
    key: randomUUID(),
    body: { monto: '10.00', moneda: 'USD', comprobanteId: receiptId2 },
  });
  assert.equal(declared2.status, 201);
  const declaredId2 = declared2.body.data.id;
  assert.equal((await api(`/admin/pagos/${declaredId2}/revision`, {
    method: 'PATCH',
    auth: admin1,
    key: randomUUID(),
    body: { decision: 'APROBADO' },
  })).status, 200);
  assert.equal((await api(`/admin/comprobantes/${receiptId2}/revision`, {
    method: 'PATCH',
    auth: admin1,
    key: randomUUID(),
    body: { estado: 'RECHAZADO', motivo: 'Archivo ilegible en auditoría' },
  })).status, 200);

  const rejectedReceiptAccredit = await api(`/admin/pagos/${declaredId2}/acreditar`, {
    method: 'POST',
    auth: admin1,
    key: randomUUID(),
    body: { evidenciaAcreditacion: 'Intento con comprobante rechazado', fechaAcreditacionUtc: '2026-10-02T15:00:00Z' },
  });
  assert.equal(rejectedReceiptAccredit.status, 409, JSON.stringify(rejectedReceiptAccredit.body));
  assert.equal(rejectedReceiptAccredit.body.code, 'PAGO_DOCUMENTALMENTE_RECHAZADO');
  assert.equal(Number((await q('SELECT COUNT(*) AS n FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago = ?', [declaredId2]))[0].n), 0);

  // Y un pago rechazado documentalmente vía PATCH /admin/pagos/:id/revision -> 409 sin ABONO
  const up3 = await api('/cuenta-corriente/comprobantes', {
    method: 'POST',
    auth: company.auth,
    body: jpg1,
    headers: { 'Content-Type': 'image/jpeg' },
  });
  assert.equal(up3.status, 201);
  const declared3 = await api('/cuenta-corriente/pagos', {
    method: 'POST',
    auth: company.auth,
    key: randomUUID(),
    body: { monto: '15.00', moneda: 'USD', comprobanteId: up3.body.data.id },
  });
  assert.equal(declared3.status, 201);
  const declaredId3 = declared3.body.data.id;
  assert.equal((await api(`/admin/pagos/${declaredId3}/revision`, {
    method: 'PATCH',
    auth: admin1,
    key: randomUUID(),
    body: { decision: 'RECHAZADO', motivo: 'Comprobante no corresponde' },
  })).status, 200);
  const rejectedDocAccredit = await api(`/admin/pagos/${declaredId3}/acreditar`, {
    method: 'POST',
    auth: admin1,
    key: randomUUID(),
    body: { evidencia: 'Intento tras rechazo documental', fechaAcreditacionUtc: '2026-10-02T15:00:00Z' },
  });
  assert.equal(rejectedDocAccredit.status, 409, JSON.stringify(rejectedDocAccredit.body));
  assert.equal(Number((await q('SELECT COUNT(*) AS n FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago = ?', [declaredId3]))[0].n), 0);

  // 5) Flujo integrado completo: cliente declara ARS -> admin aprueba revisión documental -> admin acredita con FER17-v1 -> ABONO + FIFO + pago.acreditado.v1 post-COMMIT
  const reviewKey1 = randomUUID();
  const approvedDoc = await api(`/admin/pagos/${declaredId1}/revision`, {
    method: 'PATCH',
    auth: admin1,
    key: reviewKey1,
    body: { decision: 'APROBADO' },
  });
  assert.equal(approvedDoc.status, 200, JSON.stringify(approvedDoc.body));
  assert.equal(approvedDoc.body.data.estado, 'PENDIENTE');
  assert.equal(approvedDoc.body.data.estadoDocumental, 'APROBADO');
  const [revIdemRow] = await q(
    'SELECT operacion FROM PAGO_IDEMPOTENCIA WHERE clave_idempotencia = ?',
    [reviewKey1],
  );
  assert.equal(revIdemRow.operacion, 'REVISAR_PAGO');
  assert.equal((await ledger.calcularEstadoCuenta(company.accountId)).deuda_vigente, '120.00');

  // Reusar clave de REVISAR_PAGO en ACREDITAR -> 409 CLAVE_IDEMPOTENCIA_REUTILIZADA
  const reuseRevKey = await api(`/admin/pagos/${declaredId1}/acreditar`, {
    method: 'POST',
    auth: admin1,
    key: reviewKey1,
    body: { evidencia: 'Reuso de clave revisión', fechaAcreditacionUtc: '2026-10-02T15:00:00Z' },
  });
  assert.equal(reuseRevKey.status, 409);
  assert.equal(reuseRevKey.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');

  // Acreditar con alias evidencia + fechaAcreditacionUtc -> 50000 ARS / 1000 = 50.00 USD
  const accreditKey1 = randomUUID();
  const accredited = await api(`/admin/pagos/${declaredId1}/acreditar`, {
    method: 'POST',
    auth: admin1,
    key: accreditKey1,
    body: {
      evidencia: 'EXTRACTO-R03-FER17-ARS',
      fechaAcreditacionUtc: '2026-10-02T15:00:00Z',
    },
  });
  assert.equal(accredited.status, 200, JSON.stringify(accredited.body));
  assert.equal(accredited.body.data.id, declaredId1);
  assert.equal(accredited.body.data.idPago, declaredId1);
  assert.equal(accredited.body.data.estado, 'ACREDITADO');
  assert.equal(accredited.body.data.estadoDocumental, 'APROBADO');
  assert.equal(accredited.body.data.montoUSD, '50.00');
  assert.equal(accredited.body.data.montoUsd, '50.00');
  assert.equal(accredited.body.data.idCotizacion, verifiedQuoteId);
  assert.equal(accredited.body.data.tasaHistorica, '1000.00000000');
  assert.ok(accredited.body.data.abonoMovimientoId > 0);
  assert.equal(accredited.body.data.acreditadoPorUsuarioId, admin1.id);

  // Verificar ABONO + imputación FIFO + saldo CC + proyección de pedido + PAGO_IDEMPOTENCIA
  const [abono] = await q(
    'SELECT tipo_movimiento, monto, moneda, monto_original, moneda_original, id_cotizacion, tasa_historica, autorizado_por FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago = ?',
    [declaredId1],
  );
  assert.equal(abono.tipo_movimiento, 'ABONO');
  assert.equal(abono.monto, '50.00');
  assert.equal(abono.moneda, 'USD');
  assert.equal(abono.monto_original, '50000.00');
  assert.equal(abono.moneda_original, 'ARS');
  assert.equal(Number(abono.id_cotizacion), verifiedQuoteId);
  assert.equal(abono.autorizado_por, String(admin1.id));
  assert.equal((await ledger.calcularEstadoCuenta(company.accountId)).deuda_vigente, '70.00');

  const orderView = (await api(`/pedidos/${ccOrder}`, { auth: company.auth })).body.data;
  assert.equal(orderView.estadoFinanciero, 'IMPUTADO_PARCIAL');
  assert.equal(orderView.montoAcreditadoUSD, '50.00');

  const [accIdemRow] = await q(
    'SELECT operacion FROM PAGO_IDEMPOTENCIA WHERE clave_idempotencia = ?',
    [accreditKey1],
  );
  assert.equal(accIdemRow.operacion, 'ACREDITAR');

  // Evento pago.acreditado.v1 emitido post-COMMIT a cliente titular y ADMIN
  await flushSockets(sClient, sAdmin);
  assert.equal(sClient.events.payment.length, 1);
  assert.equal(sAdmin.events.payment.length, 1);
  assert.equal(sClient.events.payment[0].pagoId, declaredId1);
  assert.equal(sClient.events.payment[0].estadoPago, 'ACREDITADO');
  assert.equal(sClient.events.payment[0].montoUSD, '50.00');
  assert.ok(sClient.events.payment[0].revisionCuenta !== null);
});

async function applySqlFileOnConnection(conn, filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  let delimiter = ';';
  let buffer = '';
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    const delimMatch = /^DELIMITER\s+(\S+)$/i.exec(trimmed);
    if (delimMatch) {
      if (buffer.trim()) {
        await conn.query(buffer.trim());
        buffer = '';
      }
      delimiter = delimMatch[1];
      continue;
    }
    if (trimmed.startsWith('--') || trimmed === '') {
      continue;
    }
    buffer += `${line}\n`;
    const trimmedEnd = buffer.trimEnd();
    if (trimmedEnd.endsWith(delimiter)) {
      const stmt = trimmedEnd.slice(0, -delimiter.length).trim();
      buffer = '';
      if (stmt) {
        await conn.query(stmt);
      }
    }
  }
  if (buffer.trim()) {
    await conn.query(buffer.trim());
  }
}

async function stripToPre317Schema(conn) {
  await conn.query(`
    ALTER TABLE COMPROBANTE_PAGO
      ADD KEY fk_comprobante_admin (id_admin_revision),
      DROP CONSTRAINT chk_comprobante_revision,
      DROP CONSTRAINT chk_comprobante_estado_revision,
      DROP CONSTRAINT chk_comprobante_clave_revision,
      DROP INDEX uq_comprobante_clave_revision,
      DROP COLUMN estado_revision,
      DROP COLUMN motivo_rechazo,
      DROP COLUMN clave_idempotencia_revision
  `);
  await conn.query(
    'ALTER TABLE COMPROBANTE_PAGO ADD CONSTRAINT chk_comprobante_revision CHECK ((id_admin_revision IS NULL) = (revision_utc IS NULL))',
  );
  await conn.query('DROP TABLE IF EXISTS PAGO_IDEMPOTENCIA');
  await conn.query(`
    ALTER TABLE PAGO
      DROP FOREIGN KEY fk_pago_cotizacion,
      DROP FOREIGN KEY fk_pago_admin_actor,
      DROP FOREIGN KEY fk_pago_admin_cierre,
      DROP CONSTRAINT chk_pago_estado,
      DROP CONSTRAINT chk_pago_monto_usd,
      DROP CONSTRAINT chk_pago_conversion,
      DROP CONSTRAINT chk_pago_documental,
      DROP CONSTRAINT chk_pago_revision,
      DROP CONSTRAINT chk_pago_declaracion,
      DROP CONSTRAINT chk_pago_acreditacion,
      DROP CONSTRAINT chk_pago_claves,
      DROP CONSTRAINT chk_pago_cierre,
      DROP INDEX uq_pago_idempotencia,
      DROP INDEX uq_pago_acreditacion,
      DROP INDEX uq_pago_clave_idempotencia,
      DROP INDEX uq_pago_clave_acreditacion,
      DROP INDEX uq_pago_clave_cierre,
      DROP INDEX uq_pago_comprobante,
      DROP INDEX idx_pago_cuenta_estado,
      DROP INDEX idx_pago_cotizacion,
      DROP INDEX idx_pago_admin_actor,
      DROP INDEX idx_pago_admin_cierre,
      DROP COLUMN monto_usd,
      DROP COLUMN id_cotizacion,
      DROP COLUMN tasa_historica,
      DROP COLUMN id_usuario_declarante,
      DROP COLUMN clave_idempotencia,
      DROP COLUMN huella_declaracion,
      DROP COLUMN id_comprobante,
      DROP COLUMN estado_documental,
      DROP COLUMN id_admin_revision,
      DROP COLUMN revision_utc,
      DROP COLUMN motivo_revision,
      DROP COLUMN id_admin_acreditacion,
      DROP COLUMN clave_acreditacion,
      DROP COLUMN huella_acreditacion,
      DROP COLUMN clave_idempotencia_acreditacion,
      DROP COLUMN clave_idempotencia_cierre,
      DROP COLUMN motivo_cierre,
      DROP COLUMN id_admin_actor,
      DROP COLUMN id_admin_cierre,
      DROP COLUMN fecha_cierre_utc
  `);
}

async function startIsolatedBackendForDb(dbName) {
  const backendRoot = path.resolve(__dirname, '..');
  const serverScript = `
    const { once } = require('node:events');
    const db = require('./dist/config/database.config');
    const { createBackendServer } = require('./dist/http-server');
    (async () => {
      await db.initializeDatabase();
      const srv = createBackendServer();
      srv.io.on('connection', socket => {
        socket.on('test:flush-req', async () => {
          await srv.waitForNotifications();
          socket.emit('test:flush');
        });
      });
      srv.server.listen(0, '127.0.0.1');
      await once(srv.server, 'listening');
      process.stdout.write(JSON.stringify({ port: srv.server.address().port }) + '\\n');
      const shutdown = async () => {
        try { await srv.close(); } finally { await db.destroyDatabase(); }
        process.exit(0);
      };
      process.stdin.on('end', shutdown);
      process.on('SIGTERM', shutdown);
    })().catch(err => {
      console.error(err);
      process.exit(1);
    });
  `;

  const child = spawn(
    process.execPath,
    ['--require', './test/helpers/test-env.cjs', '-e', serverScript],
    {
      cwd: backendRoot,
      env: { ...process.env, DB_NAME: dbName },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  const port = await new Promise((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(new Error(`Timeout iniciando backend R05: ${stderr}`)), 15000);
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      const nl = stdout.indexOf('\n');
      if (nl >= 0) {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(stdout.slice(0, nl)).port);
        } catch (err) {
          reject(err);
        }
      }
    });
    child.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Backend R05 terminó prematuramente (${code}): ${stderr}`));
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async stop() {
      if (child.exitCode !== null) return;
      await new Promise(resolve => {
        const killTimer = setTimeout(() => {
          child.kill('SIGTERM');
          resolve();
        }, 5000);
        child.once('exit', () => {
          clearTimeout(killTimer);
          resolve();
        });
        child.stdin.end();
      });
    },
  };
}

test('11. R05: migración real sobre base previa a #317 conserva huella histórica #333 y valida replay estricto sin duplicar ABONO ni Socket.IO', async t => {
  const r05Db = `r05_legacy_${randomUUID().replaceAll('-', '')}`;
  const dbDir = path.resolve(__dirname, '../../database');
  const conn = await mariadb.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    timezone: 'Z',
    dateStrings: true,
    bigIntAsNumber: true,
    insertIdAsNumber: true,
  });

  let r05Server;
  try {
    await conn.query(`CREATE DATABASE \`${r05Db}\``);
    await conn.query(`USE \`${r05Db}\``);

    for (const file of [
      'schema.sql',
      'migrate-fer-20-account-movements.sql',
      'migrate-fer-17-price-verification.sql',
      'migrate-s7-09-1-credit-workflow.sql',
      'migrate-s7-06-1-transfer-order-confirmation.sql',
    ]) {
      await applySqlFileOnConnection(conn, path.join(dbDir, file));
    }

    await stripToPre317Schema(conn);
    await applySqlFileOnConnection(conn, path.join(dbDir, 'migrate-s7-10-2-payment-accreditation.sql'));

    // Base previa a #317 (#333): empresa REAL (cobertura COMPLETA), comprobante válido, cargo, pago acreditado con huella #333, ABONO e imputación FIFO
    const legacyAdmin1Id = Number((await conn.query(
      "INSERT INTO USUARIO (email, password_hash, rol, activo) VALUES ('r05-admin1@s704.test', 'test-only', 'ADMIN', 1)",
    )).insertId);
    const legacyAdmin2Id = Number((await conn.query(
      "INSERT INTO USUARIO (email, password_hash, rol, activo) VALUES ('r05-admin2@s704.test', 'test-only', 'ADMIN', 1)",
    )).insertId);
    const legacyAdmin1 = { id: legacyAdmin1Id, rol: 'ADMIN' };
    const legacyAdmin2 = { id: legacyAdmin2Id, rol: 'ADMIN' };

    const clientId = Number((await conn.query(
      "INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, email, estado_aprobacion_empresa, es_fiel, activo) VALUES ('EMPRESA', 'Empresa Legacy #333 R05', 'r05-empresa@s704.test', 'APROBADA', 0, 1)",
    )).insertId);
    const clientUserId = Number((await conn.query(
      "INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo) VALUES (?, 'r05-user@s704.test', 'test-only', 'CLIENTE', 1)",
      [clientId],
    )).insertId);
    const clientAuth = { id: clientUserId, rol: 'CLIENTE' };

    const accountId = Number((await conn.query(
      `INSERT INTO CUENTA_CORRIENTE (
        id_cliente, limite_credito, habilitada, cobertura, plazo_dias,
        moneda_limite, evidencia_limite, evidencia_plazo, evidencia_cobertura,
        cobertura_desde_utc, origen_datos
      ) VALUES (?, 5000.00, 1, 'COMPLETA', 30, 'USD', 'ACTA-R05', 'PLAZO-R05', 'ALTA-R05', '2020-01-01 00:00:00.000', 'REAL')`,
      [clientId],
    )).insertId);

    const orderId = Number((await conn.query(
      `INSERT INTO PEDIDO (
        id_cliente, estado, modalidad_pago, subtotal, descuento, total,
        moneda_total, evidencia_total_usd, fecha_utc
      ) VALUES (?, 'CONFIRMADO', 'CUENTA_CORRIENTE', 200.00, 0.00, 200.00, 'USD', 'FER17-v1:R05', UTC_TIMESTAMP(3))`,
      [clientId],
    )).insertId);

    const cargoId = Number((await conn.query(
      `INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE (
        id_cuenta_corriente, tipo_movimiento, origen, id_pedido, monto, moneda,
        fecha_efectiva, fecha_incorporacion, estado, autorizado_por,
        fecha_base_civil, plazo_aplicado, vence_el, huella_registro, evidencia_origen,
        monto_original, moneda_original
      ) VALUES (?, 'CARGO', 'PEDIDO', ?, 200.00, 'USD', '2026-10-01 10:00:00', '2026-10-01 10:00:00', 'ACREDITADO', ?, '2026-10-01', 30, '2026-10-31', SHA2('r05-cargo', 256), '{"source":"r05-cargo"}', 200.00, 'USD')`,
      [accountId, orderId, String(legacyAdmin1Id)],
    )).insertId);

    const receiptId = randomUUID();
    await conn.query(
      `INSERT INTO COMPROBANTE_PAGO (
        id_comprobante, id_cliente, id_usuario_carga, id_pedido, id_cuenta_corriente,
        tipo_mime, bytes, sha256, fecha_utc, id_admin_revision, revision_utc
      ) VALUES (?, ?, ?, ?, ?, 'application/pdf', 128, UNHEX(REPEAT('cd', 32)), '2026-10-01 11:00:00.000', ?, '2026-10-01 12:00:00.000')`,
      [receiptId, clientId, clientUserId, orderId, accountId, legacyAdmin1Id],
    );

    const declKey = randomUUID();
    const declHash = createHash('sha256').update(JSON.stringify({
      operacion: 'DECLARAR',
      cuentaCorrienteId: accountId,
      usuarioId: clientUserId,
      monto: '50.00',
      moneda: 'USD',
      comprobanteId: receiptId,
      observaciones: null,
    })).digest('hex');
    const legacyEvidence = 'EXTRACTO-BNA-LEGACY-333';
    const legacyAccKey = randomUUID();
    const placeholderHash = '0'.repeat(64);

    const paymentId = Number((await conn.query(
      `INSERT INTO PAGO (
        id_cuenta_corriente, fecha, monto, moneda, monto_usd, metodo_pago, estado,
        comprobante, id_usuario_declarante, clave_idempotencia, huella_declaracion,
        id_comprobante, estado_documental, id_admin_revision, revision_utc,
        id_admin_acreditacion, clave_acreditacion, huella_acreditacion,
        fecha_acreditacion_utc, evidencia_acreditacion
      ) VALUES (
        ?, '2026-10-01 11:05:00', 50.00, 'USD', 50.00, 'TRANSFERENCIA', 'ACREDITADO',
        ?, ?, ?, ?, ?, 'APROBADO', ?, '2026-10-01 12:05:00.000',
        ?, ?, ?, '2026-10-02 15:00:00.000', ?
      )`,
      [
        accountId, receiptId, clientUserId, declKey, declHash, receiptId,
        legacyAdmin1Id, legacyAdmin1Id, legacyAccKey, placeholderHash, legacyEvidence,
      ],
    )).insertId);

    const legacyHash = createHash('sha256')
      .update(JSON.stringify(['ACREDITACION_PAGO', paymentId, legacyAdmin1Id, legacyEvidence]))
      .digest('hex');
    await conn.query('UPDATE PAGO SET huella_acreditacion = ? WHERE id_pago = ?', [legacyHash, paymentId]);

    const abonoId = Number((await conn.query(
      `INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE (
        id_cuenta_corriente, tipo_movimiento, origen, id_pago, monto, moneda,
        fecha_efectiva, fecha_incorporacion, estado, autorizado_por,
        huella_registro, evidencia_origen, monto_original, moneda_original
      ) VALUES (?, 'ABONO', 'PAGO', ?, 50.00, 'USD', '2026-10-02 15:00:00', '2026-10-02 15:00:00', 'ACREDITADO', ?, SHA2('r05-abono', 256), '{"source":"r05-abono"}', 50.00, 'USD')`,
      [accountId, paymentId, String(legacyAdmin1Id)],
    )).insertId);

    await conn.query(
      `INSERT INTO IMPUTACION_MOVIMIENTO_CUENTA (
        id_cuenta_corriente, id_cargo, id_abono, monto_imputado,
        fecha_imputacion, estado, revision, evento
      ) VALUES (?, ?, ?, 50.00, '2026-10-02 15:00:00', 'VIGENTE', 1, ?)`,
      [accountId, cargoId, abonoId, `PAGO_ACREDITADO:${legacyAccKey}`],
    );

    // Segundo pago PENDIENTE para validar rechazo por reutilización de clave en otro pago
    const otherPaymentId = Number((await conn.query(
      `INSERT INTO PAGO (
        id_cuenta_corriente, fecha, monto, moneda, metodo_pago, estado,
        estado_documental
      ) VALUES (?, '2026-10-03 10:00:00', 25.00, 'USD', 'TRANSFERENCIA', 'PENDIENTE', 'PENDIENTE')`,
      [accountId],
    )).insertId);

    // Ejecutar migración real #317 sobre la base previa a #317
    await applySqlFileOnConnection(conn, path.join(dbDir, 'migrate-s7-04-2-state-consistency.sql'));

    // Comprobar que PAGO_IDEMPOTENCIA conserva exactamente la huella histórica de #333
    const [idemRow] = await conn.query(
      'SELECT clave_idempotencia, id_pago, operacion, payload_hash FROM PAGO_IDEMPOTENCIA WHERE clave_idempotencia = ?',
      [legacyAccKey],
    );
    assert.ok(idemRow, 'PAGO_IDEMPOTENCIA debe contener la clave histórica de #333 tras la migración');
    assert.equal(Number(idemRow.id_pago), paymentId);
    assert.equal(idemRow.operacion, 'ACREDITAR');
    assert.equal(idemRow.payload_hash, legacyHash);

    const [migratedReceipt] = await conn.query(
      'SELECT estado_revision FROM COMPROBANTE_PAGO WHERE id_comprobante = ?',
      [receiptId],
    );
    assert.equal(migratedReceipt.estado_revision, 'APROBADO');

    const readCuentaState = async () => {
      await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await conn.beginTransaction();
      try {
        const state = await ledger.calcularEstadoCuenta(accountId, {
          query: (sql, params) => conn.query(sql, params),
          queryRunner: { isTransactionActive: true },
        });
        await conn.commit();
        return state;
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    };

    const fifoBefore = await conn.query(
      'SELECT id_imputacion, id_cargo, id_abono, monto_imputado, estado, revision, evento FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_cuenta_corriente = ? ORDER BY id_imputacion',
      [accountId],
    );
    const ccBefore = await readCuentaState();
    assert.equal(ccBefore.deuda_vigente, '150.00');

    // Levantar backend HTTP + Socket.IO real apuntando a la base migrada r05Db
    r05Server = await startIsolatedBackendForDb(r05Db);
    const sClient = await connectSocket(t, clientAuth, r05Server.baseUrl);
    const sAdmin = await connectSocket(t, legacyAdmin1, r05Server.baseUrl);

    // Replay idempotente con el MISMO admin y {"evidencia": "<misma-evidencia>"} -> 200 OK
    const replayAlias = await api(`/admin/pagos/${paymentId}/acreditar`, {
      baseUrl: r05Server.baseUrl,
      method: 'POST',
      auth: legacyAdmin1,
      key: legacyAccKey,
      body: { evidencia: legacyEvidence },
    });
    assert.equal(replayAlias.status, 200, JSON.stringify(replayAlias.body));
    assert.equal(replayAlias.body.meta.replay, true);
    assert.equal(replayAlias.body.data.idPago, paymentId);
    assert.equal(replayAlias.body.data.estado, 'ACREDITADO');
    assert.equal(replayAlias.body.data.montoUSD, '50.00');

    // Replay idempotente con el MISMO admin y {"evidenciaAcreditacion": "<misma-evidencia>"} -> 200 OK
    const replayPrimary = await api(`/admin/pagos/${paymentId}/acreditar`, {
      baseUrl: r05Server.baseUrl,
      method: 'POST',
      auth: legacyAdmin1,
      key: legacyAccKey,
      body: { evidenciaAcreditacion: legacyEvidence },
    });
    assert.equal(replayPrimary.status, 200, JSON.stringify(replayPrimary.body));
    assert.equal(replayPrimary.body.meta.replay, true);
    assert.equal(replayPrimary.body.data.idPago, paymentId);

    // Verificar exactamente 1 ABONO, deuda_vigente e imputaciones FIFO idénticas, y cero eventos Socket.IO duplicados
    const [abonoCountAfterReplay] = await conn.query(
      "SELECT COUNT(*) AS n FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago = ? AND tipo_movimiento = 'ABONO'",
      [paymentId],
    );
    assert.equal(Number(abonoCountAfterReplay.n), 1);
    assert.equal((await readCuentaState()).deuda_vigente, '150.00');
    assert.deepEqual(
      await conn.query(
        'SELECT id_imputacion, id_cargo, id_abono, monto_imputado, estado, revision, evento FROM IMPUTACION_MOVIMIENTO_CUENTA WHERE id_cuenta_corriente = ? ORDER BY id_imputacion',
        [accountId],
      ),
      fifoBefore,
    );

    await Promise.all([sClient, sAdmin].map(async connSock => {
      const flushed = waitFor(connSock.socket, 'test:flush');
      connSock.socket.emit('test:flush-req');
      await flushed;
    }));
    assert.equal(sClient.events.payment.length, 0);
    assert.equal(sAdmin.events.payment.length, 0);

    // Reintentos inválidos -> 409 CLAVE_IDEMPOTENCIA_REUTILIZADA
    const invalidReplays = [
      {
        label: 'Otro ADMIN con misma clave y misma evidencia',
        path: `/admin/pagos/${paymentId}/acreditar`,
        auth: legacyAdmin2,
        body: { evidencia: legacyEvidence },
      },
      {
        label: 'Mismo admin con evidencia distinta',
        path: `/admin/pagos/${paymentId}/acreditar`,
        auth: legacyAdmin1,
        body: { evidencia: 'EVIDENCIA-ALTERADA' },
      },
      {
        label: 'Mismo admin con observaciones nuevas',
        path: `/admin/pagos/${paymentId}/acreditar`,
        auth: legacyAdmin1,
        body: { evidencia: legacyEvidence, observaciones: 'Observación agregada post-migración' },
      },
      {
        label: 'Mismo admin con fechaAcreditacionUtc distinta',
        path: `/admin/pagos/${paymentId}/acreditar`,
        auth: legacyAdmin1,
        body: { evidencia: legacyEvidence, fechaAcreditacionUtc: '2026-10-02T16:00:00Z' },
      },
      {
        label: 'Reutilización de clave en otro pago',
        path: `/admin/pagos/${otherPaymentId}/acreditar`,
        auth: legacyAdmin1,
        body: { evidencia: legacyEvidence },
      },
      {
        label: 'Reutilización de clave en otra operación (ANULAR)',
        path: `/admin/pagos/${paymentId}/anular`,
        auth: legacyAdmin1,
        body: { motivo: 'Reuso prohibido de clave histórica' },
      },
    ];

    for (const attempt of invalidReplays) {
      const res = await api(attempt.path, {
        baseUrl: r05Server.baseUrl,
        method: 'POST',
        auth: attempt.auth,
        key: legacyAccKey,
        body: attempt.body,
      });
      assert.equal(res.status, 409, `${attempt.label}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA', attempt.label);
    }

    // Confirmar integridad intacta tras los 409
    const [abonoCountFinal] = await conn.query(
      "SELECT COUNT(*) AS n FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago = ? AND tipo_movimiento = 'ABONO'",
      [paymentId],
    );
    assert.equal(Number(abonoCountFinal.n), 1);
    assert.equal((await readCuentaState()).deuda_vigente, '150.00');
    const [idemAfter] = await conn.query(
      'SELECT payload_hash FROM PAGO_IDEMPOTENCIA WHERE clave_idempotencia = ?',
      [legacyAccKey],
    );
    assert.equal(idemAfter.payload_hash, legacyHash);
    assert.equal(sClient.events.payment.length, 0);
    assert.equal(sAdmin.events.payment.length, 0);
  } finally {
    try { await r05Server?.stop(); } catch {}
    try { await conn.query(`DROP DATABASE IF EXISTS \`${r05Db}\``); } catch {}
    await conn.end();
  }
});
