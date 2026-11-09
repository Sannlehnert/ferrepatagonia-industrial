const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')
const { parse, compileScript } = require('@vue/compiler-sfc')
const { createSSRApp } = require('vue')
const { renderToString } = require('@vue/server-renderer')

function loadTypeScript(relativePath, dependencies = {}) {
    const source = readFileSync(resolve(__dirname, '../src', relativePath), 'utf8')
    const output = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText
    const module = { exports: {} }
    new Function('require', 'module', 'exports', output)(
        name => dependencies[name] || require(name),
        module,
        module.exports,
    )
    return module.exports
}

test('formatea USD desde cadenas exactas y mantiene null como desconocido', () => {
    const { formatUsd } = loadTypeScript('utils/cuentaCorriente.ts')

    assert.equal(formatUsd('123456789012345.67'), 'US$ 123.456.789.012.345,67')
    assert.match(formatUsd('-0.01'), /0,01/)
    assert.match(formatUsd('-0.01'), /-/)
    assert.equal(formatUsd(null), 'No determinable')
    assert.equal(formatUsd(undefined), 'No determinable')
    assert.equal(formatUsd('0.00'), 'US$ 0,00')
    assert.equal(formatUsd('1e3'), 'No determinable')
})

test('formatea vencimientos civiles sin cambiar el día por zona horaria', () => {
    const { formatCivilDate } = loadTypeScript('utils/cuentaCorriente.ts')

    assert.match(formatCivilDate('2026-10-31'), /31/)
    assert.equal(formatCivilDate('2026-02-30'), 'Fecha no disponible')
})

test('consulta solo endpoints propios y pagina con el cursor del backend', async () => {
    const calls = []
    const response = { data: { data: { estado: 'SIN_CUENTA' } } }
    const api = {
        get: async (...args) => {
            calls.push(args)
            return response
        },
    }
    const service = loadTypeScript('services/cuentaCorrienteService.ts', {
        '@/services/api': { __esModule: true, default: api },
    })

    assert.deepEqual(await service.getCuentaCorriente(), response.data.data)
    assert.deepEqual(await service.getCuentaCorrienteMovimientos('opaque-cursor'), response.data.data)
    assert.deepEqual(await service.getCuentaCorrienteVencimientos(), response.data.data)
    assert.deepEqual(calls, [
        ['/cuenta-corriente'],
        ['/cuenta-corriente/movimientos', { params: { limite: 25, cursor: 'opaque-cursor' } }],
        ['/cuenta-corriente/vencimientos', { params: { limite: 25 } }],
    ])
    assert.ok(calls.every(([url]) => !url.includes('clienteId')))
})

function createStore(sessionState, services) {
    const pinia = {
        defineStore: (_name, options) => () => {
            const state = options.state()
            for (const [name, action] of Object.entries(options.actions)) {
                state[name] = action.bind(state)
            }
            return state
        },
    }
    const storeModule = loadTypeScript('stores/cuentaCorriente.ts', {
        pinia,
        axios: { __esModule: true, default: { isAxiosError: () => false } },
        '@/services/sessionGeneration': {
            currentSessionGeneration: () => sessionState.generation,
        },
        '@/services/cuentaCorrienteService': services,
    })
    return storeModule.useCuentaCorrienteStore()
}

function loadAccountView(account) {
    const filename = resolve(__dirname, '../src/views/cuenta/CuentaCorrienteView.vue')
    const source = readFileSync(filename, 'utf8').replace('import.meta.env.DEV', 'false')
    const { descriptor } = parse(source, { filename })
    const componentSource = compileScript(descriptor, {
        id: 'cuenta-corriente-test',
        inlineTemplate: true,
    }).content
    const output = ts.transpileModule(componentSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText
    const componentModule = { exports: {} }
    const dependencies = {
        '@/stores/auth': { useAuthStore: () => ({ sessionVersion: 0 }) },
        '@/stores/cuentaCorriente': { useCuentaCorrienteStore: () => account },
        '@/utils/cuentaCorriente': {
            coverageMessage: () => '',
            formatCivilDate: () => '',
            formatInstant: () => '',
            formatUsd: () => '',
        },
        'vue-router': { onBeforeRouteLeave: () => {} },
    }

    new Function('require', 'module', 'exports', output)(
        name => dependencies[name] || require(name),
        componentModule,
        componentModule.exports,
    )
    return componentModule.exports.default
}

test('no consulta movimientos si el backend confirma que no existe una cuenta', async () => {
    const requested = []
    const store = createStore({ generation: 1 }, {
        getCuentaCorriente: async () => ({ corte: '2026-11-07T12:00:00Z', revision: 'r1', estado: 'SIN_CUENTA' }),
        getCuentaCorrienteMovimientos: async () => requested.push('movimientos'),
        getCuentaCorrienteVencimientos: async () => requested.push('vencimientos'),
    })

    await store.load()

    assert.equal(store.consulta.estado, 'SIN_CUENTA')
    assert.deepEqual(requested, [])
})

test('descarta el resultado de cuenta si cambia la sesión durante la consulta', async () => {
    const sessionState = { generation: 1 }
    let resolveSummary
    const store = createStore(sessionState, {
        getCuentaCorriente: () => new Promise(resolve => { resolveSummary = resolve }),
        getCuentaCorrienteMovimientos: async () => assert.fail('No debe consultar otra sesión'),
        getCuentaCorrienteVencimientos: async () => assert.fail('No debe consultar otra sesión'),
    })

    const pending = store.load()
    sessionState.generation = 2
    resolveSummary({ corte: '2026-11-07T12:00:00Z', revision: 'r1', estado: 'SIN_CUENTA' })
    await pending

    assert.equal(store.consulta, null)
})

test('no muestra datos DEMO en producción aunque el resumen sea REAL', async () => {
    const demoItem = { origen: 'DEMO' }
    const account = {
        consulta: { estado: 'HABILITADA', origen: 'REAL' },
        movimientos: { items: [demoItem] },
        vencimientos: { items: [] },
        consultaCargando: false,
        consultaError: '',
    }

    const movementHtml = await renderToString(createSSRApp(loadAccountView(account)))
    assert.match(movementHtml, /no se mostrará fuera del entorno de pruebas/)
    assert.doesNotMatch(movementHtml, /Saldo actual/)

    account.movimientos = { items: [] }
    account.vencimientos = { items: [demoItem] }
    const dueHtml = await renderToString(createSSRApp(loadAccountView(account)))
    assert.match(dueHtml, /no se mostrará fuera del entorno de pruebas/)
    assert.doesNotMatch(dueHtml, /Vencimientos/)
})
