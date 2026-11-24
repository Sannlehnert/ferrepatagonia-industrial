const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { readFile, readdir, rename } = require('node:fs/promises');
const http = require('node:http');
const { join } = require('node:path');
const { after, before, test } = require('node:test');
const jwt = require('jsonwebtoken');
const { PDFDocument, PDFName, PDFRawStream } = require('pdf-lib');
const sharp = require('sharp');
const { childProfile, connectOwned } = require('./helpers/cc260-disposable.cjs');
const { fetchFromBrowser } = require('./helpers/browser-request.cjs');

let session, database, db, server, base, signToken;
let particular, other, company, admin, pdf, png, jpg, realPdf, realPng, realJpg;
const storage = process.env.RECEIPT_STORAGE_DIR;

async function insert(sql, params = []) {
  return Number((await db.query(sql, params)).insertId);
}

async function newClient(type, withAccount = false) {
  const clientId = await insert(`
    INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, estado_aprobacion_empresa, es_fiel, activo)
    VALUES (?, ?, ?, 0, 1)
  `, [type, 'Cliente ' + type, type === 'EMPRESA' ? 'APROBADA' : null]);
  const user = await insert(`
    INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo)
    VALUES (?, ?, 'test-only', 'CLIENTE', 1)
  `, [clientId, randomUUID() + '@example.test']);
  const order = await insert(`
    INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total)
    VALUES (?, 'CONFIRMADO', ?, 42, 0, 42)
  `, [clientId, type === 'EMPRESA' ? 'CUENTA_CORRIENTE' : 'TRANSFERENCIA']);
  const account = withAccount ? await insert(`
    INSERT INTO CUENTA_CORRIENTE (id_cliente, limite_credito, habilitada, cobertura, moneda_limite)
    VALUES (?, 1000, 0, 'COMPLETA', 'USD')
  `, [clientId]) : null;
  return { clientId, order, account, auth: { id: user, rol: 'CLIENTE' } };
}

before(async () => {
  assert.ok(storage, 'El runner debe preparar almacenamiento temporal');
  session = await connectOwned(childProfile());
  db = session.connection;
  database = require('../dist/config/database.config');
  await database.initializeDatabase();
  ({ signToken } = require('../dist/services/token.service'));
  server = require('../dist/app').app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port + '/api';
  particular = await newClient('PARTICULAR');
  other = await newClient('PARTICULAR');
  company = await newClient('EMPRESA', true);
  await insert(`
    INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE (id_cuenta_corriente, tipo_movimiento, origen, id_pedido, monto, moneda)
    VALUES (?, 'CARGO', 'PEDIDO', ?, 42, 'USD')
  `, [company.account, company.order]);
  admin = { id: await insert("INSERT INTO USUARIO (email, password_hash, rol, activo) VALUES ('admin@receipt.test', 'test-only', 'ADMIN', 1)"), rol: 'ADMIN' };

  const doc = await PDFDocument.create();
  doc.addPage().drawText('Comprobante de transferencia');
  pdf = Buffer.from(await doc.save());
  const pixels = { create: { width: 10, height: 10, channels: 3, background: 'white' } };
  png = await sharp(pixels).png().toBuffer();
  jpg = await sharp(pixels).jpeg({ progressive: true }).toBuffer();
  const fixture = name => readFile(join(__dirname, 'fixtures/receipts', name));
  realPdf = await fixture('comprobante-transferencia.pdf');
  realPng = await fixture('comprobante-transferencia.png');
  realJpg = await fixture('comprobante-transferencia.jpg');
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

const orderPath = ({ order }) => '/pedidos/' + order + '/comprobantes';
const accountPath = '/cuenta-corriente/comprobantes';
const adminPath = '/admin/comprobantes';

function request(path, auth, options = {}) {
  return fetchFromBrowser(base + path, {
    ...options,
    headers: { ...(auth ? { Cookie: 'jwt_token=' + signToken(auth) } : {}), ...options.headers },
    signal: AbortSignal.timeout(10000),
  });
}

function upload(path, auth, bytes = pdf, mime = 'application/pdf', headers = {}) {
  return request(path, auth, { method: 'POST', headers: { 'Content-Type': mime, ...headers }, body: bytes });
}

async function body(response, status) {
  assert.equal(response.status, status, status !== response.status ? await response.text() : '');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const vary = response.headers.get('vary') ?? '';
  assert.ok(vary.split(',').some(value => value.trim().toLowerCase() === 'cookie'), 'Debe variar según Cookie');
  return response.json();
}

function assertDownloadHeaders(response, mime, expectedBytes, extension) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), mime);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const vary = response.headers.get('vary') ?? '';
  assert.ok(vary.split(',').some(value => value.trim().toLowerCase() === 'cookie'), 'Descarga debe variar según Cookie');
  assert.match(
    response.headers.get('content-disposition'),
    new RegExp(`^attachment; filename="comprobante-[a-f0-9-]+\\.${extension}"$`),
  );
  assert.equal(Number(response.headers.get('content-length')), expectedBytes);
}

async function createExactSizePdf(targetBytes) {
  const buildWithPad = async padLength => {
    const doc = await PDFDocument.create();
    doc.addPage().drawText('Comprobante frontera 5 MiB');
    const padBytes = Buffer.alloc(padLength, 0x20);
    const stream = PDFRawStream.of(doc.context.obj({ Length: padLength }), padBytes);
    doc.context.register(stream);
    return Buffer.from(await doc.save({ useObjectStreams: false }));
  };
  let pad = targetBytes - 2000;
  let candidate = await buildWithPad(pad);
  for (let i = 0; i < 4 && candidate.length !== targetBytes; i++) {
    pad += targetBytes - candidate.length;
    candidate = await buildWithPad(pad);
  }
  assert.equal(candidate.length, targetBytes);
  return candidate;
}

