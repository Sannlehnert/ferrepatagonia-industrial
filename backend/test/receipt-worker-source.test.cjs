const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { once } = require('node:events');
const { existsSync } = require('node:fs');
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve, sep } = require('node:path');
const { after, before, beforeEach, test } = require('node:test');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');
const { fetchFromBrowser } = require('./helpers/browser-request.cjs');
const { sessionRow } = require('./helpers/session-fixture.cjs');

Object.assign(process.env, {
  JWT_SECRET: process.env.JWT_SECRET || 'source-receipt-worker-secret-0123456789abcdef',
  DB_HOST: '127.0.0.1',
  DB_PORT: '1',
  DB_NAME: 'unit',
  DB_USER: 'unit',
  DB_PASSWORD: 'unit',
});

const { app } = require('../src/app.ts');
const { dataSource, destroyDatabase } = require('../src/config/database.config.ts');
const { signToken } = require('../src/services/token.service.ts');
const {
  ReceiptError,
} = require('../src/services/receipts/receipt-types.ts');
const {
  receiptWorkerRuntime,
  validateReceiptContent,
} = require('../src/services/receipts/receipt-storage.ts');

let server;
let base;
let receiptDir;
let previousReceiptDir;
let pdf;
let png;
let jpg;
const persisted = new Map();

function createMockRunner() {
  return {
    isTransactionActive: false,
    connect: async () => ({ threadId: 1, stream: { destroy() {} } }),
    startTransaction: async function () { this.isTransactionActive = true; },
    commitTransaction: async function () { this.isTransactionActive = false; },
    rollbackTransaction: async function () { this.isTransactionActive = false; },
    release: async () => {},
    query: async (sql, params) => {
      if (/FROM\s+`?USUARIO`?/i.test(sql)) {
        return { records: [sessionRow(params[0], 'CLIENTE', { tipo_cliente: 'PARTICULAR' })] };
      }
      throw new Error('Unexpected runner SQL in source test: ' + sql);
    },
    manager: {
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO COMPROBANTE_PAGO')) {
          const [id, , mime, bytes] = params;
          persisted.set(id, {
            id,
            clienteId: 10,
            cliente: 'Cliente Prueba',
            pedidoId: 1,
            cuentaCorrienteId: null,
            tipoMime: mime,
            bytes,
            fecha: '2026-11-13 12:00:00.000',
            revisadoEn: null,
          });
          return { affectedRows: 1 };
        }
        throw new Error('Unexpected transaction SQL in source test: ' + sql);
      },
    },
  };
}

before(async () => {
  const srcReceiptsDir = resolve(__dirname, '../src/services/receipts');
  const backendDistPrefix = `${resolve(__dirname, '../dist')}${sep}`.toLowerCase();
  assert.equal(existsSync(join(srcReceiptsDir, 'receipt-file.worker.js')), false);
  assert.equal(existsSync(join(srcReceiptsDir, 'receipt-file.worker.ts')), true);
  assert.equal(
    Object.keys(require.cache).some(file => file.toLowerCase().startsWith(backendDistPrefix)),
    false,
    'La suite de fuentes no debe depender ni cargar artefactos de dist/',
  );

  previousReceiptDir = process.env.RECEIPT_STORAGE_DIR;
  receiptDir = await mkdtemp(join(tmpdir(), 'ferre-receipt-source-'));
  process.env.RECEIPT_STORAGE_DIR = receiptDir;

  await dataSource.buildMetadatas();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;

  const doc = await PDFDocument.create();
  doc.addPage().drawText('Comprobante de transferencia');
  pdf = Buffer.from(await doc.save());
  const pixels = { create: { width: 10, height: 10, channels: 3, background: 'white' } };
  png = await sharp(pixels).png().toBuffer();
  jpg = await sharp(pixels).jpeg({ progressive: true }).toBuffer();
});

beforeEach(t => {
  persisted.clear();
  t.mock.method(dataSource, 'createQueryRunner', () => createMockRunner());
  t.mock.method(dataSource, 'query', async (sql, params) => {
    if (sql.includes('SELECT c.id_cliente AS clientId')) {
      return [{ clientId: 10, orderId: 1, accountId: null }];
    }
    if (sql.includes('FROM COMPROBANTE_PAGO r')) {
      const id = params.at(-1);
      const row = persisted.get(id);
      return row ? [row] : [];
    }
    throw new Error('Unexpected dataSource.query in source test: ' + sql);
  });
});

after(async () => {
  try {
    if (server) {
      server.closeAllConnections();
      await new Promise(resolveServer => server.close(resolveServer));
    }
    await destroyDatabase();
  } finally {
    if (previousReceiptDir === undefined) delete process.env.RECEIPT_STORAGE_DIR;
    else process.env.RECEIPT_STORAGE_DIR = previousReceiptDir;
    if (receiptDir) await rm(receiptDir, { recursive: true, force: true });
  }
});

function uploadOrderReceipt(bytes, mime) {
  return fetchFromBrowser(`${base}/pedidos/1/comprobantes`, {
    method: 'POST',
    headers: {
      'Content-Type': mime,
      Cookie: 'jwt_token=' + signToken({ id: 1, rol: 'CLIENTE' }),
    },
    body: bytes,
  });
}

