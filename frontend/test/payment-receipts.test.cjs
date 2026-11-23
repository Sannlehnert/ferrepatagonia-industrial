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

test('markPaymentReceiptReviewed envía Idempotency-Key UUID v4 y body { estado: APROBADO }', async () => {
  const calls = []
  const api = {
    patch: async (...args) => {
      calls.push(args)
      return { status: 200 }
    },
  }
  const { markPaymentReceiptReviewed } = loadTypeScript('services/paymentReceiptService.ts', {
    './api': { __esModule: true, default: api },
  })
  const { signal } = new AbortController()
  await markPaymentReceiptReviewed('/admin/comprobantes', '11111111-1111-4111-8111-111111111111', signal)

  assert.equal(calls.length, 1)
  const [url, body, config] = calls[0]
  assert.equal(url, '/admin/comprobantes/11111111-1111-4111-8111-111111111111/revision')
  assert.deepEqual(body, { estado: 'APROBADO' })
  assert.match(
    config.headers['Idempotency-Key'],
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
  assert.equal(config.signal, signal)
})

test('useOrderReceiptSummaries agrega estados con precedencia APROBADO > PENDIENTE > RECHAZADO > NO_ADJUNTO', async () => {
  const pagesByOrder = {
    1: [{ items: [], paginaSiguiente: null }],
    2: [{ items: [{ estadoRevision: 'RECHAZADO' }, { estadoRevision: 'RECHAZADO' }], paginaSiguiente: null }],
    3: [{ items: [{ estadoRevision: 'RECHAZADO' }, { estadoRevision: 'PENDIENTE' }], paginaSiguiente: null }],
    4: [
      { items: [{ estadoRevision: 'PENDIENTE' }], paginaSiguiente: 2 },
      { items: [{ estadoRevision: 'APROBADO' }], paginaSiguiente: null },
    ],
  }
  const serviceModule = loadTypeScript('services/paymentReceiptService.ts', {
    './api': { __esModule: true, default: {} },
  })
  const dataRef = { value: null }
  const loadingRef = { value: false }
  const errorRef = { value: null }
  const orders = [
    { pedidoId: 1, modalidadPago: 'TRANSFERENCIA' },
    { pedidoId: 2, modalidadPago: 'TRANSFERENCIA' },
    { pedidoId: 3, modalidadPago: 'TRANSFERENCIA' },
    { pedidoId: 4, modalidadPago: 'TRANSFERENCIA' },
  ]
  const { useOrderReceiptSummaries } = loadTypeScript('composables/useOrderReceiptSummaries.ts', {
    vue: {
      watch: (_deps, callback) => {
        callback()
      },
    },
    '@/composables/usePrivateAccountRead': {
      usePrivateAccountRead: () => ({
        data: dataRef,
        loading: loadingRef,
        error: errorRef,
        reset: () => { dataRef.value = null },
        load: async loader => {
          dataRef.value = await loader(new AbortController().signal)
        },
      }),
    },
    '@/services/paymentReceiptService': {
      ...serviceModule,
      listPaymentReceipts: async (path, page) => {
        const orderId = Number(path.split('/')[2])
        return pagesByOrder[orderId][page - 1]
      },
    },
    '@/stores/auth': {
      useAuthStore: () => ({
        rol: 'CLIENTE',
        loggingIn: false,
        loggingOut: false,
        sessionVersion: 1,
        user: { id: 10, tipo_cliente: 'PARTICULAR', estadoAprobacionEmpresa: null, cuentaCorrienteHabilitada: null },
      }),
    },
  })

  const summary = useOrderReceiptSummaries(() => orders)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(summary.status(orders[0]), 'NO_ADJUNTO')
  assert.equal(summary.status(orders[1]), 'RECHAZADO')
  assert.equal(summary.status(orders[2]), 'PENDIENTE')
  assert.equal(summary.status(orders[3]), 'APROBADO')
})

test('receiptReviewStatusLabel cubre los tres estados de revisión de comprobantes', () => {
  const { receiptReviewStatusLabel } = loadTypeScript('utils/payment.ts')

  assert.equal(receiptReviewStatusLabel('PENDIENTE'), 'Pendiente de revisión documental')
  assert.equal(receiptReviewStatusLabel('APROBADO'), 'Documento aprobado')
  assert.equal(receiptReviewStatusLabel('RECHAZADO'), 'Documento rechazado')

  const declarationForm = readFileSync(
    resolve(__dirname, '../src/components/PaymentDeclarationForm.vue'),
    'utf8',
  )
  assert.match(declarationForm, /receiptReviewStatusLabel\(receipt\.estadoRevision\)/)
})

test('componentes y vistas de comprobantes usan APROBADO / RECHAZADO sin referencias a REVISADO', async () => {
  const { parse, compileScript } = require('@vue/compiler-sfc')
  const { createSSRApp } = require('vue')
  const { renderToString } = require('@vue/server-renderer')

  const files = [
    'services/paymentReceiptService.ts',
    'components/PaymentDeclarationForm.vue',
    'components/PaymentReceipts.vue',
    'components/OrderReceiptActions.vue',
    'composables/useOrderReceiptSummaries.ts',
    'views/cuenta/HistorialPedidos.vue',
  ]
  for (const relativePath of files) {
    const content = readFileSync(resolve(__dirname, '../src', relativePath), 'utf8')
    assert.doesNotMatch(content, /REVISADO/)
  }

  const actionsFilename = resolve(__dirname, '../src/components/OrderReceiptActions.vue')
  const { descriptor } = parse(readFileSync(actionsFilename, 'utf8'), { filename: actionsFilename })
  const compiled = compileScript(descriptor, { id: 'order-receipt-actions-test', inlineTemplate: true }).content
  const output = ts.transpileModule(compiled, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const paymentUtils = loadTypeScript('utils/payment.ts')
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)(
    name => (name === '@/utils/payment' ? paymentUtils : require(name)),
    mod,
    mod.exports,
  )
  const Component = mod.exports.default

  assert.match(await renderToString(createSSRApp(Component, { status: 'APROBADO', orderNumber: 'PED-000001' })), /Aprobado/)
  assert.match(await renderToString(createSSRApp(Component, { status: 'RECHAZADO', orderNumber: 'PED-000001' })), /Rechazado/)
  assert.match(await renderToString(createSSRApp(Component, { status: 'PENDIENTE', orderNumber: 'PED-000001' })), /Pendiente de revisión/)
})