async function financialState() {
  const result = {};
  for (const [table, order] of Object.entries({
    PEDIDO: 'id_pedido', PAGO: 'id_pago', CUENTA_CORRIENTE: 'id_cuenta_corriente',
    MOVIMIENTO_CUENTA_CORRIENTE: 'id_movimiento_cuenta',
    IMPUTACION_MOVIMIENTO_CUENTA: 'id_imputacion',
  })) result[table] = await db.query(`SELECT * FROM ${table} ORDER BY ${order}`);
  return result;
}

test('particular: carga, lista, descarga privada y revisión documental, sin cambios financieros', async () => {
  const before = await financialState();
  const path = orderPath(particular);
  const saved = (await body(await upload(path, particular.auth, pdf, 'application/pdf', {
    'Content-Disposition': 'attachment; filename="../../desarrollo.env"',
  }), 201)).data;
  assert.equal(saved.pedidoId, particular.order);
  assert.equal(saved.cuentaCorrienteId, null);
  assert.equal(saved.estadoRevision, 'PENDIENTE');
  assert.equal(saved.revisadoEn, null);
  assert.equal(saved.bytes, pdf.length);
  assert.equal(saved.tipoMime, 'application/pdf');
  assert.equal(saved.cliente, undefined);
  assert.deepEqual(await readFile(join(storage, saved.id)), pdf);

  const own = (await body(await request(path, particular.auth), 200)).data.items;
  assert.deepEqual(own, [saved]);
  const response = await request(path + '/' + saved.id, particular.auth);
  assertDownloadHeaders(response, 'application/pdf', pdf.length, 'pdf');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
  const head = await request(path + '/' + saved.id, particular.auth, { method: 'HEAD' });
  assertDownloadHeaders(head, 'application/pdf', pdf.length, 'pdf');
  assert.equal((await head.arrayBuffer()).byteLength, 0);

  await body(await request(path + '/' + saved.id, null), 401);
  await body(await request(path, other.auth), 404);
  await body(await request(path + '/' + saved.id, other.auth), 404);
  await body(await request(orderPath(other) + '/' + saved.id, particular.auth), 404);
  await body(await upload(path, other.auth), 404);
  await body(await request(adminPath, particular.auth), 403);
  await body(await request(adminPath + '/' + saved.id + '/revision', particular.auth, { method: 'PATCH' }), 403);
  await body(await upload(path, admin), 403);
  const listed = (await body(await request(adminPath, admin), 200)).data.items.find(row => row.id === saved.id);
  assert.equal(listed.clienteId, particular.clientId);
  assert.equal(listed.cliente, 'Cliente PARTICULAR');
  const adminDownload = await request(adminPath + '/' + saved.id, admin);
  assert.equal(adminDownload.status, 200);
  assert.deepEqual(Buffer.from(await adminDownload.arrayBuffer()), pdf);

  const reviewPath = adminPath + '/' + saved.id + '/revision';
  const reviewKey = randomUUID();
  const reviewHeaders = { 'Content-Type': 'application/json', 'Idempotency-Key': reviewKey };
  const first = (await body(await request(reviewPath, admin, {
    method: 'PATCH',
    headers: reviewHeaders,
    body: JSON.stringify({ estado: 'APROBADO' }),
  }), 200)).data;
  const repeated = (await body(await request(reviewPath, admin, {
    method: 'PATCH',
    headers: reviewHeaders,
    body: JSON.stringify({ estado: 'APROBADO' }),
  }), 200)).data;
  assert.equal(first.estadoRevision, 'APROBADO');
  assert.equal(first.motivoRechazo, null);
  assert.ok(first.revisadoEn.endsWith('Z'));
  assert.deepEqual(first, repeated);
  assert.equal((await db.query('SELECT id_admin_revision FROM COMPROBANTE_PAGO WHERE id_comprobante = ?', [saved.id]))[0].id_admin_revision, admin.id);
  assert.equal((await body(await request(path, particular.auth), 200)).data.items[0].estadoRevision, 'APROBADO');
  assert.deepEqual(await financialState(), before);

  const file = join(storage, saved.id);
  await rename(file, file + '.missing');
  try {
    const missing = await body(await request(path + '/' + saved.id, particular.auth), 503);
    assert.ok(!JSON.stringify(missing).includes(storage));
  } finally { await rename(file + '.missing', file); }
});

test('empresa: saldo general sin pedido y abono con referencia propia, sin imputación', async () => {
  const before = await financialState();
  const general = (await body(await upload(accountPath, company.auth, png, 'image/png'), 201)).data;
  assert.equal(general.pedidoId, null);
  assert.equal(general.cuentaCorrienteId, company.account);
  const path = orderPath(company);
  const saved = (await body(await upload(accountPath + '?pedidoId=' + company.order, company.auth, jpg, 'image/jpeg'), 201)).data;
  assert.equal(saved.pedidoId, company.order);
  assert.equal(saved.cuentaCorrienteId, company.account);
  const duplicate = (await body(await upload(path, company.auth, jpg, 'image/jpeg'), 200)).data;
  assert.equal(duplicate.id, saved.id);
  const listed = (await body(await request(accountPath, company.auth), 200)).data.items;
  assert.deepEqual(new Set(listed.map(row => row.id)), new Set([general.id, saved.id]));
  const order = (await body(await request(path, company.auth), 200)).data.items;
  assert.deepEqual(order.map(row => row.id), [saved.id]);
  const download = await request(accountPath + '/' + general.id, company.auth);
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
  await body(await request(path + '/' + general.id, company.auth), 404);
  await body(await request(accountPath + '/' + general.id, other.auth), 404);
  await body(await upload(accountPath, particular.auth), 404);
  await body(await upload(accountPath + '?pedidoId=' + particular.order, company.auth), 404);
  await body(await upload(accountPath + '?pedidoId=0', company.auth), 400);
  await body(await upload('/pedidos/2147483647/comprobantes', company.auth), 404);
  assert.deepEqual(await financialState(), before);
});

