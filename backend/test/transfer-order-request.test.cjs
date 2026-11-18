const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  validateTransferConfirmationKey,
  validateTransferConfirmationBody,
} = require('../dist/dtos/orders/transfer-order.dto.js');
const {
  pendingTransferOrder,
  presentStoredTransferOrder,
} = require('../dist/services/orders/transfer-order.recovery.js');

const key = '25b21876-c722-45ef-9479-991f88729f71';

test('T-S7-06.1 DTO: valida y normaliza clave UUID v4 para checkout por transferencia', async () => {
  for (const value of [key, key.toUpperCase()]) {
    const result = await validateTransferConfirmationKey(value);
    assert.equal(result.valid, true);
    assert.equal(result.key, key);
  }

  for (const invalid of [
    undefined,
    null,
    '',
    ' ',
    `${key} `,
    ` ${key}`,
    [key],
    { clave: key },
    123,
    '00000000-0000-0000-0000-000000000000',
    '25b21876-c722-15ef-9479-991f88729f71',
  ]) {
    const result = await validateTransferConfirmationKey(invalid);
    assert.equal(result.valid, false);
    assert.equal(result.code, 'CLAVE_IDEMPOTENCIA_INVALIDA');
  }
});

test('T-S7-06.1 DTO: acepta únicamente { cotizacion } y rechaza campos extra o montos', () => {
  assert.equal(validateTransferConfirmationBody({ cotizacion: 'a'.repeat(40) }).valid, true);

  for (const invalid of [
    undefined,
    null,
    [],
    '',
    true,
    {},
    { cotizacion: 'short' },
    { clienteId: 1 },
    { rol: 'ADMIN' },
    { totalUSD: '0.01' },
    { modalidadPago: 'TRANSFERENCIA' },
    { cotizacion: 'a'.repeat(40), modalidadPago: 'TRANSFERENCIA' },
    { cotizacion: 'a'.repeat(40), clienteId: 1 },
    { cotizacion: 'a'.repeat(40), totalUSD: '20.00' },
    JSON.parse('{"__proto__":{"clienteId":1}}'),
  ]) {
    const result = validateTransferConfirmationBody(invalid);
    assert.equal(result.valid, false);
    assert.equal(result.code, 'SOLICITUD_INVALIDA');
  }
});

test('T-S7-06.1 Recovery: presenta intentos PENDIENTE, CONFIRMADO y RECHAZADO y rechaza corruptos', () => {
  assert.deepEqual(pendingTransferOrder().status, 202);
  assert.deepEqual(
    presentStoredTransferOrder({
      clientId: 1,
      key,
      state: 'PENDIENTE',
      orderId: null,
      httpStatus: null,
      responseJson: null,
    }).status,
    202,
  );

  const confirmedPayload = {
    data: {
      pedidoId: 42,
      estado: 'CONFIRMADO',
      modalidadPago: 'TRANSFERENCIA',
      moneda: 'USD',
      totalUSD: '150.00',
    },
  };
  const confirmed = presentStoredTransferOrder({
    clientId: 1,
    key,
    state: 'CONFIRMADO',
    orderId: 42,
    httpStatus: 201,
    responseJson: JSON.stringify(confirmedPayload),
  });
  assert.equal(confirmed.status, 200);
  assert.deepEqual(confirmed.body, confirmedPayload);

  const rejected = presentStoredTransferOrder({
    clientId: 1,
    key,
    state: 'RECHAZADO',
    orderId: null,
    httpStatus: 409,
    responseJson: JSON.stringify({
      code: 'STOCK_INSUFICIENTE',
      message: 'El stock disponible no alcanza para confirmar el pedido.',
    }),
  });
  assert.equal(rejected.status, 409);
  assert.deepEqual(rejected.body, {
    estado: 'RECHAZADO',
    code: 'STOCK_INSUFICIENTE',
    message: 'El stock disponible no alcanza para confirmar el pedido.',
  });

  // Rechaza payload con modalidad CUENTA_CORRIENTE o cargoId infiltrado
  assert.throws(
    () =>
      presentStoredTransferOrder({
        clientId: 1,
        key,
        state: 'CONFIRMADO',
        orderId: 42,
        httpStatus: 201,
        responseJson: JSON.stringify({
          data: {
            ...confirmedPayload.data,
            cargoId: '99',
          },
        }),
      }),
    error => error.code === 'RESULTADO_NO_DISPONIBLE' && error.status === 503,
  );
});
