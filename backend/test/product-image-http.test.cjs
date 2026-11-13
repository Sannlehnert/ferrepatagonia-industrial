const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { after, before, beforeEach, test } = require('node:test');
const sharp = require('sharp');
const { fetchFromBrowser } = require('./helpers/browser-request.cjs');
const { sessionRow } = require('./helpers/session-fixture.cjs');

Object.assign(process.env, {
  JWT_SECRET: process.env.JWT_SECRET || randomUUID() + randomUUID(),
  DB_HOST: '127.0.0.1',
  DB_PORT: '1',
  DB_NAME: 'unit',
  DB_USER: 'unit',
  DB_PASSWORD: 'unit',
});

const { app } = require('../dist/app');
const { dataSource, destroyDatabase } = require('../dist/config/database.config');
const { receiptWorkerRuntime } = require('../dist/services/receipts/receipt-storage');
const { signToken } = require('../dist/services/token.service');

let server;
let baseUrl;
let validDir;
let receiptDir;
let regularFile;
let existingName;
let validWebp;
let validPng;
let previousImageDir;
let previousReceiptDir;

function setStorageEnv(imageDir, receiptsDir) {
  if (imageDir === undefined) delete process.env.PRODUCT_IMAGE_STORAGE_DIR;
  else process.env.PRODUCT_IMAGE_STORAGE_DIR = imageDir;

  if (receiptsDir === undefined) delete process.env.RECEIPT_STORAGE_DIR;
  else process.env.RECEIPT_STORAGE_DIR = receiptsDir;
}