test('rechaza archivos vacíos, grandes, truncados, activos o suplantados y rutas inválidas', async () => {
  const prior = await readdir(storage);
  const path = orderPath(other);
  const invalidPdf = await PDFDocument.create();
  invalidPdf.addPage();
  invalidPdf.addJavaScript('malicious', 'app.alert(1)');
  const active = Buffer.from(await invalidPdf.save());
  const attached = await PDFDocument.create();
  attached.addPage();
  await attached.attach(Uint8Array.of(1, 2, 3), 'malicious.exe');
  for (const [bytes, mime, status] of [
    [Buffer.alloc(0), 'application/pdf', 400],
    [Buffer.alloc(5 * 1024 * 1024 + 1), 'application/pdf', 413],
    [pdf, 'application/octet-stream', 415],
    [pdf, 'image/png', 422],
    [Buffer.from('%PDF-1.7\nContenido corrupto\n%%EOF'), 'application/pdf', 422],
    [pdf.subarray(0, -14), 'application/pdf', 422],
    [Buffer.concat([pdf, Buffer.from('<script>')]), 'application/pdf', 422],
    [active, 'application/pdf', 422],
    [Buffer.from(await attached.save()), 'application/pdf', 422],
    [png.subarray(0, -6), 'image/png', 422],
    [Buffer.concat([png, png.subarray(-12)]), 'image/png', 422],
    [Buffer.concat([jpg, Buffer.from('payload'), jpg.subarray(-2)]), 'image/jpeg', 422],
    [jpg.subarray(0, -2), 'image/jpeg', 422],
  ]) await body(await upload(path, other.auth, bytes, mime), status);

  await body(await upload(path, other.auth, pdf, 'application/pdf', { 'Content-Encoding': 'gzip' }), 415);
  const missing = await body(await request(path + '/' + randomUUID(), other.auth), 404);
  assert.equal(missing.code, 'COMPROBANTE_NO_ENCONTRADO');
  const traversal = await body(await request(path + '/..%2F..%2F.env', other.auth), 404);
  assert.deepEqual(traversal, missing);
  await body(await request(path + '?clienteId=' + particular.clientId, other.auth), 400);
  assert.deepEqual(await readdir(storage), prior);
});

test('acepta PDF/PNG/JPG reales y distingue dañado, incompatible y contenido no permitido', async () => {
  const client = await newClient('PARTICULAR');
  const path = orderPath(client);
  const before = await financialState();

  const savedPdf = (await body(await upload(path, client.auth, realPdf, 'application/pdf'), 201)).data;
  const savedPng = (await body(await upload(path, client.auth, realPng, 'image/png'), 201)).data;
  const savedJpg = (await body(await upload(path, client.auth, realJpg, 'image/jpeg'), 201)).data;
  assert.deepEqual([savedPdf.tipoMime, savedPng.tipoMime, savedJpg.tipoMime],
    ['application/pdf', 'image/png', 'image/jpeg']);
  assert.deepEqual(await readFile(join(storage, savedPdf.id)), realPdf);
  assert.deepEqual(await readFile(join(storage, savedPng.id)), realPng);
  assert.deepEqual(await readFile(join(storage, savedJpg.id)), realJpg);
  const pdfDownload = await request(path + '/' + savedPdf.id, client.auth);
  assertDownloadHeaders(pdfDownload, 'application/pdf', realPdf.length, 'pdf');
  assert.deepEqual(Buffer.from(await pdfDownload.arrayBuffer()), realPdf);

  const openAction = await PDFDocument.create();
  openAction.addPage();
  openAction.catalog.set(PDFName.of('OpenAction'), openAction.context.obj({
    Type: 'Action', S: 'URI', URI: 'https://example.test/verificar',
  }));
  const activePdf = await PDFDocument.create();
  activePdf.addPage();
  activePdf.addJavaScript('malicious', 'app.alert(1)');

  const cases = [
    [realPng, 'application/pdf', 422, 'TIPO_INCOMPATIBLE'],
    [realPdf.subarray(0, -14), 'application/pdf', 422, 'ARCHIVO_DANADO'],
    [Buffer.from(await openAction.save()), 'application/pdf', 422, 'CONTENIDO_NO_PERMITIDO'],
    [Buffer.from(await activePdf.save()), 'application/pdf', 422, 'CONTENIDO_NO_PERMITIDO'],
    [realJpg.subarray(0, -2), 'image/jpeg', 422, 'ARCHIVO_DANADO'],
    [realPng, 'image/jpeg', 422, 'TIPO_INCOMPATIBLE'],
    [Buffer.alloc(0), 'application/pdf', 400, 'ARCHIVO_VACIO'],
    [Buffer.alloc(5 * 1024 * 1024 + 1), 'application/pdf', 413, 'ARCHIVO_DEMASIADO_GRANDE'],
    [realPdf, 'application/octet-stream', 415, 'TIPO_NO_PERMITIDO'],
  ];
  for (const [bytes, mime, status, code] of cases) {
    const failure = await body(await upload(path, client.auth, bytes, mime), status);
    assert.equal(failure.code, code);
    assert.equal(typeof failure.message, 'string');
    assert.ok(failure.message.length > 0);
  }

  assert.deepEqual(await financialState(), before);
});