test('tsx source: resolveWorker selecciona worker .ts con entorno aislado y .js en compilado', () => {
  const tsConfig = receiptWorkerRuntime.resolveWorker();
  assert.match(tsConfig.file, /services[\\/]+receipts[\\/]+receipt-file\.worker\.ts$/);
  assert.equal(tsConfig.execArgv[0], '--require');
  assert.ok(tsConfig.execArgv[1]);
  assert.equal(tsConfig.env.TSX_DISABLE_CACHE, '1');
  assert.equal(tsConfig.env.JWT_SECRET, undefined);
  assert.equal(tsConfig.env.DB_PASSWORD, undefined);

  const jsConfig = receiptWorkerRuntime.resolveWorker(
    resolve(__dirname, '../dist/services/receipts/receipt-storage.js'),
  );
  assert.match(jsConfig.file, /services[\\/]+receipts[\\/]+receipt-file\.worker\.js$/);
  assert.deepEqual(jsConfig.execArgv, []);
  assert.deepEqual(jsConfig.env, {});
});

test('tsx source: acepta PNG, JPG y PDF válidos por ruta HTTP sin depender de dist', async () => {
  for (const [bytes, mime] of [
    [png, 'image/png'],
    [jpg, 'image/jpeg'],
    [pdf, 'application/pdf'],
  ]) {
    const response = await uploadOrderReceipt(bytes, mime);
    assert.equal(response.status, 201, `${mime} debe aceptarse en modo fuente tsx`);
    const body = await response.json();
    assert.equal(body.data.tipoMime, mime);
    assert.equal(body.data.bytes, bytes.length);
    assert.deepEqual(await readFile(join(receiptDir, body.data.id)), bytes);
  }
  assert.equal(existsSync(resolve(__dirname, '../undefined')), false);
});

test('tsx source: rechaza archivos realmente inválidos con 422 y vacíos con 400', async () => {
  const activePdf = await PDFDocument.create();
  activePdf.addPage();
  activePdf.addJavaScript('malicious', 'app.alert(1)');
  const activeBytes = Buffer.from(await activePdf.save());

  const beforeFiles = await readdir(receiptDir);

  const empty = await uploadOrderReceipt(Buffer.alloc(0), 'application/pdf');
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).code, 'ARCHIVO_VACIO');

  for (const [bytes, mime] of [
    [png.subarray(0, 16), 'image/png'],
    [png, 'image/jpeg'],
    [jpg.subarray(0, -2), 'image/jpeg'],
    [activeBytes, 'application/pdf'],
    [Buffer.from('%PDF-1.7\nCorrupto\n%%EOF'), 'application/pdf'],
  ]) {
    const response = await uploadOrderReceipt(bytes, mime);
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, 'CONTENIDO_INVALIDO');
  }

  assert.deepEqual(await readdir(receiptDir), beforeFiles);
});

test('tsx source: distingue fallos operativos del worker como 503 sin filtrar rutas ni contenido', async t => {
  const secretPath = join('C:', 'secreto-interno', 'ruta-privada', 'missing.worker.js');
  const markerPayload = Buffer.concat([png, Buffer.from('SECRETO_DEL_ARCHIVO_USUARIO')]);
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(JSON.stringify(args)));

  await t.test('error síncrono al crear el worker -> 503', async () => {
    t.mock.method(receiptWorkerRuntime, 'createWorker', () => {
      throw Object.assign(new Error(`Cannot find module '${secretPath}'`), {
        code: 'ERR_MODULE_NOT_FOUND',
      });
    });

    await assert.rejects(
      validateReceiptContent(png, 'image/png', new AbortController().signal),
      error => error instanceof ReceiptError && error.status === 503 && error.code === 'COMPROBANTES_NO_DISPONIBLES',
    );

    const response = await uploadOrderReceipt(markerPayload, 'image/png');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '1');
    const json = await response.json();
    assert.equal(json.code, 'COMPROBANTES_NO_DISPONIBLES');
    assert.ok(!JSON.stringify(json).includes(secretPath));
    assert.ok(!JSON.stringify(json).includes('SECRETO_DEL_ARCHIVO_USUARIO'));
  });

  await t.test('evento error del worker al iniciar -> 503', async () => {
    t.mock.method(receiptWorkerRuntime, 'createWorker', () => {
      const emitter = new EventEmitter();
      emitter.terminate = async () => 1;
      queueMicrotask(() => {
        emitter.emit('error', Object.assign(new Error(`Loader failure in ${secretPath}`), {
          code: 'ERR_WORKER_INIT_FAILED',
        }));
      });
      return emitter;
    });

    const response = await uploadOrderReceipt(png, 'image/png');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '1');
    assert.equal((await response.json()).code, 'COMPROBANTES_NO_DISPONIBLES');
  });

  await t.test('cierre prematuro del worker sin emitir veredicto -> 503', async () => {
    t.mock.method(receiptWorkerRuntime, 'createWorker', () => {
      const emitter = new EventEmitter();
      emitter.terminate = async () => 1;
      queueMicrotask(() => emitter.emit('exit', 1));
      return emitter;
    });

    const response = await uploadOrderReceipt(pdf, 'application/pdf');
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'COMPROBANTES_NO_DISPONIBLES');
  });

  const combinedLogs = logs.join('\n');
  assert.match(combinedLogs, /receipt\.worker\.failed/);
  assert.ok(!combinedLogs.includes(secretPath));
  assert.ok(!combinedLogs.includes('secreto-interno'));
  assert.ok(!combinedLogs.includes('SECRETO_DEL_ARCHIVO_USUARIO'));
});
