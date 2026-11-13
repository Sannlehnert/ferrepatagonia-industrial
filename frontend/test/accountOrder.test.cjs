const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')
const { AxiosError } = require('axios')
const { createPinia, disposePinia, setActivePinia } = require('pinia')
const { reactive } = require('vue')

const key = '8d44f785-3560-4ed1-8c63-12b6d1a132cf'
const eligibleOrder = {
    elegible: true,
    moneda: 'USD',
    totalUSD: '80.00',
    creditoDisponibleUSD: '500.00',
    codigo: null,
    mensaje: null,
    cotizacion: 'signed-quote-token-for-tests',
}
const confirmed = {
    estado: 'CONFIRMADO',
    pedidoId: 456,
    modalidadPago: 'CUENTA_CORRIENTE',
    moneda: 'USD',
    totalUSD: '80.00',
    cargoId: '789',
    venceEl: '2026-12-09',
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

function createRuntime(t, transport, savedKey = null) {
    const pinia = createPinia()
    setActivePinia(pinia)
    t.after(() => disposePinia(pinia))
    let generation = 1
    const auth = reactive({
        user: { id: 7, rol: 'CLIENTE' },
        sessionChecked: true,
        sessionError: '',
        loggingIn: false,
        loggingOut: false,
        sessionVersion: generation,
    })
    const values = new Map(savedKey ? [[7, savedKey]] : [])
    const storage = {
        get: userId => values.get(userId) || null,
        set: (userId, value, quoteToken) => values.set(userId, JSON.stringify({ key: value, quoteToken })),
        remove: userId => values.delete(userId),
    }
    const storeModule = loadTypeScript('stores/accountOrder.ts', {
        '@/services/accountOrderService': {
            accountOrderErrorMessage: error => error.response?.data?.message || 'Unknown error',
        },
        '@/services/sessionGeneration': {
            currentSessionGeneration: () => generation,
        },
        '@/stores/auth': { useAuthStore: () => auth },
        '@/services/realtime': { onRealtime() {} },
        '@/stores/cart': { useCartStore: () => ({ reconciliarPedidoConfirmado() {} }) },
    })
    const useStore = storeModule.createAccountOrderStore(transport, storage, () => key)
    return {
        store: useStore(pinia),
        auth,
        storage: values,
        changeGeneration(next) {
            generation = next
            auth.sessionVersion = next
        },
    }
}

function deferred() {
    let resolve
    const promise = new Promise(done => { resolve = done })
    return { promise, resolve }
}

test('service queries server credit and submits only an empty body with idempotency key', async () => {
    const calls = []
    const api = {
        get: async (...args) => {
            calls.push(['GET', ...args])
            if (args[0] === '/pedidos/cuenta-corriente/eligibilidad') {
                return { data: { data: eligibleOrder } }
            }
            return { status: 200, data: { data: confirmed } }
        },
        post: async (...args) => {
            calls.push(['POST', ...args])
            return { status: 201, data: { data: confirmed } }
        },
    }
    const service = loadTypeScript('services/accountOrderService.ts', {
        '@/services/api': { __esModule: true, default: api },
    })
    const signal = new AbortController().signal

    assert.deepEqual(await service.accountOrderService.getEligibility(signal), eligibleOrder)
    assert.deepEqual(await service.accountOrderService.confirm(key, eligibleOrder.cotizacion, signal), {
        estado: 'CONFIRMADO',
        result: confirmed,
    })
    assert.deepEqual(await service.accountOrderService.recover(key, signal), {
        estado: 'CONFIRMADO',
        result: confirmed,
    })
    assert.deepEqual(calls.map(call => call.slice(0, 3)), [
        ['GET', '/pedidos/cuenta-corriente/eligibilidad', { signal }],
      ['POST', '/pedidos/cuenta-corriente', { cotizacion: eligibleOrder.cotizacion }],
        ['GET', `/pedidos/cuenta-corriente/${key}`, { signal }],
    ])
    assert.deepEqual(calls[1][3], {
        signal,
        headers: { 'Idempotency-Key': key },
    })
})

test('enables account orders only when the server confirms eligibility', async t => {
    const { store } = createRuntime(t, {
        getEligibility: async () => ({
            ...eligibleOrder,
            elegible: false,
            codigo: 'PRECIO_SINTETICO',
            mensaje: 'Los precios de demostración no permiten confirmar pedidos.',
        }),
        confirm: async () => assert.fail('No debe enviar la confirmación'),
        recover: async () => assert.fail('No debe consultar un intento'),
    })
    await tick()
    assert.equal(store.canUseCredit, false)

    const eligible = createRuntime(t, {
        getEligibility: async () => eligibleOrder,
        confirm: async () => assert.fail('No debe enviar la confirmación'),
        recover: async () => assert.fail('No debe consultar un intento'),
    })
    await tick()
    assert.equal(eligible.store.canUseCredit, true)
})

test('ignora doble confirmación y mantiene el resultado incierto bajo la misma clave', async t => {
    const response = deferred()
    const requests = []
    const { store, storage } = createRuntime(t, {
        getEligibility: async () => eligibleOrder,
        confirm: (requestKey, signal) => {
            requests.push({ requestKey, signal })
            return response.promise
        },
        recover: async () => ({ estado: 'PENDIENTE', result: {
            estado: 'PENDIENTE',
            code: 'CONFIRMACION_PENDIENTE',
            message: 'Pendiente',
        } }),
    })
    await tick()
    const first = store.confirm()

    assert.equal(await store.confirm(), false)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].requestKey, key)
    assert.deepEqual(JSON.parse(storage.get(7)), { key, quoteToken: eligibleOrder.cotizacion })
    assert.equal(store.attemptState, 'submitting')

    response.resolve({ estado: 'PENDIENTE', result: {
        estado: 'PENDIENTE',
        code: 'CONFIRMACION_PENDIENTE',
        message: 'Pendiente',
    } })
    assert.equal(await first, false)
    assert.equal(store.attemptState, 'pending')
    assert.deepEqual(JSON.parse(storage.get(7)), { key, quoteToken: eligibleOrder.cotizacion })
    assert.equal(await store.confirm(), false)
    assert.equal(requests.length, 1)
})