test('un fallo SQL limpia el archivo y las cargas simultáneas idénticas se deduplican', async () => {
  const prior = await readdir(storage);
  const path = orderPath(other);
  await db.query("CREATE TRIGGER reject_receipt BEFORE INSERT ON COMPROBANTE_PAGO FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected'");
  try {
    const error = await body(await upload(path, other.auth), 503);
    assert.equal(error.code, 'COMPROBANTES_NO_DISPONIBLES');
    assert.deepEqual(await readdir(storage), prior);
  } finally { await db.query('DROP TRIGGER reject_receipt'); }

  const responses = await Promise.all([upload(path, other.auth), upload(path, other.auth)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 201]);
  const results = await Promise.all(responses.map(response => response.json()));
  assert.equal(results[0].data.id, results[1].data.id);
  const stored = await readdir(storage);
  assert.equal(stored.length, prior.length + 1);
  assert.deepEqual(Buffer.from(await readFile(join(storage, results[0].data.id))), pdf);
  const rows = await db.query('SELECT id_comprobante, id_usuario_carga FROM COMPROBANTE_PAGO WHERE id_cliente = ?', [other.clientId]);
  assert.deepEqual(rows.map(row => [row.id_comprobante, row.id_usuario_carga]), [[results[0].data.id, other.auth.id]]);
});

test('el almacenamiento dentro del checkout se rechaza sin escribir archivos', async () => {
  const prior = await readdir(storage);
  process.env.RECEIPT_STORAGE_DIR = __dirname;
  try {
    const response = await body(await upload(orderPath(other), other.auth), 503);
    assert.equal(response.code, 'COMPROBANTES_NO_DISPONIBLES');
    assert.ok(!JSON.stringify(response).includes(__dirname));
  } finally { process.env.RECEIPT_STORAGE_DIR = storage; }
  assert.deepEqual(await readdir(storage), prior);
});

async function createCustomClient({
  type = 'EMPRESA',
  approval = type === 'EMPRESA' ? 'APROBADA' : null,
  clientActive = 1,
  userActive = 1,
  withAccount = false,
  accountEnabled = 1,
  orderModality = type === 'EMPRESA' ? 'TRANSFERENCIA' : 'TRANSFERENCIA',
} = {}) {
  const clientId = await insert(`
    INSERT INTO CLIENTE (tipo_cliente, nombre_razon_social, estado_aprobacion_empresa, es_fiel, activo)
    VALUES (?, ?, ?, 0, ?)
  `, [type, `Cliente ${type} ${approval ?? ''}`.trim(), approval, clientActive]);
  const userId = await insert(`
    INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo)
    VALUES (?, ?, 'test-only', 'CLIENTE', ?)
  `, [clientId, randomUUID() + '@example.test', userActive]);
  const account = withAccount ? await insert(`
    INSERT INTO CUENTA_CORRIENTE (id_cliente, limite_credito, habilitada, cobertura, moneda_limite)
    VALUES (?, 1000, ?, 'COMPLETA', 'USD')
  `, [clientId, accountEnabled]) : null;
  const order = orderModality ? await insert(`
    INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total)
    VALUES (?, 'CONFIRMADO', ?, 100, 0, 100)
  `, [clientId, orderModality]) : null;
  return { clientId, userId, account, order, auth: { id: userId, rol: 'CLIENTE' } };
}

