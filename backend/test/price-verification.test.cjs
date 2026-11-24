const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
  PriceVerificationError,
  normalizeExpectedPrice,
  parsePositiveId,
  validateEvidenceReference,
} = require('../dist/services/pricing/price-verification.rules.js');
const { verifyProductPricePolicy } = require('../dist/dtos/products/verify-price.dto.js');
const { validateDtoInput } = require('../dist/dtos/validation.js');

const rejectsWith = (code, action) => assert.throws(action, error => {
  assert.ok(error instanceof PriceVerificationError);
  assert.equal(error.code, code);
  return true;
});

test('T-S7-05.2: normaliza importes exactos sin Number/parseFloat', () => {
  assert.equal(normalizeExpectedPrice('100'), '100.00');
  assert.equal(normalizeExpectedPrice('100.5'), '100.50');
  assert.equal(normalizeExpectedPrice('0.01'), '0.01');
  assert.equal(normalizeExpectedPrice('9999999999.99'), '9999999999.99');
});

test('T-S7-05.2: rechaza importes inválidos, negativos o no exactos', () => {
  for (const value of [100, null, undefined, '', '-1', '1,00', '01.00', '1.234', '1e3', '99999999999.99', '0', '0.0', '0.00']) {
    rejectsWith('IMPORTE_INVALIDO', () => normalizeExpectedPrice(value));
  }
});

test('T-S7-05.2: acepta referencias comerciales con documento, origen o localizador', () => {
  const refs = [
    'Factura A-0001-00000123 del proveedor Andes SA',
    'Lista oficial BNA vendedor 2026-11-14, publicación bancaria',
    'Presupuesto PROV-8891 / vigencia 30 días',
    'Factura Sur 001-123, telas técnicas industriales, folio 5',
    'Certificado de ensayo TEST 44, laboratorio oficial y folio 512',
  ];
  for (const reference of refs) assert.equal(validateEvidenceReference(`  ${reference}  `), reference);
});

test('T-S7-05.2: rechaza evidencia vacía, genérica o sintética', () => {
  for (const value of ['', '   ', 'corto', 'verificado', 'ok', 'test', '   ok   ', 'factura', 'n/a',
    'sin evidencia', 'SIN DATO', '  sin   datos  ', 'Sin_revisar!', 'sín evidencia']) {
    rejectsWith('EVIDENCIA_INVALIDA', () => validateEvidenceReference(value));
  }
  for (const value of ['SINTETICO fixture 123', 'DEMO precio', 'mock document',
    'Datos sinteticos 123', 'Pruebas sintéticas 123', 'Precios ficticios', 'Órdenes ficticias',
    'Documento test_only 42', 'DOCUMENTO TEST-ONLY 42', 'Referencia ＴＥＳＴ＿ＯＮＬＹ 42']) {
    rejectsWith('EVIDENCIA_SINTETICA', () => validateEvidenceReference(value));
  }
  rejectsWith('EVIDENCIA_INVALIDA', () => validateEvidenceReference('Factura\u0000 123'));
  rejectsWith('EVIDENCIA_INVALIDA', () => validateEvidenceReference('x'.repeat(1001)));
});

test('T-S7-05.2: valida identificadores positivos sin aceptar decimales ni signos', () => {
  assert.equal(parsePositiveId(1, 'producto'), 1);
  assert.equal(parsePositiveId('2147483647', 'producto'), 2147483647);
  for (const value of [0, -1, '1.5', '01', ' 1', '1 ', '1\n', '1e2', '2147483648', 2147483648, Number.NaN]) {
    rejectsWith('SOLICITUD_INVALIDA', () => parsePositiveId(value, 'producto'));
  }
});

