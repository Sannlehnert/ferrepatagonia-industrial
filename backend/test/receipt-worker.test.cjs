const assert = require('node:assert/strict');
const { readFile, rename } = require('node:fs/promises');
const { join } = require('node:path');
const { test } = require('node:test');

const mode = process.env.RECEIPT_WORKER_MODE;
assert.ok(mode === 'development' || mode === 'production',
  'RECEIPT_WORKER_MODE debe ser development o production');

const services = mode === 'development'
  ? join(__dirname, '../src/services/receipts')
  : join(__dirname, '../dist/services/receipts');
const { validateReceiptContent } = require(services + '/receipt-storage');
const workerFile = services + (mode === 'development'
  ? '/receipt-file.worker.ts'
  : '/receipt-file.worker.js');

const fixture = name => readFile(join(__dirname, 'fixtures/receipts', name));
const signal = () => AbortSignal.timeout(15000);

function rejection(status, code) {
  return error => {
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    assert.equal(typeof error.message, 'string');
    return true;
  };
}

test(`${mode}: valida PDF, JPG y PNG reales con el worker resuelto`, async () => {
  const pdf = await fixture('comprobante-transferencia.pdf');
  const png = await fixture('comprobante-transferencia.png');
  const jpg = await fixture('comprobante-transferencia.jpg');

  await validateReceiptContent(pdf, 'application/pdf', signal());
  await validateReceiptContent(png, 'image/png', signal());
  await validateReceiptContent(jpg, 'image/jpeg', signal());

  await assert.rejects(
    validateReceiptContent(pdf.subarray(0, -14), 'application/pdf', signal()),
    rejection(422, 'ARCHIVO_DANADO'),
  );
  await assert.rejects(
    validateReceiptContent(png, 'application/pdf', signal()),
    rejection(422, 'TIPO_INCOMPATIBLE'),
  );
});

test(`${mode}: un worker ausente es una falla de infraestructura, no un archivo dañado`, async () => {
  const disabled = workerFile + '.disabled';
  await rename(workerFile, disabled);
  try {
    await assert.rejects(
      validateReceiptContent(await fixture('comprobante-transferencia.pdf'), 'application/pdf', signal()),
      rejection(503, 'COMPROBANTES_NO_DISPONIBLES'),
    );
  } finally {
    await rename(disabled, workerFile);
  }
});
