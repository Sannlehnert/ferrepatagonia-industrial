const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PriceVerificationError,
  normalizeExpectedPrice,
  parsePositiveId,
  validateEvidenceReference,
} = require('../dist/services/pricing/price-verification.rules.js');

const rejectsWith = (code, action) => assert.throws(action, error => {
  assert.ok(error instanceof PriceVerificationError);
  assert.equal(error.code, code);
  return true;
});

test('T-S7-05.2: normaliza importes exactos sin Number/parseFloat', () => {
  assert.equal(normalizeExpectedPrice('100'), '100.00');
  assert.equal(normalizeExpectedPrice('100.5'), '100.50');
  assert.equal(normalizeExpectedPrice('0'), '0.00');
  assert.equal(normalizeExpectedPrice('9999999999.99'), '9999999999.99');
});

test('T-S7-05.2: rechaza importes inválidos, negativos o no exactos', () => {
  for (const value of [100, null, undefined, '', '-1', '1,00', '01.00', '1.234', '1e3', '99999999999.99']) {
    rejectsWith('IMPORTE_INVALIDO', () => normalizeExpectedPrice(value));
  }
});

test('T-S7-05.2: acepta referencias comerciales con documento, origen o localizador', () => {
  const refs = [
    'Factura A-0001-00000123 del proveedor Andes SA',
    'Lista oficial BNA vendedor 2026-11-14, publicación bancaria',
    'Presupuesto PROV-8891 / vigencia 30 días',
  ];
  for (const reference of refs) assert.equal(validateEvidenceReference(`  ${reference}  `), reference);
});

test('T-S7-05.2: rechaza evidencia vacía, genérica o sintética', () => {
  for (const value of ['', '   ', 'corto', 'verificado', 'ok', 'test', '   ok   ', 'factura', 'n/a']) {
    rejectsWith('EVIDENCIA_INVALIDA', () => validateEvidenceReference(value));
  }
  for (const value of ['SINTETICO fixture 123', 'DEMO precio', 'mock document']) {
    rejectsWith('EVIDENCIA_SINTETICA', () => validateEvidenceReference(value));
  }
  rejectsWith('EVIDENCIA_INVALIDA', () => validateEvidenceReference('Factura\u0000 123'));
  rejectsWith('EVIDENCIA_INVALIDA', () => validateEvidenceReference('x'.repeat(1001)));
});

test('T-S7-05.2: valida identificadores positivos sin aceptar decimales ni signos', () => {
  assert.equal(parsePositiveId(1, 'producto'), 1);
  assert.equal(parsePositiveId('2147483647', 'producto'), 2147483647);
  for (const value of [0, -1, '1.5', '01', ' 1', 2147483648, Number.NaN]) {
    rejectsWith('SOLICITUD_INVALIDA', () => parsePositiveId(value, 'producto'));
  }
});
