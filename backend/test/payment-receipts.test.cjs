const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { readFile, readdir, rename } = require('node:fs/promises');
const { join } = require('node:path');
const { after, before, test } = require('node:test');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');
const { childProfile, connectOwned } = require('./helpers/cc260-disposable.cjs');
const { fetchFromBrowser } = require('./helpers/browser-request.cjs');

let session, database, db, server, base, signToken;
let particular, other, company, admin, pdf, png, jpg;
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
  return response.json();
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
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('content-disposition'), /^attachment; filename="comprobante-[a-f0-9-]+\.pdf"$/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
  const head = await request(path + '/' + saved.id, particular.auth, { method: 'HEAD' });
  assert.equal(Number(head.headers.get('content-length')), pdf.length);
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
  const first = (await body(await request(reviewPath, admin, { method: 'PATCH' }), 200)).data;
  const repeated = (await body(await request(reviewPath, admin, { method: 'PATCH' }), 200)).data;
  assert.equal(first.estadoRevision, 'REVISADO');
  assert.ok(first.revisadoEn.endsWith('Z'));
  assert.deepEqual(first, repeated);
  assert.equal((await db.query('SELECT id_admin_revision FROM COMPROBANTE_PAGO WHERE id_comprobante = ?', [saved.id]))[0].id_admin_revision, admin.id);
  assert.equal((await body(await request(path, particular.auth), 200)).data.items[0].estadoRevision, 'REVISADO');
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