test('#328 modalidades, separación TRANSFERENCIA vs CUENTA_CORRIENTE, anti-IDOR cruzado y permisos por rol', async () => {
  // 1. Empresa APROBADA sin cuenta corriente con pedido TRANSFERENCIA
  const approvedNoCc = await createCustomClient({
    type: 'EMPRESA', approval: 'APROBADA', withAccount: false, orderModality: 'TRANSFERENCIA',
  });
  // 2. Empresa APROBADA con cuenta corriente HABILITADA, con pedido TRANSFERENCIA y pedido CUENTA_CORRIENTE
  const approvedWithCc = await createCustomClient({
    type: 'EMPRESA', approval: 'APROBADA', withAccount: true, accountEnabled: 1, orderModality: 'TRANSFERENCIA',
  });
  const ccOrderId = await insert(`
    INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total)
    VALUES (?, 'CONFIRMADO', 'CUENTA_CORRIENTE', 200, 0, 200)
  `, [approvedWithCc.clientId]);
  // 3. Empresas PENDIENTE y RECHAZADA con pedido TRANSFERENCIA
  const pendingCompany = await createCustomClient({
    type: 'EMPRESA', approval: 'PENDIENTE', withAccount: false, orderModality: 'TRANSFERENCIA',
  });
  const rejectedCompany = await createCustomClient({
    type: 'EMPRESA', approval: 'RECHAZADA', withAccount: false, orderModality: 'TRANSFERENCIA',
  });
  // 4. Particular con pedido modalidad incompatible CUENTA_CORRIENTE
  const particularIncompatible = await createCustomClient({
    type: 'PARTICULAR', approval: null, withAccount: false, orderModality: 'CUENTA_CORRIENTE',
  });

  const before = await financialState();

  // Empresa aprobada sin CC opera TRANSFERENCIA en /api/pedidos/:id/comprobantes pero 404 en /api/cuenta-corriente/comprobantes
  const transferOnly = (await body(await upload(orderPath(approvedNoCc), approvedNoCc.auth, pdf, 'application/pdf'), 201)).data;
  assert.equal(transferOnly.pedidoId, approvedNoCc.order);
  assert.equal(transferOnly.cuentaCorrienteId, null);
  assert.equal(transferOnly.estadoRevision, 'PENDIENTE');
  assert.equal(transferOnly.clienteId, undefined);
  assert.equal(transferOnly.cliente, undefined);
  const transferOnlyList = (await body(await request(orderPath(approvedNoCc), approvedNoCc.auth), 200)).data.items;
  assert.deepEqual(transferOnlyList, [transferOnly]);
  const transferOnlyGet = await request(orderPath(approvedNoCc) + '/' + transferOnly.id, approvedNoCc.auth);
  assertDownloadHeaders(transferOnlyGet, 'application/pdf', pdf.length, 'pdf');
  assert.deepEqual(Buffer.from(await transferOnlyGet.arrayBuffer()), pdf);
  await body(await request(accountPath, approvedNoCc.auth), 404);
  await body(await upload(accountPath, approvedNoCc.auth), 404);

  // Empresa aprobada CON CC: pedido TRANSFERENCIA conserva cuentaCorrienteId = null y no se mezcla con CC
  const companyTransfer = (await body(await upload(orderPath(approvedWithCc), approvedWithCc.auth, png, 'image/png'), 201)).data;
  assert.equal(companyTransfer.pedidoId, approvedWithCc.order);
  assert.equal(companyTransfer.cuentaCorrienteId, null);
  const companyCcOrderPath = '/pedidos/' + ccOrderId + '/comprobantes';
  const companyCc = (await body(await upload(companyCcOrderPath, approvedWithCc.auth, jpg, 'image/jpeg'), 201)).data;
  assert.equal(companyCc.pedidoId, ccOrderId);
  assert.equal(companyCc.cuentaCorrienteId, approvedWithCc.account);

  // Listado de cuenta corriente incluye solo los de CC, nunca el de TRANSFERENCIA
  const ccListed = (await body(await request(accountPath, approvedWithCc.auth), 200)).data.items;
  assert.deepEqual(ccListed.map(row => row.id), [companyCc.id]);
  // Descarga de comprobante TRANSFERENCIA desde /api/cuenta-corriente/comprobantes/:id -> 404
  await body(await request(accountPath + '/' + companyTransfer.id, approvedWithCc.auth), 404);
  // Subida a /api/cuenta-corriente/comprobantes?pedidoId=<pedido TRANSFERENCIA propio> -> 404
  await body(await upload(accountPath + '?pedidoId=' + approvedWithCc.order, approvedWithCc.auth), 404);
  // Mismo cliente, pedidoId cruzado entre sus dos pedidos -> 404 en ambos sentidos
  await body(await request(companyCcOrderPath + '/' + companyTransfer.id, approvedWithCc.auth), 404);
  await body(await request(orderPath(approvedWithCc) + '/' + companyCc.id, approvedWithCc.auth), 404);
  // Descarga de comprobante CC desde /api/cuenta-corriente/comprobantes/:id + HEAD con todas las cabeceras
  const ccGet = await request(accountPath + '/' + companyCc.id, approvedWithCc.auth);
  assertDownloadHeaders(ccGet, 'image/jpeg', jpg.length, 'jpg');
  assert.deepEqual(Buffer.from(await ccGet.arrayBuffer()), jpg);
  const ccHead = await request(accountPath + '/' + companyCc.id, approvedWithCc.auth, { method: 'HEAD' });
  assertDownloadHeaders(ccHead, 'image/jpeg', jpg.length, 'jpg');
  assert.equal((await ccHead.arrayBuffer()).byteLength, 0);

  // Empresas no aprobadas (PENDIENTE / RECHAZADA) en TRANSFERENCIA -> 404
  for (const blocked of [pendingCompany, rejectedCompany]) {
    await body(await upload(orderPath(blocked), blocked.auth), 404);
    await body(await request(orderPath(blocked), blocked.auth), 404);
  }
  // Particular con pedido modalidad CUENTA_CORRIENTE -> 404
  await body(await upload(orderPath(particularIncompatible), particularIncompatible.auth), 404);
  await body(await request(orderPath(particularIncompatible), particularIncompatible.auth), 404);

  // Anti-IDOR cruzado: Empresa A vs Empresa B y Particular vs Empresa
  const missingCompanyOrder = await body(await request(companyCcOrderPath, company.auth), 404);
  assert.equal(missingCompanyOrder.code, 'OPERACION_NO_ENCONTRADA');
  await body(await upload(companyCcOrderPath, company.auth), 404);
  const missingCompanyReceipt = await body(await request(companyCcOrderPath + '/' + companyCc.id, company.auth), 404);
  assert.equal(missingCompanyReceipt.code, 'COMPROBANTE_NO_ENCONTRADO');
  await body(await request(accountPath + '/' + companyCc.id, company.auth), 404);
  await body(await upload(accountPath + '?pedidoId=' + ccOrderId, company.auth), 404);
  await body(await request(companyCcOrderPath, particular.auth), 404);
  await body(await upload(companyCcOrderPath, particular.auth), 404);
  await body(await request(companyCcOrderPath + '/' + companyCc.id, particular.auth), 404);

  // Autorización estricta por rol (403) en todas las rutas cruzadas
  await body(await request(adminPath + '/' + companyCc.id, approvedWithCc.auth), 403);
  await body(await request(companyCcOrderPath, admin), 403);
  await body(await request(companyCcOrderPath + '/' + companyCc.id, admin), 403);
  await body(await request(accountPath, admin), 403);
  await body(await upload(accountPath, admin), 403);
  await body(await request(accountPath + '/' + companyCc.id, admin), 403);

  // HEAD en descarga ADMIN
  const adminHead = await request(adminPath + '/' + companyTransfer.id, admin, { method: 'HEAD' });
  assertDownloadHeaders(adminHead, 'image/png', png.length, 'png');
  assert.equal((await adminHead.arrayBuffer()).byteLength, 0);

  assert.deepEqual(await financialState(), before);
});