test('CLI: ayuda y rechazos estructurados sin NODE_ENV ni configuración de MariaDB', () => {
  const backend = path.resolve(__dirname, '..');
  const env = { ...process.env, DOTENV_CONFIG_DEBUG: 'true',
    DOTENV_CONFIG_PATH: path.join(__dirname, 'helpers/nonexistent.env') };
  for (const key of ['NODE_ENV', 'NODE_OPTIONS', 'DB_HOST', 'DB_NAME', 'DB_PORT', 'DB_USER', 'DB_PASSWORD']) delete env[key];
  const cli = (...args) => {
    const result = spawnSync(process.execPath, ['scripts/verify-product-price.cjs', '--json', ...args],
      { cwd: backend, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.error, undefined);
    assert.equal(result.stderr, '');
    return { status: result.status, body: JSON.parse(result.stdout) };
  };
  const help = cli('--ayuda');
  assert.equal(help.status, 0);
  assert.match(help.body.ayuda, /--confirmar-destino/);
  const baseArgs = (product = '1', admin = '2', amount = '9.95', ref = 'Factura Andes A-124, folio 8') =>
    ['--producto', product, '--admin', admin, '--importe', amount, '--evidencia', ref];
  const verify = (...values) => [...baseArgs(...values), '--confirmar'];
  const cases = [
    ['CONFIRMACION_REQUERIDA', baseArgs()],
    ['DESTINO_NO_CONFIRMADO', verify()],
    ['ERROR_INTERNO', [...verify(), '--confirmar-destino', '127.0.0.1:3307/base']],
    ['IMPORTE_INVALIDO', verify('1', '2', '0.00')],
    ['SOLICITUD_INVALIDA', [...verify(), '--producto', '2']],
    ['SOLICITUD_INVALIDA', ['--historial', '--producto', '1', '--limite', '201']],
    ['SOLICITUD_INVALIDA', ['--historial', '--producto', '1', '--limite', '1e2']],
    ['SOLICITUD_INVALIDA', ['--historial', '--producto', '01']],
  ];
  for (const value of ['01', '1e2', ' 1', '1 ', '1\n', '-1', '1.5', '2147483648']) {
    cases.push(['SOLICITUD_INVALIDA', verify(value)], ['SOLICITUD_INVALIDA', verify('1', value)]);
  }
  for (const value of ['sin evidencia', 'sin dato', 'sin datos', 'sin revisar']) {
    cases.push(['EVIDENCIA_INVALIDA', verify('1', '2', '9.95', value)]);
  }
  for (const value of ['Datos sinteticos', 'Órdenes sintéticas', 'Datos ficticios', 'Órdenes ficticias', 'Factura test_only']) {
    cases.push(['EVIDENCIA_SINTETICA', verify('1', '2', '9.95', value)]);
  }
  for (const [code, args] of cases) {
    const { status, body } = cli(...args);
    assert.equal(status, 1, JSON.stringify(args));
    assert.deepEqual(body, { ok: false, code, message: body.message, eventId: null });
    assert.ok(body.message.length > 0);
  }
});


test('HTTP ADMIN: DTO de verificación exige importe, evidencia y confirmación', async () => {
  const valid = await validateDtoInput(verifyProductPricePolicy, {
    importe: ' 150.00 ',
    evidencia: ' Factura comercial Andes A-0001, folio 42 ',
    confirmar: true,
  });
  assert.equal(valid.valid, true, JSON.stringify(valid));
  if (valid.valid) {
    assert.equal(valid.data.importe, '150.00');
    assert.equal(valid.data.evidencia, 'Factura comercial Andes A-0001, folio 42');
    assert.equal(valid.data.confirmar, true);
  }
  for (const body of [
    { importe: 150, evidencia: 'Factura comercial Andes A-0001', confirmar: true },
    { importe: '0.00', evidencia: 'Factura comercial Andes A-0001', confirmar: true },
    { importe: '150.00', evidencia: 'ok', confirmar: true },
    { importe: '150.00', evidencia: 'SINTETICO fixture 42', confirmar: true },
    { importe: '150.00', evidencia: 'Factura comercial Andes A-0001', confirmar: false },
    { importe: '150.00', evidencia: 'Factura comercial Andes A-0001' },
    { importe: '150.00', evidencia: 'Factura comercial Andes A-0001', confirmar: true, adminId: 1 },
  ]) {
    const result = await validateDtoInput(verifyProductPricePolicy, body);
    assert.equal(result.valid, false, JSON.stringify(body));
  }
});
