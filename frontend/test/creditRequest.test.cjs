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

function loadCreditRequestPanel(auth, services) {
    const filename = resolve(__dirname, '../src/components/CreditRequestPanel.vue')
    const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
    const source = compileScript(descriptor, {
        id: 'credit-request-test',
        inlineTemplate: true,
    }).content
    const output = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText
    const module = { exports: {} }
    const dependencies = {
        '@/stores/auth': { useAuthStore: () => auth },
        '@/services/creditRequestService': services,
        '@/utils/cuentaCorriente': loadTypeScript('utils/cuentaCorriente.ts'),
    }

    new Function('require', 'module', 'exports', output)(
        name => dependencies[name] || require(name),
        module,
        module.exports,
    )
    return module.exports.default
}

test('consulta solicitudes propias y envía la clave de idempotencia al crear', async () => {
    const calls = []
    const request = { id: 8, estado: 'PENDIENTE' }
    const api = {
        get: async (...args) => {
            calls.push(['get', ...args])
            return { data: { data: { items: [request], siguienteAntesDeId: null } } }
        },
        post: async (...args) => {
            calls.push(['post', ...args])
            return { data: { data: { solicitud: request } } }
        },
    }
    const service = loadTypeScript('services/creditRequestService.ts', {
        axios: { __esModule: true, default: { isAxiosError: () => false } },
        '@/services/api': { __esModule: true, default: api },
    })

    assert.deepEqual(await service.getClientCreditRequests(), [request])
    assert.deepEqual(await service.createClientCreditRequest(
        { montoSolicitado: '1250.00', plazoDias: 30, observaciones: 'Reposición' },
        '123e4567-e89b-42d3-a456-426614174000',
    ), request)
    assert.deepEqual(calls, [
        ['get', '/cuenta-corriente/solicitudes', { params: { limite: 25 }, signal: undefined }],
        ['post', '/cuenta-corriente/solicitudes',
            { montoSolicitado: '1250.00', plazoDias: 30, observaciones: 'Reposición' },
            { headers: { 'Idempotency-Key': '123e4567-e89b-42d3-a456-426614174000' } }],
    ])
    assert.ok(calls.every(call => !JSON.stringify(call).includes('clienteId')))
})

test('no consulta solicitudes ni ofrece formulario a empresas no aprobadas', async () => {
    for (const [status, message] of [
        ['PENDIENTE', /aprobación comercial está pendiente/],
        ['RECHAZADA', /aprobación comercial fue rechazada/],
    ]) {
        let requestsRead = false
        const panel = loadCreditRequestPanel({
            user: { id: 7, tipo_cliente: 'EMPRESA', estadoAprobacionEmpresa: status },
            sessionVersion: 1,
        }, {
            getClientCreditRequests: async () => {
                requestsRead = true
                return []
            },
        })

        const html = await renderToString(createSSRApp(panel, { refreshVersion: 0 }))

        assert.match(html, message)
        assert.match(html, /no es elegible/)
        assert.doesNotMatch(html, /Solicitar crédito/)
        assert.equal(requestsRead, false)
    }
})

test('muestra la advertencia de evaluación manual y el estado habilitado no se promete', () => {
    const source = readFileSync(
        resolve(__dirname, '../src/components/CreditRequestPanel.vue'),
        'utf8',
    )

    assert.match(source, /no implica aprobación ni habilitación automática/)
    assert.match(source, /Consultá el estado comercial para verificar si la cuenta está habilitada/)
    assert.match(source, /La solicitud fue rechazada/)
    assert.match(source, /Ya hay una solicitud pendiente/)
    assert.match(source, /no es elegible para solicitar crédito/)
})