test('#328 seguridad de sesión (401), cliente inactivo (404) y protección CSRF/Same-Origin (403)', async () => {
  const target = await createCustomClient({ type: 'PARTICULAR', approval: null, orderModality: 'TRANSFERENCIA' });
  const targetPath = orderPath(target);
  const created = (await body(await upload(targetPath, target.auth, png, 'image/png'), 201)).data;
  const reviewPath = adminPath + '/' + created.id + '/revision';
  const priorFiles = await readdir(storage);

  // 1. Sesiones inválidas / ausentes / expiradas / algoritmo inválido / sin exp / firma errónea -> 401
  const secret = process.env.JWT_SECRET;
  const invalidTokens = [
    undefined,
    'not-a-jwt',
    jwt.sign({ id: target.userId, rol: 'CLIENTE' }, secret, { expiresIn: -10 }),
    jwt.sign({ id: target.userId, rol: 'CLIENTE' }, secret),
    jwt.sign({ id: target.userId, rol: 'CLIENTE' }, secret, { algorithm: 'HS384', expiresIn: 120 }),
    jwt.sign({ id: target.userId, rol: 'CLIENTE' }, randomBytes(32), { expiresIn: 120 }),
  ];
  for (const token of invalidTokens) {
    const headers = token ? { Cookie: 'jwt_token=' + token } : {};
    await body(await fetchFromBrowser(base + targetPath, { headers }), 401);
    await body(await fetchFromBrowser(base + targetPath + '/' + created.id, { headers }), 401);
    await body(await fetchFromBrowser(base + targetPath, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/pdf' }, body: pdf,
    }), 401);
    await body(await fetchFromBrowser(base + reviewPath, { method: 'PATCH', headers }), 401);
  }

  // 2. Usuario inactivo y rol alterado en BD -> 401
  const deactivatedUser = await createCustomClient({ type: 'PARTICULAR', approval: null, userActive: 0, orderModality: 'TRANSFERENCIA' });
  await body(await request(orderPath(deactivatedUser), deactivatedUser.auth), 401);
  await body(await upload(orderPath(deactivatedUser), deactivatedUser.auth), 401);

  const roleChanged = await createCustomClient({ type: 'PARTICULAR', approval: null, orderModality: 'TRANSFERENCIA' });
  const oldClientToken = signToken(roleChanged.auth);
  await db.query("UPDATE USUARIO SET rol = 'ADMIN', id_cliente = NULL WHERE id_usuario = ?", [roleChanged.userId]);
  await body(await fetchFromBrowser(base + orderPath(roleChanged), {
    headers: { Cookie: 'jwt_token=' + oldClientToken },
  }), 401);
  await body(await fetchFromBrowser(base + adminPath, {
    headers: { Cookie: 'jwt_token=' + oldClientToken },
  }), 401);

  // 3. Cliente inactivo (USUARIO activo, CLIENTE inactivo) -> 404 sin filtrar ni escribir archivos
  const inactiveClient = await createCustomClient({ type: 'PARTICULAR', approval: null, clientActive: 0, orderModality: 'TRANSFERENCIA' });
  await body(await request(orderPath(inactiveClient), inactiveClient.auth), 404);
  await body(await upload(orderPath(inactiveClient), inactiveClient.auth), 404);

  // 4. CSRF / Same-Origin en mutaciones POST y PATCH (usando fetch nativo para controlar Origin/Referer/Sec-Fetch-Site)
  const validOrigin = process.env.APP_PUBLIC_ORIGIN;
  const csrfCases = [
    {},
    { Origin: 'https://attacker.example' },
    { Origin: 'null' },
    { Origin: validOrigin, 'Sec-Fetch-Site': 'cross-site' },
    { Origin: validOrigin, 'Sec-Fetch-Site': 'same-site' },
    { Referer: 'https://attacker.example/csrf' },
  ];
  for (const csrfHeaders of csrfCases) {
    const postOrderRes = await fetch(base + targetPath, {
      method: 'POST',
      headers: { Cookie: 'jwt_token=' + signToken(target.auth), 'Content-Type': 'application/pdf', ...csrfHeaders },
      body: pdf,
    });
    assert.equal(postOrderRes.status, 403);
    assert.equal(postOrderRes.headers.get('cache-control'), 'private, no-store');

    const postAccountRes = await fetch(base + accountPath, {
      method: 'POST',
      headers: { Cookie: 'jwt_token=' + signToken(company.auth), 'Content-Type': 'application/pdf', ...csrfHeaders },
      body: pdf,
    });
    assert.equal(postAccountRes.status, 403);
    assert.equal(postAccountRes.headers.get('cache-control'), 'private, no-store');

    const patchReviewRes = await fetch(base + reviewPath, {
      method: 'PATCH',
      headers: { Cookie: 'jwt_token=' + signToken(admin), ...csrfHeaders },
    });
    assert.equal(patchReviewRes.status, 403);
    assert.equal(patchReviewRes.headers.get('cache-control'), 'private, no-store');
  }

  // Verificar que ninguna solicitud rechazada escribió archivos ni cambió estadoRevision
  assert.deepEqual(await readdir(storage), priorFiles);
  const current = (await body(await request(targetPath, target.auth), 200)).data.items;
  assert.equal(current.length, 1);
  assert.equal(current[0].estadoRevision, 'PENDIENTE');
});

