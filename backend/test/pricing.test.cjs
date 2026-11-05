const assert = require('node:assert/strict');
const { test } = require('node:test');
const { calculateLine } = require('../dist/services/pricing/pricing.engine');
const { PricingService, parsePriceRequest } = require('../dist/services/pricing/pricing.service');
const { resolveQuote } = require('../dist/services/pricing/pricing.quote');
const { decimal, MONEY_MAX } = require('../dist/services/pricing/money');

const now = new Date('2026-11-03T14:00:00Z');
const calendar = { version: 'fixture-v1', verifiedBy: 'admin-fixture', evidence: 'fixture-calendar',
  verifiedAt: '2026-11-01T14:00:00Z', days: { '2026-11-02': true } };
const quote = { id: 'quote-fixture', rate: '1234.5678', referenceDate: '2026-11-02',
  loadedAt: '2026-11-03T10:00:00Z', actor: 'admin-fixture', valid: true,
  verifiedAt: '2026-11-03T11:00:00Z', evidence: 'fixture-bank-publication' };
const product = { id: 7, baseUSD: '100.00', specialPercent: null };
const client = { usuarioId: 11, clienteId: 99, active: true, assignedListId: 3,
  list: { id: 3, active: true, percent: '10.00' } };
const request = { moneda: 'USD', productos: [{ productoId: 7, cantidad: 1 }] };
const auth = { id: 11, rol: 'CLIENTE' };
function fixture(overrides = {}) {
  const calls = [], events = [];
  const source = { async load(...args) { calls.push(args); return { client, products: [product], calendar, quote, ...overrides }; },
    async recordInactiveList(event) { events.push(event); } };
  return { service: new PricingService(source, () => now), source, calls, events };
}
function line(base, list = '0', special = null, quantity = 1, rate = null) {
  return calculateLine({ ...product, baseUSD: base, specialPercent: special },
    { productoId: 7, cantidad: quantity }, list, rate);
}
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code);