before(async () => {
  previousImageDir = process.env.PRODUCT_IMAGE_STORAGE_DIR;
  previousReceiptDir = process.env.RECEIPT_STORAGE_DIR;

  validDir = await mkdtemp(join(tmpdir(), 'ferre-img-http-'));
  receiptDir = await mkdtemp(join(tmpdir(), 'ferre-rcpt-http-'));
  regularFile = join(receiptDir, 'not-a-directory.txt');
  await writeFile(regularFile, 'plain-text');

  validWebp = await sharp({
    create: { width: 12, height: 12, channels: 3, background: '#126c9e' },
  }).webp().toBuffer();
  validPng = await sharp({
    create: { width: 8, height: 8, channels: 3, background: 'white' },
  }).png().toBuffer();

  existingName = `${randomUUID()}.webp`;
  await writeFile(join(validDir, existingName), validWebp);

  await dataSource.buildMetadatas();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

beforeEach(t => {
  t.mock.method(dataSource, 'createQueryRunner', () => ({
    isTransactionActive: false,
    connect: async () => ({ threadId: 1, stream: { destroy() {} } }),
    release: async () => {},
    query: async (_sql, params) => ({
      records: [sessionRow(params[0], 'CLIENTE', { tipo_cliente: 'PARTICULAR' })],
    }),
  }));
  t.mock.method(dataSource, 'query', async () => [{ clientId: 10, orderId: 1, accountId: null }]);
});

after(async () => {
  try {
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await destroyDatabase();
  } finally {
    setStorageEnv(previousImageDir, previousReceiptDir);
    await Promise.all([
      validDir ? rm(validDir, { recursive: true, force: true }) : Promise.resolve(),
      receiptDir ? rm(receiptDir, { recursive: true, force: true }) : Promise.resolve(),
    ]);
  }
});

test('GET y HEAD /api/product-images/:name responden 503 sanitizado cuando falta o falla el almacenamiento', async () => {
  const sampleName = `${randomUUID()}.webp`;
  const missingDir = join(tmpdir(), 'ferre-missing-images-' + randomUUID());
  const badConfigs = [
    ['omitida', undefined, undefined],
    ['vacía', '', undefined],
    ['ruta relativa', './uploads/fotos', undefined],
    ['directorio inexistente', missingDir, undefined],
    ['archivo en lugar de directorio', regularFile, undefined],
    ['solapada con RECEIPT_STORAGE_DIR', receiptDir, receiptDir],
  ];

  for (const [label, imgEnv, rcptEnv] of badConfigs) {
    setStorageEnv(imgEnv, rcptEnv);

    const getRes = await fetch(`${baseUrl}/product-images/${sampleName}`);
    assert.equal(getRes.status, 503, `GET debe devolver 503 con configuración ${label}`);
    assert.equal(getRes.headers.get('cache-control'), 'no-store');
    const body = await getRes.json();
    assert.deepEqual(body, {
      code: 'PRODUCT_IMAGE_REJECTED',
      message: 'El almacenamiento de fotos no está disponible.',
    });
    const serialized = JSON.stringify(body);
    if (imgEnv) assert.ok(!serialized.includes(imgEnv));

    const headRes = await fetch(`${baseUrl}/product-images/${sampleName}`, { method: 'HEAD' });
    assert.equal(headRes.status, 503, `HEAD debe devolver 503 con configuración ${label}`);
    assert.equal(headRes.headers.get('cache-control'), 'no-store');
    assert.equal((await headRes.arrayBuffer()).byteLength, 0);
  }
});

test('GET y HEAD /api/product-images/:name conservan 404 para nombres inválidos o inexistentes y 200 para fotos válidas', async () => {
  setStorageEnv(undefined, undefined);
  assert.equal((await fetch(`${baseUrl}/product-images/..%2Fsecret.webp`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/product-images/..%2Fsecret.webp`, { method: 'HEAD' })).status, 404);

  setStorageEnv(validDir, receiptDir);

  const missingName = `${randomUUID()}.webp`;
  const missingGet = await fetch(`${baseUrl}/product-images/${missingName}`);
  assert.equal(missingGet.status, 404);
  assert.deepEqual(await missingGet.json(), { error: 'Ruta no encontrada' });

  const missingHead = await fetch(`${baseUrl}/product-images/${missingName}`, { method: 'HEAD' });
  assert.equal(missingHead.status, 404);
  assert.equal((await missingHead.arrayBuffer()).byteLength, 0);

  const invalidGet = await fetch(`${baseUrl}/product-images/not-a-uuid.webp`);
  assert.equal(invalidGet.status, 404);
  const invalidHead = await fetch(`${baseUrl}/product-images/not-a-uuid.webp`, { method: 'HEAD' });
  assert.equal(invalidHead.status, 404);

  const okGet = await fetch(`${baseUrl}/product-images/${existingName}`);
  assert.equal(okGet.status, 200);
  assert.equal(okGet.headers.get('content-type'), 'image/webp');
  assert.equal(okGet.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await okGet.arrayBuffer()), validWebp);

  const okHead = await fetch(`${baseUrl}/product-images/${existingName}`, { method: 'HEAD' });
  assert.equal(okHead.status, 200);
  assert.equal(okHead.headers.get('content-type'), 'image/webp');
  assert.equal(Number(okHead.headers.get('content-length')), validWebp.length);
  assert.equal((await okHead.arrayBuffer()).byteLength, 0);
});

test('compilado: fallo operativo del worker de comprobantes devuelve 503 y nunca 422', async t => {
  setStorageEnv(validDir, receiptDir);
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(JSON.stringify(args)));
  t.mock.method(receiptWorkerRuntime, 'createWorker', () => {
    const emitter = new EventEmitter();
    emitter.terminate = async () => 1;
    queueMicrotask(() => {
      emitter.emit('error', Object.assign(new Error('Cannot load /secret/path/worker.js'), {
        code: 'ERR_MODULE_NOT_FOUND',
      }));
    });
    return emitter;
  });

  const response = await fetchFromBrowser(`${baseUrl}/pedidos/1/comprobantes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
      Cookie: 'jwt_token=' + signToken({ id: 1, rol: 'CLIENTE' }),
    },
    body: validPng,
  });

  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '1');
  const json = await response.json();
  assert.equal(json.code, 'COMPROBANTES_NO_DISPONIBLES');
  assert.ok(!JSON.stringify(json).includes('/secret/path/worker.js'));
  assert.ok(!logs.join('\n').includes('/secret/path/worker.js'));
});