test('#328/#290 revisión ADMIN: valida Idempotency-Key/body, 404 en inexistente, replay idempotente y bloqueo terminal', async () => {
  const ownerClient = await createCustomClient({ type: 'PARTICULAR', approval: null, orderModality: 'TRANSFERENCIA' });
  const saved = (await body(await upload(orderPath(ownerClient), ownerClient.auth, jpg, 'image/jpeg'), 201)).data;
  const rejectedTarget = (await body(await upload(orderPath(ownerClient), ownerClient.auth, png, 'image/png'), 201)).data;
  const reviewPath = adminPath + '/' + saved.id + '/revision';
  const rejectPath = adminPath + '/' + rejectedTarget.id + '/revision';
  const secondAdmin = {
    id: await insert(
      "INSERT INTO USUARIO (email, password_hash, rol, activo) VALUES (?, 'test-only', 'ADMIN', 1)",
      [randomUUID() + '@receipt-admin.test'],
    ),
    rol: 'ADMIN',
  };
  const before = await financialState();

  // Sin Idempotency-Key -> 400 CLAVE_IDEMPOTENCIA_REQUERIDA
  const missingKey = await body(await request(reviewPath, admin, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'APROBADO' }),
  }), 400);
  assert.equal(missingKey.code, 'CLAVE_IDEMPOTENCIA_REQUERIDA');

  // Body inválido o query extra -> 400 SOLICITUD_INVALIDA
  const withInvalidBody = await body(await request(reviewPath, admin, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ estadoRevision: 'REVISADO' }),
  }), 400);
  assert.equal(withInvalidBody.code, 'SOLICITUD_INVALIDA');

  const rejectWithoutReason = await body(await request(reviewPath, admin, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ estado: 'RECHAZADO' }),
  }), 400);
  assert.equal(rejectWithoutReason.code, 'SOLICITUD_INVALIDA');

  const withQuery = await body(await request(reviewPath + '?forzar=1', admin, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ estado: 'APROBADO' }),
  }), 400);
  assert.equal(withQuery.code, 'SOLICITUD_INVALIDA');

  // UUID inexistente -> 404
  const missing = await body(await request(adminPath + '/' + randomUUID() + '/revision', admin, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ estado: 'APROBADO' }),
  }), 404);
  assert.equal(missing.code, 'COMPROBANTE_NO_ENCONTRADO');

  // Primera aprobación por admin 1 con key K1, replay idempotente y bloqueo ante otra clave / otro payload
  const approveKey = randomUUID();
  const first = (await body(await request(reviewPath, admin, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': approveKey },
    body: JSON.stringify({ estado: 'APROBADO' }),
  }), 200)).data;
  assert.equal(first.estadoRevision, 'APROBADO');
  assert.equal(first.motivoRechazo, null);
  assert.ok(first.revisadoEn.endsWith('Z'));

  const replay = (await body(await request(reviewPath, admin, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': approveKey },
    body: JSON.stringify({ estado: 'APROBADO' }),
  }), 200)).data;
  assert.deepEqual(replay, first);

  const reusedKey = await body(await request(reviewPath, admin, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': approveKey },
    body: JSON.stringify({ estado: 'RECHAZADO', motivo: 'Cambio inválido' }),
  }), 409);
  assert.equal(reusedKey.code, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');

  const resolvedConflict = await body(await request(reviewPath, secondAdmin, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ estado: 'RECHAZADO', motivo: 'Intento tardío' }),
  }), 409);
  assert.equal(resolvedConflict.code, 'COMPROBANTE_YA_RESUELTO');

  // Rechazo documental con motivo obligatorio sobre segundo comprobante
  const rejected = (await body(await request(rejectPath, secondAdmin, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ estado: 'RECHAZADO', motivo: 'Comprobante ilegible' }),
  }), 200)).data;
  assert.equal(rejected.estadoRevision, 'RECHAZADO');
  assert.equal(rejected.motivoRechazo, 'Comprobante ilegible');

  const [row] = await db.query(
    'SELECT id_admin_revision, CAST(revision_utc AS CHAR) AS rev, estado_revision FROM COMPROBANTE_PAGO WHERE id_comprobante = ?',
    [saved.id],
  );
  assert.equal(Number(row.id_admin_revision), admin.id);
  assert.equal(row.estado_revision, 'APROBADO');
  assert.equal(new Date(row.rev.replace(' ', 'T') + 'Z').toISOString(), first.revisadoEn);
  assert.deepEqual(await financialState(), before);
});

