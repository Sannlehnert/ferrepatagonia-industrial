const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')

function loadTypeScript(relativePath, dependencies = {}) {
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

test('supportsOrderReceipts refleja las combinaciones habilitadas por el backend para TRANSFERENCIA y CUENTA_CORRIENTE', () => {
  const { supportsOrderReceipts } = loadTypeScript('services/paymentReceiptService.ts', {
    './api': { __esModule: true, default: {} },
  })

  // PARTICULAR: solo TRANSFERENCIA
  assert.equal(supportsOrderReceipts('PARTICULAR', 'TRANSFERENCIA', null, null), true)
  assert.equal(supportsOrderReceipts('PARTICULAR', 'CUENTA_CORRIENTE', null, null), false)
  assert.equal(supportsOrderReceipts('PARTICULAR', 'EFECTIVO', null, null), false)

  // EMPRESA APROBADA: TRANSFERENCIA (con o sin cuenta corriente)
  assert.equal(supportsOrderReceipts('EMPRESA', 'TRANSFERENCIA', 'APROBADA', null), true)
  assert.equal(supportsOrderReceipts('EMPRESA', 'TRANSFERENCIA', 'APROBADA', false), true)
  assert.equal(supportsOrderReceipts('EMPRESA', 'TRANSFERENCIA', 'APROBADA', true), true)

  // EMPRESA PENDIENTE o RECHAZADA: TRANSFERENCIA no habilitada
  assert.equal(supportsOrderReceipts('EMPRESA', 'TRANSFERENCIA', 'PENDIENTE', null), false)
  assert.equal(supportsOrderReceipts('EMPRESA', 'TRANSFERENCIA', 'RECHAZADA', null), false)
  assert.equal(supportsOrderReceipts('EMPRESA', 'TRANSFERENCIA', null, null), false)

  // EMPRESA con CUENTA_CORRIENTE: habilitada o inhabilitada puede documentar pagos; sin cuenta (null) no
  assert.equal(supportsOrderReceipts('EMPRESA', 'CUENTA_CORRIENTE', 'APROBADA', true), true)
  assert.equal(supportsOrderReceipts('EMPRESA', 'CUENTA_CORRIENTE', 'APROBADA', false), true)
  assert.equal(supportsOrderReceipts('EMPRESA', 'CUENTA_CORRIENTE', 'RECHAZADA', false), true)
  assert.equal(supportsOrderReceipts('EMPRESA', 'CUENTA_CORRIENTE', 'APROBADA', null), false)

  // Compatibilidad con llamadas sin cuentaCorrienteHabilitada (undefined)
  assert.equal(supportsOrderReceipts('EMPRESA', 'CUENTA_CORRIENTE', 'APROBADA'), true)

  // Sin tipo de cliente / ADMIN / modalidad desconocida
  assert.equal(supportsOrderReceipts(null, 'TRANSFERENCIA', null, null), false)
  assert.equal(supportsOrderReceipts(undefined, 'CUENTA_CORRIENTE', 'APROBADA', true), false)
  assert.equal(supportsOrderReceipts('EMPRESA', 'OTRA', 'APROBADA', true), false)
})

test('listado y detalle comparten el mismo criterio completo de habilitación de comprobantes', () => {
  const detailComponent = readFileSync(
    resolve(__dirname, '../src/components/OrderPaymentReceipts.vue'),
    'utf8',
  )
  const listComposable = readFileSync(
    resolve(__dirname, '../src/composables/useOrderReceiptSummaries.ts'),
    'utf8',
  )

  for (const source of [detailComponent, listComposable]) {
    assert.match(source, /supportsOrderReceipts\(/)
    assert.match(source, /auth\.user\?\.tipo_cliente/)
    assert.match(source, /auth\.user\?\.estadoAprobacionEmpresa/)
    assert.match(source, /auth\.user\?\.cuentaCorrienteHabilitada/)
  }
})
