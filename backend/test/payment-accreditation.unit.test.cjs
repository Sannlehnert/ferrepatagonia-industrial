const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  accreditPaymentPolicy,
  declarePaymentPolicy,
  formatPaymentAmount,
  normalizePaymentIdempotencyKey,
  normalizeReceiptId,
  parsePaymentAmount,
  parsePaymentListQuery,
  paymentIdPolicy,
  reviewPaymentPolicy,
} = require('../dist/dtos/payments/payment.dto');
const { validateDtoInput } = require('../dist/dtos/validation');

test('#333 importes decimales exactos y límites DECIMAL(12,2)', () => {
  assert.equal(parsePaymentAmount('0.01'), 1n);
  assert.equal(parsePaymentAmount('1'), 100n);
  assert.equal(parsePaymentAmount('1.2'), 120n);
  assert.equal(parsePaymentAmount('9999999999.99'), 999999999999n);
  for (const invalid of ['0.00', '-0.01', '1.001', '10000000000.00', '1e2', '0x10', '', 1, 1.2, null]) {
    assert.equal(parsePaymentAmount(invalid), null, String(invalid));
  }
  assert.equal(formatPaymentAmount(1n), '0.01');
  assert.equal(formatPaymentAmount(999999999999n), '9999999999.99');
  assert.equal(formatPaymentAmount(-120n), '-1.20');
});

test('#333 idempotencia y comprobante usan UUID v4 canónico', () => {
  const key = '123e4567-e89b-42d3-a456-426614174000';
  assert.equal(normalizePaymentIdempotencyKey(`  ${key.toUpperCase()}  `), key);
  assert.equal(normalizePaymentIdempotencyKey('123e4567-e89b-12d3-a456-426614174000'), null);
  assert.equal(normalizePaymentIdempotencyKey('no-es-uuid'), null);
  assert.equal(normalizeReceiptId(key), key);
  assert.equal(normalizeReceiptId('123e4567-e89b-12d3-a456-426614174000'), null);
});

test('#333 DTO de declaración rechaza campos ajenos, importes inválidos y monedas no contables', async () => {
  const key = '123e4567-e89b-42d3-a456-426614174000';
  const valid = await validateDtoInput(declarePaymentPolicy, {
    monto: '40.00', moneda: 'USD', comprobanteId: key, observaciones: 'Pago parcial',
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.data.monto, '40.00');

  for (const body of [
    { monto: '0.00', moneda: 'USD', comprobanteId: key },
    { monto: '1e2', moneda: 'USD', comprobanteId: key },
    { monto: '1.00', moneda: 'EUR', comprobanteId: key },
    { monto: '1.00', moneda: 'USD', comprobanteId: 'x' },
    { monto: '1.00', moneda: 'USD', comprobanteId: key, clienteId: 1 },
    { monto: 1, moneda: 'USD', comprobanteId: key },
  ]) {
    const result = await validateDtoInput(declarePaymentPolicy, body);
    assert.equal(result.valid, false, JSON.stringify(body));
  }
});

test('#333 DTO de revisión y acreditación exigen decisión y evidencia', async () => {
  const approved = await validateDtoInput(reviewPaymentPolicy, { decision: 'aprobado' });
  assert.equal(approved.valid, true);
  assert.equal(approved.data.decision, 'APROBADO');
  const rejected = await validateDtoInput(reviewPaymentPolicy, { decision: 'RECHAZADO', motivo: 'Ilegible' });
  assert.equal(rejected.valid, true);
  const alias = await validateDtoInput(reviewPaymentPolicy, { decision: 'VALIDADO' });
  assert.equal(alias.valid, true);
  assert.equal(alias.data.decision, 'APROBADO');
  for (const body of [
    { decision: 'OTRO' },
    { decision: 'APROBADO', motivo: 12 },
    { decision: 'APROBADO', extra: true },
  ]) assert.equal((await validateDtoInput(reviewPaymentPolicy, body)).valid, false, JSON.stringify(body));

  assert.equal((await validateDtoInput(accreditPaymentPolicy, { evidencia: 'Extracto BNA' })).valid, true);
  for (const body of [{}, { evidencia: '' }, { evidencia: 'x', monto: '1.00' }]) {
    assert.equal((await validateDtoInput(accreditPaymentPolicy, body)).valid, false, JSON.stringify(body));
  }
});

test('#333 parámetros de pago y paginación son estrictos', async () => {
  assert.equal((await validateDtoInput(paymentIdPolicy, { id: '1' })).valid, true);
  for (const id of ['0', '1.5', '-1', 'abc', 0]) {
    assert.equal((await validateDtoInput(paymentIdPolicy, { id })).valid, false, String(id));
  }
  assert.deepEqual(parsePaymentListQuery('/pagos?pagina=2'), { pagina: 2 });
  assert.deepEqual(parsePaymentListQuery('/pagos'), { pagina: 1 });
  for (const url of ['/pagos?pagina=0', '/pagos?pagina=abc', '/pagos?otro=1', '/pagos?pagina=1&pagina=2', '/pagos?']) {
    assert.throws(() => parsePaymentListQuery(url), /CONSULTA_INVALIDA/, url);
  }
});