test('#328 frontera 5 MiB, MIME estricto, PDF >100 págs, paginación (50/pág) y concurrencia (503 Retry-After: 1)', async () => {
  const client = await createCustomClient({ type: 'PARTICULAR', approval: null, orderModality: 'TRANSFERENCIA' });
  const path = orderPath(client);

  // 1. Frontera exacta 5 MiB (5.242.880 bytes) -> 201 y descarga íntegra
  const exact5MiB = await createExactSizePdf(5 * 1024 * 1024);
  const boundary = (await body(await upload(path, client.auth, exact5MiB, 'application/pdf'), 201)).data;
  assert.equal(boundary.bytes, 5 * 1024 * 1024);
  const boundaryDownload = await request(path + '/' + boundary.id, client.auth);
  assertDownloadHeaders(boundaryDownload, 'application/pdf', 5 * 1024 * 1024, 'pdf');
  assert.equal((await boundaryDownload.arrayBuffer()).byteLength, 5 * 1024 * 1024);

  // 2. Content-Type con parámetros -> 415; PDF >100 páginas y PDF con OpenAction/URI -> 422
  await body(await upload(path, client.auth, pdf, 'application/pdf; charset=utf-8'), 415);

  const manyPagesDoc = await PDFDocument.create();
  for (let i = 0; i < 101; i++) manyPagesDoc.addPage();
  await body(await upload(path, client.auth, Buffer.from(await manyPagesDoc.save()), 'application/pdf'), 422);

  const uriDoc = await PDFDocument.create();
  uriDoc.addPage();
  uriDoc.catalog.set(PDFName.of('OpenAction'), uriDoc.context.obj({
    S: PDFName.of('URI'),
    URI: 'https://example.test',
  }));
  await body(await upload(path, client.auth, Buffer.from(await uriDoc.save()), 'application/pdf'), 422);

  // 3. Queries inválidas -> 400
  await body(await upload(path + '?pedidoId=' + client.order, client.auth, pdf, 'application/pdf'), 400);
  await body(await upload(accountPath + '?extra=1', company.auth, pdf, 'application/pdf'), 400);
  await body(await request(path + '?pagina=0', client.auth), 400);
  await body(await request(path + '?pagina=abc', client.auth), 400);
  await body(await request(adminPath + '?pagina=0', admin), 400);

  // 4. Paginación determinista (pageSize = 50, orden fecha_utc DESC, id_comprobante DESC)
  const paginatedClient = await createCustomClient({ type: 'PARTICULAR', approval: null, orderModality: 'TRANSFERENCIA' });
  const seededIds = [];
  for (let i = 0; i < 52; i++) {
    const id = randomUUID();
    const sec = String(Math.floor(i / 2)).padStart(2, '0');
    const hash = createHash('sha256').update(`page-${i}-${id}`).digest();
    await db.query(`
      INSERT INTO COMPROBANTE_PAGO (
        id_comprobante, id_cliente, id_usuario_carga, id_pedido, id_cuenta_corriente,
        tipo_mime, bytes, sha256, fecha_utc
      ) VALUES (?, ?, ?, ?, NULL, 'application/pdf', 100, ?, ?)
    `, [id, paginatedClient.clientId, paginatedClient.userId, paginatedClient.order, hash, `2026-11-01 10:00:${sec}.000`]);
    seededIds.push({ id, ts: `2026-11-01T10:00:${sec}.000Z` });
  }
  seededIds.sort((a, b) => b.ts.localeCompare(a.ts) || b.id.localeCompare(a.id));

  const page1 = (await body(await request(orderPath(paginatedClient) + '?pagina=1', paginatedClient.auth), 200)).data;
  assert.equal(page1.items.length, 50);
  assert.equal(page1.paginaSiguiente, 2);
  const page2 = (await body(await request(orderPath(paginatedClient) + '?pagina=2', paginatedClient.auth), 200)).data;
  assert.equal(page2.items.length, 2);
  assert.equal(page2.paginaSiguiente, null);
  assert.deepEqual([...page1.items, ...page2.items].map(item => item.id), seededIds.map(item => item.id));

  // 5. Saturación de concurrencia (activeUploads >= 2 -> 503 con Retry-After: 1) y recuperación
  const c1 = await createCustomClient({ type: 'PARTICULAR', approval: null, orderModality: 'TRANSFERENCIA' });
  const c2 = await createCustomClient({ type: 'PARTICULAR', approval: null, orderModality: 'TRANSFERENCIA' });
  const openSlowUpload = (targetClient, bytes, mime) => {
    const url = new URL(base + orderPath(targetClient));
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        Origin: process.env.APP_PUBLIC_ORIGIN,
        Cookie: 'jwt_token=' + signToken(targetClient.auth),
        'Content-Type': mime,
        'Content-Length': String(bytes.length),
      },
    });
    const response = new Promise((resolve, reject) => {
      req.on('response', res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
    });
    req.write(bytes.subarray(0, 1));
    return {
      finish: () => { req.end(bytes.subarray(1)); return response; },
      abort: () => req.destroy(),
    };
  };

  const slot1 = openSlowUpload(c1, png, 'image/png');
  const slot2 = openSlowUpload(c2, jpg, 'image/jpeg');
  try {
    await new Promise(resolve => setTimeout(resolve, 250));
    const saturated = await upload(path, client.auth, png, 'image/png');
    assert.equal(saturated.headers.get('retry-after'), '1');
    const saturatedBody = await body(saturated, 503);
    assert.equal(saturatedBody.code, 'COMPROBANTES_NO_DISPONIBLES');
    const [res1, res2] = await Promise.all([slot1.finish(), slot2.finish()]);
    assert.equal(res1.status, 201);
    assert.equal(res2.status, 201);
  } catch (error) {
    slot1.abort();
    slot2.abort();
    throw error;
  }

  // Después de liberar los slots, las cargas vuelven a responder 201
  const recovered = (await body(await upload(path, client.auth, png, 'image/png'), 201)).data;
  assert.equal(recovered.tipoMime, 'image/png');
});