for (const [label, base, list, special, quantity, unit, subtotal, origin] of [
  ['sin descuentos / IVA incluido', '100', '0', null, 1, '100.00', '100.00', 'NINGUNO'],
  ['lista mayor', '100', '10', '5', 2, '90.00', '180.00', 'LISTA'],
  ['especial mayor', '100', '10', '15', 3, '85.00', '255.00', 'ESPECIAL_PUBLICO'],
  ['empate', '100', '10', '10', 1, '90.00', '90.00', 'AMBOS'],
  ['decimales exactos', '19.99', '5', null, 3, '18.99', '56.97', 'LISTA'],
  ['HALF_UP antes de multiplicar', '2.01', '50', null, 2, '1.01', '2.02', 'LISTA'],
  ['máximo monetario', '9999999999.99', '0', null, 1, '9999999999.99', '9999999999.99', 'NINGUNO'],
  ['máxima cantidad', '0.01', '0', null, 2147483647, '0.01', '21474836.47', 'NINGUNO'],
]) test(label, () => {
  const result = line(base, list, special, quantity);
  assert.equal(result.precioUnitarioUSD, unit);
  assert.equal(result.subtotalUSD, subtotal);
  assert.equal(result.origenDescuento, origin);
  assert.equal(result.precioComprable, true);
});
for (const [base, list, state] of [[null, '0', 'PRECIO_AUSENTE'], ['0', '0', 'BASE_CERO'], ['0.01', '99.99', 'FINAL_CERO']]) {
  test(`estado ${state}`, () => {
    const result = line(base, list);
    assert.equal(result.estadoPrecio, state);
    assert.equal(result.precioComprable, false);
    assert.equal(result.precioBaseUSD, base === null ? null : base === '0' ? '0.00' : base);
  });
}
test('conversión y ocho decimales sin redondeo previo', () => {
  assert.equal(line('19.99', '5', null, 3, '1234.5678').subtotalARS, '70333.33');
  assert.equal(line('1000000000', '0', null, 1, '1.00000001').subtotalARS, '1000000010.00');
  assert.equal(line('0.01', '0', null, 1, '1.5').subtotalARS, '0.02');
  assert.equal(line('0.01', '0', null, 1, '0.00000001').estadoPrecio, 'ARS_CERO');
});
for (const invalid of ['-1', 'NaN', 'Infinity', '1e2', '1.001', '10000000000', '', ' 1', '01', 1, undefined]) {
  test(`base inválida ${String(invalid)}`, () => assert.throws(() => line(invalid)));
}
for (const invalid of ['100', '99.999', '-0.01', '1000', 10]) {
  test(`porcentaje inválido ${invalid}`, () => {
    assert.throws(() => line('100', invalid));
    assert.throws(() => line('100', '0', invalid));
  });
}
for (const invalid of ['0', '-1', '1.000000001', '1000000000000', 'NaN', 1]) {
  test(`tasa inválida ${invalid}`, () => assert.throws(() => line('1', '0', null, 1, invalid)));
}
for (const quantity of [0, -1, 1.5, 2147483648, '1', Infinity]) {
  test(`cantidad inválida ${quantity}`, () => assert.throws(() => line('1', '0', null, quantity)));
}
test('overflow de subtotal y conversión', () => {
  assert.throws(() => line('9999999999.99', '0', null, 2), { code: 'IMPORTE_FUERA_DE_RANGO' });
  assert.throws(() => line('9999999999.99', '0', null, 1, '2'), { code: 'IMPORTE_FUERA_DE_RANGO' });
});
test('resultado reproducible y serializable', () => {
  const expected = line('0.1', '10.01', '2.33', 3, '1234.56789012');
  for (let i = 0; i < 100; i++) assert.deepEqual(line('0.1', '10.01', '2.33', 3, '1234.56789012'), expected);
  assert.equal(JSON.parse(JSON.stringify(expected)).subtotalUSD, '0.27');
});
test('identidad de usuario distinta de cliente; lista propia', async () => {
  const f = fixture();
  const result = await f.service.resolve(request, 'CLIENTE', auth);
  assert.equal(f.calls[0][0], 11);
  assert.equal(result.totalUSD, '90.00');
  assert.equal(result.ivaIncluido, true);
  assert.equal(result.cotizacion, null);
  assert.ok(!JSON.stringify(result).includes('clienteId'));
});
test('dos clientes reciben precios propios', async () => {
  const a = await fixture().service.resolve(request, 'CLIENTE', auth);
  const b = await fixture({ client: { ...client, usuarioId: 12, clienteId: 88,
    list: { ...client.list, percent: '15' } } }).service.resolve(request, 'CLIENTE', { id: 12, rol: 'CLIENTE' });
  assert.equal(a.totalUSD, '90.00'); assert.equal(b.totalUSD, '85.00');
});
test('sin lista / inactiva preservan promoción pública y auditan inactividad', async () => {
  for (const inactive of [false, true]) {
    const f = fixture({ client: { ...client, assignedListId: inactive ? 3 : null,
      list: inactive ? { ...client.list, active: false } : null }, products: [{ ...product, specialPercent: '5' }] });
    const result = await f.service.resolve(request, 'CLIENTE', auth);
    assert.equal(result.totalUSD, '95.00');
    assert.equal(result.productos[0].origenDescuento, 'ESPECIAL_PUBLICO');
    assert.equal(f.events.length, inactive ? 1 : 0);
  }
});
test('canal público ignora sesión y lista privada', async () => {
  const f = fixture({ products: [{ ...product, specialPercent: '5' }] });
  const result = await f.service.resolve(request, 'PUBLICO', auth);
  assert.equal(f.calls[0][0], null);
  assert.equal(result.totalUSD, '95.00');
});
test('sesión ausente o rol inválido no consulta fuente', async () => {
  const f = fixture();
  await rejectsCode(f.service.resolve(request, 'CLIENTE'), 'NO_AUTENTICADO');
  await rejectsCode(f.service.resolve(request, 'CLIENTE', { id: 11, rol: 'ADMIN' }), 'NO_AUTORIZADO');
  assert.equal(f.calls.length, 0);
});
for (const invalidClient of [null, { ...client, active: false }, { ...client, usuarioId: 99 }]) {
  test('rechaza identidad comercial ausente/inactiva/ajena', async () => {
    await rejectsCode(fixture({ client: invalidClient }).service.resolve(request, 'CLIENTE', auth), 'NO_AUTORIZADO');
  });
}
test('asignación colgante no se convierte en descuento cero', async () => {
  await rejectsCode(fixture({ client: { ...client, list: null } }).service.resolve(request, 'CLIENTE', auth), 'DATOS_COMERCIALES_INVALIDOS');
});
for (const field of ['clienteId', 'listaId', 'precio', 'descuento']) {
  test(`rechaza inyección ${field}`, async () => {
    const f = fixture();
    await rejectsCode(f.service.resolve({ ...request, [field]: 9 }, 'CLIENTE', auth), 'SOLICITUD_INVALIDA');
    assert.throws(() => parsePriceRequest({ ...request, productos: [{ ...request.productos[0], [field]: 9 }] }));
    assert.equal(f.calls.length, 0);
  });
}
test('rechaza request nulo, vacío, duplicados y exceso de líneas', () => {
  for (const body of [null, [], {}, { ...request, moneda: 'EUR' }, { ...request, productos: [] },
    { ...request, productos: [request.productos[0], request.productos[0]] },
    { ...request, productos: Array(101).fill(request.productos[0]) }]) assert.throws(() => parsePriceRequest(body));
});
test('producto inexistente', async () => {
  await rejectsCode(fixture({ products: [] }).service.resolve(request, 'PUBLICO'), 'PRODUCTO_INEXISTENTE');
});
test('sin precio no hay total parcial; USD no requiere cotización', async () => {
  const result = await fixture({ products: [{ ...product, baseUSD: null }], quote: null, calendar: null })
    .service.resolve(request, 'PUBLICO');
  assert.equal(result.totalUSD, null); assert.equal(result.productos[0].estadoPrecio, 'PRECIO_AUSENTE');
});
test('total ARS suma líneas redondeadas, no convierte total USD', async () => {
  const f = fixture({ products: [{ ...product, baseUSD: '0.01' }, { ...product, id: 8, baseUSD: '0.01' }], quote: { ...quote, rate: '1.50' } });
  const result = await f.service.resolve({ moneda: 'ARS', productos: [{ productoId: 7, cantidad: 1 }, { productoId: 8, cantidad: 1 }] }, 'PUBLICO');
  assert.equal(result.totalUSD, '0.02'); assert.equal(result.totalARS, '0.04');
  assert.equal(result.cotizacion.valor, '1.50000000');
});
test('overflow de suma de líneas', async () => {
  await rejectsCode(fixture({ products: [{ ...product, baseUSD: '9999999999.99' }, { ...product, id: 8 }] }).service.resolve({
    ...request, productos: [{ productoId: 7, cantidad: 1 }, { productoId: 8, cantidad: 1 }] }, 'PUBLICO'), 'IMPORTE_FUERA_DE_RANGO');
});
test('ARS cero bloquea total ARS pero conserva USD', async () => {
  const result = await fixture({ quote: { ...quote, rate: '0.00000001' } }).service.resolve({ ...request, moneda: 'ARS' }, 'PUBLICO');
  assert.equal(result.totalUSD, '100.00'); assert.equal(result.totalARS, null);
});
test('cotización ausente y metadatos malformados no se presumen verificados', () => {
  assert.throws(() => resolveQuote(calendar, null, now), { code: 'COTIZACION_AUSENTE' });
  for (const changes of [{ valid: '0' }, { actor: ' ' }, { id: 42 }, { verifiedAt: '2026-02-30T12:00:00Z' }]) {
    assert.throws(() => resolveQuote(calendar, { ...quote, ...changes }, now), { code: 'COTIZACION_INVALIDA' });
  }
});
for (const changes of [{ valid: false }, { rate: '0' }, { rate: '1.000000001' }, { referenceDate: '2026-10-30' },
  { evidence: '' }, { actor: '' }, { verifiedAt: '2026-11-04T00:00:00Z' }, { verifiedAt: '2026-11-03T09:00:00Z' }]) {
  test(`cotización no verificada/vieja/inválida ${JSON.stringify(changes)}`, () => {
    assert.throws(() => resolveQuote(calendar, { ...quote, ...changes }, now), { code: 'COTIZACION_INVALIDA' });
  });
}
test('calendario desconocido o incompleto bloquea', () => {
  for (const c of [null, { ...calendar, days: {} }, { ...calendar, evidence: '' }]) assert.throws(() => resolveQuote(c, quote, now));
});
test('lunes feriado, fin de semana y frontera de fecha Buenos Aires', () => {
  const days = { '2026-11-02': false, '2026-11-01': false, '2026-10-31': false, '2026-10-30': true };
  const q = { ...quote, referenceDate: '2026-10-30', loadedAt: '2026-11-01T12:00:00Z', verifiedAt: '2026-11-01T13:00:00Z' };
  assert.equal(resolveQuote({ ...calendar, days }, q, now).fechaReferencia, '2026-10-30');
  // UTC Tuesday 01:00 is still Monday in Argentina: skips Monday entirely.
  assert.equal(resolveQuote({ ...calendar, days }, q, new Date('2026-11-03T01:00:00Z')).fechaReferencia, '2026-10-30');
  assert.throws(() => resolveQuote({ ...calendar, days: { ...days, '2026-11-01': true } }, q, now));
});
test('no redondea entradas fuera de escala aunque terminen en cero', () => {
  assert.throws(() => decimal('1.000', 2, MONEY_MAX));
});

for (const [loadedAt, accepted] of [
  ['2026-10-01T12:00:00Z', false],
  ['2026-11-02T02:59:59Z', false], // Still Nov 1 in Buenos Aires.
  ['2026-11-02T00:00:00-03:00', true],
  ['2026-11-03T01:00:00+02:00', true],
]) test(`H01 cronología civil de carga: ${loadedAt}`, () => {
  const run = () => resolveQuote(calendar, { ...quote, loadedAt }, now);
  if (accepted) assert.equal(run().fechaReferencia, '2026-11-02');
  else assert.throws(run, { code: 'COTIZACION_INVALIDA' });
});
