const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')
const { createPinia, disposePinia, setActivePinia } = require('pinia')
const { reactive } = require('vue')

const key = '8d44f785-3560-4ed1-8c63-12b6d1a132cf'
const eligibleOrder = {
  elegible: true,
  modalidadPago: 'TRANSFERENCIA',
  moneda: 'USD',
  totalUSD: '80.00',
  codigo: null,
  mensaje: null,
  cotizacion: 'signed-transfer-quote-token-for-tests',
}
const confirmed = {
  pedidoId: 456,
  estado: 'CONFIRMADO',
  modalidadPago: 'TRANSFERENCIA',
  moneda: 'USD',
  totalUSD: '80.00',
}
const pending = {
  estado: 'PENDIENTE',
  code: 'CONFIRMACION_PENDIENTE',
  message: 'Todavía no hay un resultado definitivo.',
}
const tick = () => new Promise(resolve => setImmediate(resolve))

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

function createRuntime(t, transport, saved = null) {
  const pinia = createPinia()
  setActivePinia(pinia)
  t.after(() => disposePinia(pinia))
  const auth = reactive({
    user: { id: 7, rol: 'CLIENTE', tipo_cliente: 'PARTICULAR' },
    sessionChecked: true,
    sessionError: '',
    loggingIn: false,
    loggingOut: false,
    sessionVersion: 1,
  })
  const values = new Map(saved ? [[7, saved]] : [])
  let reconciled = 0
  const storage = {
    get: userId => values.get(userId) || null,
    set: (userId, value, quoteToken) => values.set(userId, JSON.stringify({ key: value, quoteToken })),
    remove: userId => values.delete(userId),
  }
  const storeModule = loadTypeScript('stores/transferOrder.ts', {
    '@/services/transferOrderService': {
      transferOrderErrorMessage: () => 'Transfer failed',
    },
    '@/services/sessionGeneration': { currentSessionGeneration: () => 1 },
    '@/services/realtime': { onRealtime() {} },
    '@/stores/auth': { useAuthStore: () => auth },
    '@/stores/cart': {
      useCartStore: () => ({ reconciliarPedidoConfirmado: () => { reconciled++ } }),
    },
  })
  const useStore = storeModule.createTransferOrderStore(transport, storage, () => key)
  return {
    store: useStore(pinia),
    values,
    get reconciled() { return reconciled },
  }
}

test('service uses the transfer endpoints, quote and idempotency key', async () => {
  const calls = []
  const api = {
    get: async (...args) => {
      calls.push(['GET', ...args])
      if (args[0] === '/pedidos/transferencia/eligibilidad') {
        return { data: { data: eligibleOrder } }
      }
      return { status: 200, data: { data: confirmed } }
    },
    post: async (...args) => {
      calls.push(['POST', ...args])
      return { status: 201, data: { data: confirmed } }
    },
  }
  const service = loadTypeScript('services/transferOrderService.ts', {
    '@/services/api': { __esModule: true, default: api },
  })
  const signal = new AbortController().signal

  assert.deepEqual(await service.transferOrderService.getEligibility(signal), eligibleOrder)
  assert.deepEqual(await service.transferOrderService.confirm(key, eligibleOrder.cotizacion, signal), {
    estado: 'CONFIRMADO',
    result: confirmed,
  })
  assert.deepEqual(await service.transferOrderService.recover(key, signal), {
    estado: 'CONFIRMADO',
    result: confirmed,
  })
  assert.deepEqual(calls.map(call => call.slice(0, 3)), [
    ['GET', '/pedidos/transferencia/eligibilidad', { signal }],
    ['POST', '/pedidos/transferencia', { cotizacion: eligibleOrder.cotizacion }],
    ['GET', `/pedidos/transferencia/${key}`, { signal }],
  ])
  assert.deepEqual(calls[1][3], {
    signal,
    headers: { 'Idempotency-Key': key },
  })
})

test('keeps the same attempt key while the order result is pending', async t => {
  const requests = []
  let confirmations = 0
  const runtime = createRuntime(t, {
    getEligibility: async () => eligibleOrder,
    confirm: async (requestKey, quoteToken) => {
      requests.push({ requestKey, quoteToken })
      confirmations++
      return confirmations === 1
        ? { estado: 'PENDIENTE', result: pending }
        : { estado: 'CONFIRMADO', result: confirmed }
    },
    recover: async () => ({ estado: 'PENDIENTE', result: pending }),
  })
  await tick()

  assert.equal(await runtime.store.confirm(), false)
  assert.equal(runtime.store.attemptState, 'pending')
  assert.deepEqual(JSON.parse(runtime.values.get(7)), { key, quoteToken: eligibleOrder.cotizacion })
  assert.equal(await runtime.store.confirm(), false)
  assert.equal(requests.length, 1)

  assert.equal(await runtime.store.retryPendingConfirmation(), true)
  assert.equal(runtime.store.attemptState, 'confirmed')
  assert.deepEqual(requests, [
    { requestKey: key, quoteToken: eligibleOrder.cotizacion },
    { requestKey: key, quoteToken: eligibleOrder.cotizacion },
  ])
  assert.equal(runtime.values.has(7), false)
  assert.equal(runtime.reconciled, 1)

  await runtime.store.loadEligibility()
  assert.equal(runtime.store.attemptState, 'idle')
  assert.equal(runtime.store.confirmation, null)
})

test('recovers a saved transfer attempt and reconciles the cart only when registered', async t => {
  const saved = JSON.stringify({ key, quoteToken: eligibleOrder.cotizacion })
  const recovered = []
  const runtime = createRuntime(t, {
    getEligibility: async () => eligibleOrder,
    confirm: async () => assert.fail('No debe crear un intento nuevo'),
    recover: async requestKey => {
      recovered.push(requestKey)
      return { estado: 'CONFIRMADO', result: confirmed }
    },
  }, saved)
  await tick()

  assert.deepEqual(recovered, [key])
  assert.equal(runtime.store.attemptState, 'confirmed')
  assert.deepEqual(runtime.store.confirmation, confirmed)
  assert.equal(runtime.values.has(7), false)
  assert.equal(runtime.reconciled, 1)
})
