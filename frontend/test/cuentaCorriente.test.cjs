const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
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

test('mantiene la fecha civil en UTC+14 y Argentina, y los instantes en horario argentino', () => {
    const sourcePath = resolve(__dirname, '../src/utils/cuentaCorriente.ts')
    const script = `
        const { readFileSync } = require('node:fs')
        const ts = require('typescript')
        const source = readFileSync(process.argv[1], 'utf8')
        const output = ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS },
        }).outputText
        const module = { exports: {} }
        new Function('require', 'module', 'exports', output)(
            require, module, module.exports,
        )
        console.log(module.exports.formatCivilDate('2026-03-02'))
        console.log(module.exports.formatInstant('2026-03-02T02:00:00Z'))
    `
    const results = ['Pacific/Kiritimati', 'America/Argentina/Buenos_Aires'].map(TZ =>
        spawnSync(process.execPath, ['-e', script, sourcePath], {
            encoding: 'utf8',
            env: { ...process.env, TZ },
        }),
    )

    for (const result of results) assert.equal(result.status, 0, result.stderr)
    assert.equal(results[0].stdout, results[1].stdout)
    assert.match(results[0].stdout.split(/\r?\n/)[0], /\b2\b/)
    assert.match(results[0].stdout.split(/\r?\n/)[1], /\b1\b/)
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

    const { signal } = new AbortController()
    assert.deepEqual(await service.getCuentaCorriente(signal), response.data.data)
    assert.deepEqual(await service.getCuentaCorrienteMovimientos('opaque-cursor'), response.data.data)
    assert.deepEqual(await service.getCuentaCorrienteVencimientos(), response.data.data)
    assert.deepEqual(calls, [
        ['/cuenta-corriente', { signal }],
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
    const { formatCivilDate, formatInstant, formatUsd } = loadTypeScript('utils/cuentaCorriente.ts')
    const dependencies = {
        '@/stores/auth': { useAuthStore: () => ({ sessionVersion: 0 }) },
        '@/stores/cuentaCorriente': { useCuentaCorrienteStore: () => account },
        '@/utils/cuentaCorriente': {
            coverageMessage: () => '',
            formatCivilDate,
            formatInstant,
            formatUsd,
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

function summary(revision = 'r1') {
    return {
        corte: `summary-${revision}`,
        revision,
        estado: 'HABILITADA',
        cuentaId: 1,
        origen: 'REAL',
        moneda: 'USD',
        plazoDias: 30,
        saldo: '100.00',
        limite: '500.00',
        utilizado: '400.00',
        disponible: '100.00',
        deudaVencidaTotal: '0.00',
        deudaVencida30Dias: '0.00',
        deudaVencida60Dias: '0.00',
        deudaPorVencerTotal: '0.00',
        cobertura: 'COMPLETA',
        estadoCredito: 'DISPONIBLE',
    }
}

function page(revision = 'r1', items = [], corte = `page-${revision}`) {
    return {
        corte,
        revision,
        estado: 'HABILITADA',
        cobertura: 'COMPLETA',
        items,
        siguienteCursor: null,
    }
}

function movement(id, tipo, importe, origen = 'REAL') {
    return {
        id,
        fechaOperacion: '2026-03-02T02:00:00Z',
        concepto: `Movimiento ${id}`,
        importe,
        saldoResultante: '100.00',
        moneda: 'USD',
        tipo,
        estado: 'VIGENTE',
        venceEl: '2026-03-02',
        plazoDias: 30,
        origen,
        referencia: { pedidoId: Number(id) },
    }
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

test('reintenta y publica juntas las primeras páginas con la revisión del resumen', async () => {
    let summaryCalls = 0
    let movementCalls = 0
    let dueCalls = 0
    let releaseFirstMovement
    const firstMovement = new Promise(resolve => { releaseFirstMovement = resolve })
    const sessionState = { generation: 1 }
    const store = createStore(sessionState, {
        getCuentaCorriente: async () => summary(++summaryCalls === 1 ? 'r1' : 'r2'),
        getCuentaCorrienteMovimientos: async () => {
            movementCalls++
            if (movementCalls === 1) return firstMovement
            return page('r2', [movement('2', 'CARGO', '20.00')], 'different-cut')
        },
        getCuentaCorrienteVencimientos: async () => {
            dueCalls++
            return page(dueCalls === 1 ? 'r1' : 'r2', [], 'another-cut')
        },
    })

    const pending = store.load()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(store.consulta.revision, 'r1')
    assert.equal(store.movimientosCargando, true)
    const loadingHtml = await renderToString(createSSRApp(loadAccountView(store)))
    assert.doesNotMatch(loadingHtml, /Saldo actual/)
    releaseFirstMovement(page('r2', [movement('1', 'ABONO', '5.00')]))
    await pending

    assert.equal(summaryCalls, 2)
    assert.equal(movementCalls, 2)
    assert.equal(dueCalls, 2)
    assert.equal(store.consulta.revision, 'r2')
    assert.equal(store.movimientos.revision, 'r2')
    assert.equal(store.vencimientos.revision, 'r2')
    assert.equal(store.consultaError, '')
})

test('descarta y no muestra el resumen cuando las consultas de movimientos fallan', async () => {
    const store = createStore({ generation: 1 }, {
        getCuentaCorriente: async () => summary(),
        getCuentaCorrienteMovimientos: async () => page('r1'),
        getCuentaCorrienteVencimientos: async () => {
            throw new Error('Vencimientos no disponibles')
        },
    })

    await store.load()
    const html = await renderToString(createSSRApp(loadAccountView(store)))

    assert.equal(store.vencimientosError, 'No pudimos cargar los vencimientos. Actualizá la cuenta para reintentar.')
    assert.match(html, /No se pudieron verificar todos los datos financieros/)
    assert.doesNotMatch(html, /Saldo actual/)
    assert.doesNotMatch(html, /US\$/)
})

test('limita el reintento de revisiones inconsistentes y descarta el snapshot', async () => {
    let summaryCalls = 0
    let movementCalls = 0
    let dueCalls = 0
    const store = createStore({ generation: 1 }, {
        getCuentaCorriente: async () => summary(`r${++summaryCalls}`),
        getCuentaCorrienteMovimientos: async () => page(`m${++movementCalls}`),
        getCuentaCorrienteVencimientos: async () => page(`v${++dueCalls}`),
    })

    await store.load()

    assert.equal(summaryCalls, 2)
    assert.equal(movementCalls, 2)
    assert.equal(dueCalls, 2)
    assert.equal(store.consulta, null)
    assert.equal(store.movimientos, null)
    assert.equal(store.vencimientos, null)
    assert.match(store.consultaError, /Actualizá la cuenta/)
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
    const demoItem = movement('3', 'CARGO', '20.00', 'DEMO')
    const account = {
        consulta: summary(),
        movimientos: page('r1', [demoItem]),
        vencimientos: page('r1'),
        consultaCargando: false,
        movimientosCargando: false,
        vencimientosCargando: false,
        movimientosMasCargando: false,
        vencimientosMasCargando: false,
        consultaError: '',
        movimientosError: '',
        vencimientosError: '',
    }

    const movementHtml = await renderToString(createSSRApp(loadAccountView(account)))
    assert.match(movementHtml, /no se mostrará fuera del entorno de pruebas/)
    assert.doesNotMatch(movementHtml, /Saldo actual/)

    account.movimientos = page('r1')
    account.vencimientos = page('r1', [{
        movimientoId: '4',
        venceEl: '2026-03-02',
        plazoDias: 30,
        moneda: 'USD',
        pendiente: '20.00',
        estado: 'POR_VENCER',
        origen: 'DEMO',
    }])
    const dueHtml = await renderToString(createSSRApp(loadAccountView(account)))
    assert.match(dueHtml, /no se mostrará fuera del entorno de pruebas/)
    assert.doesNotMatch(dueHtml, /Vencimientos/)
})

test('en build de producción oculta cifras durante la carga de un origen mixto y ante errores', async () => {
    let releaseMovement
    const delayedMovement = new Promise(resolve => { releaseMovement = resolve })
    const store = createStore({ generation: 1 }, {
        getCuentaCorriente: async () => summary(),
        getCuentaCorrienteMovimientos: async () => delayedMovement,
        getCuentaCorrienteVencimientos: async () => page('r1'),
    })
    const pending = store.load()
    await new Promise(resolve => setImmediate(resolve))
    const loadingHtml = await renderToString(createSSRApp(loadAccountView(store)))
    assert.doesNotMatch(loadingHtml, /Saldo actual/)
    assert.doesNotMatch(loadingHtml, /US\$/)

    releaseMovement(page('r1', [movement('5', 'CARGO', '20.00', 'DEMO')]))
    await pending
    const mixedHtml = await renderToString(createSSRApp(loadAccountView(store)))
    assert.match(mixedHtml, /no se mostrará fuera del entorno de pruebas/)
    assert.doesNotMatch(mixedHtml, /Saldo actual/)
    assert.doesNotMatch(mixedHtml, /US\$/)

    const failed = createStore({ generation: 1 }, {
        getCuentaCorriente: async () => summary(),
        getCuentaCorrienteMovimientos: async () => page('r1'),
        getCuentaCorrienteVencimientos: async () => {
            throw new Error('Error de prueba')
        },
    })
    await failed.load()
    const failedHtml = await renderToString(createSSRApp(loadAccountView(failed)))
    assert.match(failedHtml, /No se pudieron verificar todos los datos financieros/)
    assert.doesNotMatch(failedHtml, /Saldo actual/)
    assert.doesNotMatch(failedHtml, /US\$/)
})

test('muestra cargos y abonos sin signos redundantes', async () => {
    const account = {
        consulta: summary(),
        movimientos: page('r1', [
            movement('1', 'CARGO', '20.00'),
            movement('2', 'ABONO', '5.00'),
        ]),
        vencimientos: page('r1'),
        consultaCargando: false,
        movimientosCargando: false,
        vencimientosCargando: false,
        movimientosMasCargando: false,
        vencimientosMasCargando: false,
        consultaError: '',
        movimientosError: '',
        vencimientosError: '',
    }

    const html = await renderToString(createSSRApp(loadAccountView(account)))

    assert.match(html, /Cargo/)
    assert.match(html, /Abono/)
    assert.doesNotMatch(html, /[+−-]\s*US\$/)
    assert.equal((html.match(/US\$\s*20,00/g) || []).length, 1)
    assert.equal((html.match(/US\$\s*5,00/g) || []).length, 1)
})