test('recupera un intento persistido sin crear otra clave', async t => {
    const recovered = []
    const { store, storage } = createRuntime(t, {
        getEligibility: async () => eligibleOrder,
        confirm: async () => assert.fail('No debe crear un intento nuevo'),
        recover: async requestKey => {
            recovered.push(requestKey)
            return { estado: 'CONFIRMADO', result: confirmed }
        },
    }, JSON.stringify({ key, quoteToken: eligibleOrder.cotizacion }))
    await tick()

    assert.deepEqual(recovered, [key])
    assert.equal(store.attemptState, 'confirmed')
    assert.deepEqual(store.confirmation, confirmed)
    assert.equal(storage.has(7), false)
})

test('muestra el rechazo real de crédito insuficiente y exige preparar un nuevo intento', async t => {
    const rejection = new AxiosError('Insufficient', undefined, undefined, undefined, {
        status: 409,
        data: { estado: 'RECHAZADO', code: 'CREDITO_INSUFICIENTE', message: 'Crédito insuficiente.' },
    })
    const requests = []
    const { store, storage } = createRuntime(t, {
        getEligibility: async () => eligibleOrder,
        confirm: async requestKey => {
            requests.push(requestKey)
            throw rejection
        },
        recover: async () => assert.fail('No hay un resultado incierto'),
    })
    await tick()

    assert.equal(await store.confirm(), false)
    assert.equal(store.attemptState, 'rejected')
    assert.equal(store.attemptError, 'Crédito insuficiente.')
    assert.equal(storage.has(7), false)
    assert.equal(await store.confirm(), false)
    assert.equal(requests.length, 1)
})

test('H03: 404 al reconciliar conserva clave y reintenta el POST con esa misma clave', async t => {
    const missing = new AxiosError('Missing', undefined, undefined, undefined, {
        status: 404, data: { code: 'INTENTO_NO_ENCONTRADO', message: 'No se encontró.' },
    })
    const posted = []
    const saved = JSON.stringify({ key, quoteToken: eligibleOrder.cotizacion })
    const { store, storage } = createRuntime(t, {
        getEligibility: async () => eligibleOrder,
        confirm: async (requestKey, quoteToken) => {
            posted.push({ requestKey, quoteToken })
            return { estado: 'PENDIENTE', result: { estado: 'PENDIENTE', code: 'CONFIRMACION_PENDIENTE', message: 'Pendiente' } }
        },
        recover: async () => { throw missing },
    }, saved)
    await tick()
    assert.equal(store.attemptState, 'pending')
    assert.equal(store.pendingKey, key)
    assert.match(store.attemptError, /Conservamos el mismo identificador/)
    await store.retryPendingConfirmation()
    assert.deepEqual(posted, [{ requestKey: key, quoteToken: eligibleOrder.cotizacion }])
    assert.deepEqual(JSON.parse(storage.get(7)), { key, quoteToken: eligibleOrder.cotizacion })
    assert.equal(store.attemptState, 'pending')
})

test('H03: rechazo persistido durante recuperación finaliza el intento y permite corregir', async t => {
    const rejection = new AxiosError('Credit rejected', undefined, undefined, undefined, {
        status: 409, data: { estado: 'RECHAZADO', code: 'CREDITO_INSUFICIENTE', message: 'Crédito insuficiente.' },
    })
    const saved = JSON.stringify({ key, quoteToken: eligibleOrder.cotizacion })
    const { store, storage } = createRuntime(t, {
        getEligibility: async () => eligibleOrder,
        confirm: async () => assert.fail('No debe reintentar automáticamente'),
        recover: async () => { throw rejection },
    }, saved)
    await tick()
    assert.equal(store.attemptState, 'rejected')
    assert.equal(store.pendingKey, '')
    assert.equal(storage.has(7), false)
    assert.equal(store.attemptError, 'Crédito insuficiente.')
    store.prepareRetry()
    assert.equal(store.attemptState, 'idle')
})
