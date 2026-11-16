const { test } = require('node:test');
const assert = require('node:assert/strict');
Object.assign(process.env, {
  JWT_SECRET: require('node:crypto').randomUUID(),
  DB_HOST: '127.0.0.1',
  DB_NAME: 'unit_credit_no_connection',
  DB_USER: 'test',
  DB_PASSWORD: 'test',
});

const {
  MAX_CREDIT_CENTS,
  parseCreditAmount,
  formatCreditAmount,
  normalizeIdempotencyKey,
  parseCreditRequestListQuery,
  parseCreditEventListQuery,
  createCreditRequestPolicy,
  approveCreditRequestPolicy,
  rejectCreditRequestPolicy,
  enableCreditAccountPolicy,
  disableCreditAccountPolicy,
  changeCreditLimitPolicy,
  creditRequestIdPolicy,
} = require('../dist/dtos/credit/credit-workflow.dto');
const { validateDtoInput } = require('../dist/dtos/validation');

test('T-S7-09.1 montos USD exactos con BigInt, sin notación numérica', () => {
  assert.equal(parseCreditAmount('0.01', false), 1n);
  assert.equal(parseCreditAmount('1', false), 100n);
  assert.equal(parseCreditAmount('1.2', false), 120n);
  assert.equal(parseCreditAmount('9999999999.99', false), MAX_CREDIT_CENTS);
  assert.equal(parseCreditAmount('0.00', true), 0n);
  assert.equal(parseCreditAmount('0.00', false), null);
  assert.equal(parseCreditAmount('0', true), 0n);
  for (const value of [0.01, 1, '-1.00', '1.234', '1e3', '01', ' 1.00', '1.00 ',
    '10000000000.00', '', null, undefined, {}, []]) {
    assert.equal(parseCreditAmount(value, true), null, String(value));
  }
  assert.equal(formatCreditAmount(1n), '0.01');
  assert.equal(formatCreditAmount(100n), '1.00');
  assert.equal(formatCreditAmount(MAX_CREDIT_CENTS), '9999999999.99');
});

test('T-S7-09.1 idempotencia UUID v4 normalizada', () => {
  const key = '123E4567-E89B-42D3-A456-426614174000';
  assert.equal(normalizeIdempotencyKey(key), key.toLowerCase());
  for (const value of [null, 1, '', 'no-uuid', '123e4567-e89b-12d3-a456-426614174000',
    '123e4567-e89b-42d3-c456-426614174000', '123e4567-e89b-42d3-a456-42661417400']) {
    assert.equal(normalizeIdempotencyKey(value), null, String(value));
  }
});

test('T-S7-09.1 DTO de solicitud rechaza tipos, campos y plazos inválidos', async () => {
  const valid = await validateDtoInput(createCreditRequestPolicy, {
    montoSolicitado: ' 1500.00 ',
    plazoDias: 30,
    observaciones: ' Compra de insumos ',
  });
  assert.equal(valid.valid, true);
  if (valid.valid) {
    assert.equal(valid.data.montoSolicitado, '1500.00');
    assert.equal(valid.data.plazoDias, 30);
    assert.equal(valid.data.observaciones, 'Compra de insumos');
  }
  for (const body of [
    { montoSolicitado: '1500.00', plazoDias: 45 },
    { montoSolicitado: 1500, plazoDias: 30 },
    { montoSolicitado: '1500.001', plazoDias: 30 },
    { montoSolicitado: '1500.00', plazoDias: 30, clienteId: 1 },
    { montoSolicitado: '1500.00', plazoDias: 30, estado: 'APROBADA' },
    { montoSolicitado: '0.00', plazoDias: 30 },
    { montoSolicitado: '1500.00' },
  ]) {
    const result = await validateDtoInput(createCreditRequestPolicy, body);
    assert.equal(result.valid, false, JSON.stringify(body));
  }
});

test('T-S7-09.1 DTO administrativos exigen evidencia y motivo', async () => {
  const cases = [
    [approveCreditRequestPolicy, { limiteAutorizado: '1000.00', plazoDias: 30, evidencia: 'ACTA-1', motivo: 'Aprobación comercial' }, true],
    [approveCreditRequestPolicy, { limiteAutorizado: '-1.00', plazoDias: 30, evidencia: 'ACTA-1', motivo: 'Aprobación' }, false],
    [approveCreditRequestPolicy, { limiteAutorizado: '1000.00', plazoDias: 30, evidencia: ' ', motivo: 'Aprobación' }, false],
    [approveCreditRequestPolicy, { limiteAutorizado: '1000.00', plazoDias: 30, evidencia: 'ACTA-1', motivo: 'Aprobación', actorId: 1 }, false],
    [rejectCreditRequestPolicy, { motivo: 'Antecedentes comerciales' }, true],
    [rejectCreditRequestPolicy, {}, false],
    [enableCreditAccountPolicy, { evidencia: 'ACTA-2' }, true],
    [enableCreditAccountPolicy, {}, false],
    [disableCreditAccountPolicy, { motivo: 'Revisión comercial' }, true],
    [disableCreditAccountPolicy, {}, false],
    [changeCreditLimitPolicy, { limite: '0.00', evidencia: 'ACTA-3', motivo: 'Reducción' }, true],
    [changeCreditLimitPolicy, { limite: '1.234', evidencia: 'ACTA-3', motivo: 'Reducción' }, false],
    [changeCreditLimitPolicy, { limite: '1000.00', evidencia: 'ACTA-3' }, false],
  ];
  for (const [policy, body, expected] of cases) {
    const result = await validateDtoInput(policy, body);
    assert.equal(result.valid, expected, JSON.stringify(body));
  }
});

test('T-S7-09.1 IDs de ruta no confían en strings arbitrarios', async () => {
  const valid = await validateDtoInput(creditRequestIdPolicy, { id: '12' });
  assert.equal(valid.valid, true);
  if (valid.valid) assert.equal(valid.data.id, 12);
  for (const id of ['0', '01', '1.0', '-1', '2147483648', '1e2', null]) {
    const result = await validateDtoInput(creditRequestIdPolicy, { id });
    assert.equal(result.valid, false, String(id));
  }
});

test('T-S7-09.1 consultas rechazan filtros desconocidos y repetidos', () => {
  assert.deepEqual(parseCreditRequestListQuery('/solicitudes?limite=10&antesDeId=30', false),
    { limite: 10, antesDeId: 30 });
  assert.deepEqual(parseCreditRequestListQuery('/solicitudes?estado=aprobada&clienteId=7', true),
    { limite: 25, estado: 'APROBADA', clienteId: 7 });
  for (const url of ['/solicitudes?clienteId=1', '/solicitudes?limite=0', '/solicitudes?limite=101',
    '/solicitudes?limite=2&limite=2', '/solicitudes?antesDeId=0', '/solicitudes?estado=OTRO',
    '/solicitudes?cursor=x']) {
    assert.throws(() => parseCreditRequestListQuery(url, false), error => error.status === 400);
  }
  assert.throws(() => parseCreditRequestListQuery('/solicitudes?estado=PENDIENTE', false),
    error => error.status === 400);
  assert.deepEqual(parseCreditEventListQuery('/eventos?tipo=LIMITE_MODIFICADO&solicitudId=4'),
    { limite: 50, tipo: 'LIMITE_MODIFICADO', solicitudId: 4 });
  assert.throws(() => parseCreditEventListQuery('/eventos?tipo=lower'), error => error.status === 400);
});
