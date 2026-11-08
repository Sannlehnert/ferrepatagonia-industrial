const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  validateConfirmationKey,
  validateConfirmationBody,
} = require('../dist/dtos/orders/account-order.dto.js');

const key = '25b21876-c722-45ef-9479-991f88729f71';

test('#261: conserva la identidad de una clave UUID v4', async () => {
  for (const value of [key, key.toUpperCase()]) {
    const result = await validateConfirmationKey(value);

    assert.equal(result.valid, true);
    assert.equal(result.key, key);
  }
});

test('#261: rechaza claves ausentes, ambiguas o malformadas', async () => {
  const invalid = [
    undefined,
    null,
    '',
    ' ',
    `${key} `,
    ` ${key}`,
    `${key}, ${key}`,
    [key],
    { clave: key },
    123,
    '00000000-0000-0000-0000-000000000000',
    '25b21876-c722-15ef-9479-991f88729f71',
  ];

  for (const value of invalid) {
    const result = await validateConfirmationKey(value);

    assert.equal(result.valid, false);
    assert.equal(result.code, 'CLAVE_IDEMPOTENCIA_INVALIDA');
    assert.equal('key' in result, false);
  }
});

test('#261: acepta solamente un cuerpo vacío', () => {
  assert.equal(validateConfirmationBody({}).valid, true);

  const invalid = [
    undefined,
    null,
    [],
    '',
    true,
    { clienteId: 1 },
    { carritoId: 1 },
    { totalUSD: '0.01' },
    { precio: '0.01' },
    { idempotencyKey: key },
    JSON.parse('{"__proto__":{"clienteId":1}}'),
  ];

  for (const value of invalid) {
    const result = validateConfirmationBody(value);

    assert.equal(result.valid, false);
    assert.equal(result.code, 'SOLICITUD_INVALIDA');
  }
});