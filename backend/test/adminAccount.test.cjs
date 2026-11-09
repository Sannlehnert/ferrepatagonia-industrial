const { test } = require('node:test');
const assert = require('node:assert/strict');
Object.assign(process.env, { JWT_SECRET: require('node:crypto').randomUUID(), DB_HOST: '127.0.0.1',
  DB_NAME: 'unit_account_no_connection', DB_USER: 'test', DB_PASSWORD: 'test' });
const { parseAdminAccountQuery: parse } = require('../dist/dtos/adminAccount.query');
const invalid = error => error.status === 400 && error.code === 'CONSULTA_INVALIDA';

test('#258 filtros exactos, combinables y límite predeterminado', () => {
  assert.deepEqual(parse('/?clienteId=2147483647&habilitada=false', 'listado'),
    { scope: 'listado', limite: 25, clienteId: 2147483647, habilitada: false });
  assert.equal(parse('/?habilitada=true&limite=100', 'listado').habilitada, true);
  assert.equal(parse('/?limite=1', 'movimientos', '7').clienteId, 7);
});
for (const query of ['limite=0', 'limite=101', 'limite=-1', 'limite=1.5', 'limite=1e1', 'limite=01',
  'limite=', 'limite=25&limite=25', 'limite[]=2', 'cursor=a&cursor=b', 'cursor=', 'cursor=alterado',
  'clienteId=0', 'clienteId=2147483648', 'clienteId=1.1', 'clienteId=01', 'clienteId=-1', 'clienteId=1&clienteId=2',
  'habilitada=1', 'habilitada=True', 'habilitada=false&habilitada=true', 'rol=ADMIN', 'cuentaId=1', '__proto__=x', 'limite=2?clienteId=1']) {
  test(`#258 rechaza query ${query}`, () => assert.throws(() => parse('/?' + query, 'listado'), invalid));
}
for (const scope of ['resumen', 'movimientos', 'vencimientos']) {
  test(`#258 ${scope} no acepta filtros del listado ni ID inválido`, () => {
    assert.throws(() => parse('/?clienteId=1', scope, '1'), invalid);
    assert.throws(() => parse('/', scope, '2147483648'), invalid);
    assert.throws(() => parse('/', scope, '1e1'), invalid);
  });
}
test('#258 resumen rechaza paginación', () => assert.throws(() => parse('/?limite=25', 'resumen', '1'), invalid));
test('#258 distingue fallos transitorios de errores de esquema e integridad', () => {
  const { isAccountSourceUnavailable } = require('../dist/services/adminAccount.errors');
  assert.equal(isAccountSourceUnavailable({ driverError: { code: 'ER_STATEMENT_TIMEOUT' } }), true);
  assert.equal(isAccountSourceUnavailable({ driverError: { errno: 1969 } }), true);
  assert.equal(isAccountSourceUnavailable({ code: 'ECONNREFUSED' }), true);
  assert.equal(isAccountSourceUnavailable({ driverError: { code: 'ER_NO_SUCH_TABLE' } }), false);
  assert.equal(isAccountSourceUnavailable(new Error('Integridad de imputaciones inválida.')), false);
});
