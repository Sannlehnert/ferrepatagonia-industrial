const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
function load(file, dependencies = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)(name => dependencies[name] ?? require(name), mod, mod.exports)
  return mod.exports
}
const dto = load('services/adminAccountDto')
const ctx = { corte: '2026-11-07T20:00:00.000Z', revision: 'fixture-revision' }
const summary = { estado: 'HABILITADA', cuentaId: 1, clienteId: 2, moneda: 'USD', origen: 'DEMO', plazoDias: 30,
  saldo: '-150.00', limite: '100.00', utilizado: '0.00', disponible: '100.00', cobertura: 'COMPLETA', estadoCredito: 'DISPONIBLE',
  deudaVencidaTotal: '0.00', deudaVencida30Dias: '0.00', deudaVencida60Dias: '0.00', deudaPorVencerTotal: '0.00' }
const response = data => ({ data: { ...ctx, ...data } })
test('DTO preserva saldo a favor, nulos, DEMO y cero acreditado', () => {
  assert.equal(dto.decodeAccountQuery(response(summary)).saldo, '-150.00')
  assert.equal(dto.decodeAccountQuery(response({ ...summary, cobertura: 'NO_ACREDITADA', saldo: null })).saldo, null)
  assert.equal(dto.decodeAccountList(response({ items: [summary], siguienteCursor: null })).items[0].origen, 'DEMO')
  assert.equal(dto.decodeAccountQuery(response({ estado: 'SIN_CUENTA' })).estado, 'SIN_CUENTA')
  assert.equal(dto.accountMoney('0.00'), 'USD 0,00')
  assert.equal(dto.accountMoney(null), 'No acreditado')
  assert.equal(dto.accountMoney('-10000000000000000.25'), 'USD -10.000.000.000.000.000,25')
})
for (const changes of [{ saldo: 0 }, { saldo: '-0.00' }, { saldo: '1e2' }, { limite: '1.1' }, { moneda: 'ARS' },
  { cobertura: 'COMPLETA', saldo: null }, { plazoDias: 45 }, { origen: 'PEDIDO' }, { deudaVencidaTotal: undefined }]) {
  test(`rechaza DTO no contractual ${JSON.stringify(changes)}`, () => assert.throws(() => dto.decodeAccountQuery(response({ ...summary, ...changes }))))
}
test('detalles distinguen vacío completo e incompleto y validan fecha/moneda/pendiente', () => {
  const empty = { estado: 'INHABILITADA', cobertura: 'NO_ACREDITADA', items: [], siguienteCursor: null }
  assert.equal(dto.decodeAccountDetail(response(empty), 'movimientos').cobertura, 'NO_ACREDITADA')
  const due = { movimientoId: '1', venceEl: '2026-11-07', plazoDias: 60, moneda: 'USD', pendiente: null, estado: 'NO_DETERMINABLE', origen: 'DEMO' }
  assert.equal(dto.decodeAccountDetail(response({ ...empty, items: [due] }), 'vencimientos').items[0].pendiente, null)
  for (const changes of [{ estado: 'VENCIDO' }, { venceEl: '2026-02-30' }, { moneda: 'ARS' }])
    assert.throws(() => dto.decodeAccountDetail(response({ ...empty, items: [{ ...due, ...changes }] }), 'vencimientos'))
  assert.throws(() => dto.decodeAccountDetail(response({ ...empty, items: [{}] }), 'movimientos'))
})
test('servicio usa exclusivamente las cuatro rutas GET, filtros y AbortSignal', async () => {
  const calls = [], controller = new AbortController()
  const api = { get: async (url, options) => { calls.push({ url, options }); return { data: { data: 'raw' } } } }
  const service = load('services/adminAccountService', {
    './api': { __esModule: true, default: api },
    './adminAccountDto': { decodeAccountList: v => v, decodeAccountQuery: v => v, decodeAccountDetail: v => v },
  })
  await service.getAdminAccounts({ clienteId: 2, habilitada: false, cursor: 'next' }, controller.signal)
  await service.getAdminAccount(2, controller.signal)
  await service.getAdminAccountDetail(2, 'movimientos', 'm', controller.signal)
  await service.getAdminAccountDetail(2, 'vencimientos', 'v', controller.signal)
  assert.deepEqual(calls.map(c => c.url), ['/admin/cuentas-corrientes', '/admin/clientes/2/cuenta-corriente',
    '/admin/clientes/2/cuenta-corriente/movimientos', '/admin/clientes/2/cuenta-corriente/vencimientos'])
  assert.deepEqual(calls[0].options.params, { clienteId: 2, habilitada: false, cursor: 'next' })
  assert.ok(calls.every(c => c.options.signal === controller.signal))
  api.get = async () => { throw Error('HTTP 503') }
  await assert.rejects(service.getAdminAccounts({}), /HTTP 503/)
})
test('lecturas privadas: loading, error, reintento, cancelación y sesión anterior', async () => {
  let dispose, session = 'admin-1', allowed = true, resolve, signal
  const vue = require('vue')
  const { usePrivateAccountRead } = load('composables/usePrivateAccountRead', { vue: { ...vue, onBeforeUnmount: fn => { dispose = fn } } })
  const read = usePrivateAccountRead(() => session, () => allowed)
  const pending = read.load(s => { signal = s; return new Promise(r => { resolve = r }) })
  assert.equal(read.loading.value, true)
  session = 'client-2'; allowed = false; read.reset()
  assert.equal(signal.aborted, true)
  resolve('private account'); await pending
  assert.equal(read.data.value, null)
  assert.equal(read.loading.value, false)
  allowed = true
  await read.load(async () => { throw Error('503') })
  assert.match(read.error.value.message, /503/)
  await read.load(async () => 'new session')
  assert.equal(read.data.value, 'new session'); assert.equal(read.error.value, null)
  const a = read.load(() => new Promise(r => { resolve = r }))
  await read.load(async () => 'newer filters')
  resolve('obsolete filters'); await a
  assert.equal(read.data.value, 'newer filters')
  dispose(); assert.equal(read.data.value, null)
})
