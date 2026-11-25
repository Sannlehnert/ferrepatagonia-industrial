const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')

function load(relativePath, dependencies = {}) {
  const source = readFileSync(resolve(__dirname, '../src', relativePath), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output)(
    name => dependencies[name] || require(name),
    module,
    module.exports,
  )
  return module.exports
}

const { clientCreditExperience } = load('utils/creditExperience.ts')

const account = (overrides = {}) => ({
  estado: 'HABILITADA',
  estadoCredito: 'DISPONIBLE',
  cobertura: 'COMPLETA',
  ...overrides,
})
const request = estado => ({ id: 7, estado })

function experience(overrides = {}) {
  return clientCreditExperience({
    approval: 'APROBADA',
    account: null,
    accountKnown: true,
    latestRequest: null,
    requestsLoading: false,
    ...overrides,
  })
}

test('distingue aprobación pendiente y rechazada antes de mirar la cuenta', () => {
  assert.equal(experience({ approval: 'PENDIENTE' }).key, 'EMPRESA_PENDIENTE')
  assert.equal(experience({ approval: 'RECHAZADA' }).key, 'EMPRESA_RECHAZADA')
  assert.equal(experience({ approval: null }).key, 'APROBACION_NO_DETERMINABLE')
})

test('explica cada estado del circuito de crédito y su siguiente acción', () => {
  assert.equal(experience().key, 'SIN_CREDITO')
  assert.equal(experience({ latestRequest: request('PENDIENTE') }).key, 'SOLICITUD_PENDIENTE')
  assert.equal(experience({ latestRequest: request('RECHAZADA') }).key, 'SOLICITUD_RECHAZADA')
  assert.equal(experience({ latestRequest: request('APROBADA') }).key, 'PENDIENTE_HABILITACION')
  assert.equal(experience({ account: account() }).key, 'CUENTA_ELEGIBLE')
  assert.equal(experience({ account: account({ estadoCredito: 'BLOQUEADO' }) }).key, 'COMPRA_BLOQUEADA')
  assert.equal(experience({ account: account({ estadoCredito: 'NO_DETERMINABLE' }) }).key, 'CREDITO_NO_DETERMINABLE')
  assert.equal(experience({ account: account({ estado: 'INHABILITADA' }) }).key, 'CUENTA_INHABILITADA')
  assert.equal(experience({
    account: account({ estado: 'INHABILITADA' }),
    latestRequest: request('APROBADA'),
  }).key, 'PENDIENTE_HABILITACION')
})

test('no ofrece acciones operativas sin cuenta habilitada o con consulta fallida', () => {
  assert.equal(experience({ account: account({ estado: 'INHABILITADA' }) }).hasOperationalAccount, false)
  assert.equal(experience({ accountFailed: true }).key, 'CUENTA_NO_DISPONIBLE')
  assert.equal(experience({ accountKnown: false }).key, 'CONSULTANDO')
  assert.equal(experience({ requestsLoading: true }).key, 'CONSULTANDO')
  assert.equal(experience({ account: account() }).hasOperationalAccount, true)
  assert.equal(experience({ account: account() }).action, 'catalogo')
})
