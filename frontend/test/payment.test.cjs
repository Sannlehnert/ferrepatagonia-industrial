const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')
const { parse, compileScript } = require('@vue/compiler-sfc')
const { createRenderer, createSSRApp, nextTick, reactive } = require('vue')
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

function loadSfc(relativePath, dependencies = {}) {
    const filename = resolve(__dirname, '../src', relativePath)
    const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
    const componentSource = compileScript(descriptor, {
        id: relativePath.replaceAll('/', '-'),
        inlineTemplate: true,
    }).content
    const output = ts.transpileModule(componentSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText
    const componentModule = { exports: {} }
    new Function('require', 'module', 'exports', output)(
        name => dependencies[name] || require(name),
        componentModule,
        componentModule.exports,
    )
    return componentModule.exports.default
}

function loadMountableSfc(relativePath, dependencies = {}) {
    const filename = resolve(__dirname, '../src', relativePath)
    const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
    const componentSource = compileScript(descriptor, {
        id: relativePath.replaceAll('/', '-') + '-mount',
    }).content
    const output = ts.transpileModule(componentSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText
    const componentModule = { exports: {} }
    new Function('require', 'module', 'exports', output)(
        name => dependencies[name] || require(name),
        componentModule,
        componentModule.exports,
    )
    return componentModule.exports.default
}

const renderer = createRenderer({
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    insert() {},
    remove() {},
    setText() {},
    setElementText() {},
    patchProp() {},
    parentNode: () => null,
    nextSibling: () => null,
})

async function settle() {
    for (let index = 0; index < 6; index++) {
        await new Promise(resolve => setImmediate(resolve))
        await nextTick()
    }
}

function payment(overrides = {}) {
    return {
        id: 10,
        cuentaCorrienteId: 1,
        comprobanteId: '00000000-0000-4000-8000-000000000001',
        comprobanteTipoMime: 'image/png',
        comprobanteBytes: 128,
        comprobanteRevisadoEn: null,
        pedidoId: null,
        monto: '100.00',
        montoUsd: null,
        moneda: 'USD',
        observaciones: null,
        estado: 'PENDIENTE',
        estadoDocumental: 'PENDIENTE',
        motivoRevision: null,
        evidenciaAcreditacion: null,
        fecha: '2026-11-09T12:00:00.000Z',
        revisadoEn: null,
        acreditadoEn: null,
        movimientoId: null,
        movimientoEstado: null,
        movimientoMonto: null,
        ...overrides,
    }
}

const axiosStub = {
    __esModule: true,
    default: {
        isAxiosError: error => Boolean(error && error.isAxios),
    },
    isAxiosError: error => Boolean(error && error.isAxios),
}

function axiosError(status, data, withResponse = true) {
    return {
        isAxios: true,
        ...(withResponse ? { response: { status, data } } : {}),
    }
}

const accountReceipt = {
    id: '00000000-0000-4000-8000-000000000001',
    pedidoId: null,
    cuentaCorrienteId: 1,
    tipoMime: 'image/png',
    bytes: 128,
    fecha: '2026-11-09T11:00:00.000Z',
    estadoRevision: 'PENDIENTE',
    revisadoEn: null,
}

async function mountDeclarationForm(t, onDeclare) {
    const calls = []
    const events = []
    const service = {
        ...loadPaymentService({}),
        declareClientPayment: async (payload, key) => {
            calls.push({ payload, key })
            return onDeclare(payload, key, calls.length)
        },
        findClientPaymentByReceipt: async () => null,
    }
    const receipts = {
        accountReceiptsPath: '/cuenta-corriente/comprobantes',
        listPaymentReceipts: async () => ({ items: [accountReceipt], paginaSiguiente: null }),
    }
    const auth = reactive({
        user: { id: 5, tipo_cliente: 'EMPRESA' },
        rol: 'CLIENTE',
        sessionVersion: 1,
        loggingIn: false,
        loggingOut: false,
    })
    const component = loadMountableSfc('components/PaymentDeclarationForm.vue', {
        '@/components/PaymentReviewDialog.vue': { default: {} },
        '@/services/paymentReceiptService': receipts,
        '@/services/paymentService': service,
        '@/stores/auth': { useAuthStore: () => auth },
        '@/utils/cuentaCorriente': loadTypeScript('utils/cuentaCorriente.ts'),
        '@/utils/payment': loadTypeScript('utils/payment.ts'),
    })
    component.render = () => null
    const app = renderer.createApp(component, {
        refreshVersion: 0,
        onDeclared: (...args) => events.push(args),
    })
    app.mount({})
    t.after(() => app.unmount())
    await settle()
    return { state: app._instance.setupState, calls, events }
}

function prepareDeclaration(state) {
    state.selectReceipt(state.receipts[0])
    state.monto = '50.00'
    state.moneda = 'USD'
    state.reviewDeclaration()
    state.checked = true
}

test('formatea importes declarados exactos en USD y ARS sin convertir moneda', () => {
    const { formatPaymentMoney } = loadTypeScript('utils/payment.ts')

    assert.equal(formatPaymentMoney('1234.50', 'USD'), 'US$\u00a01.234,50')
    assert.equal(formatPaymentMoney('1234.50', 'ARS'), 'ARS\u00a01.234,50')
    assert.equal(formatPaymentMoney('0.00', 'USD'), 'US$\u00a00,00')
    assert.equal(formatPaymentMoney(null, 'USD'), 'No determinable')
    assert.equal(formatPaymentMoney('1e3', 'USD'), 'No determinable')
    assert.equal(formatPaymentMoney('10.00', null), 'No determinable')
})

test('valida importes con el mismo contrato que el backend', () => {
    const { isValidPaymentAmount } = loadTypeScript('utils/payment.ts')

    for (const value of ['0.01', '1', '1.2', '1.23', '9999999999.99']) {
        assert.equal(isValidPaymentAmount(value), true, value)
    }
    for (const value of ['0', '0.00', '-1.00', '01.00', '1.234', '1e3', 'abc', '']) {
        assert.equal(isValidPaymentAmount(value), false, value)
    }
})

test('suma sólo importes decimales válidos y devuelve null ante datos desconocidos', () => {
    const { sumExactDecimals } = loadTypeScript('utils/payment.ts')

    assert.equal(sumExactDecimals(['20.00', '5.55']), '25.55')
    assert.equal(sumExactDecimals([]), '0.00')
    assert.equal(sumExactDecimals(['20.00', 'no-disponible']), null)
})

test('distingue documento aprobado de pago acreditado sin inferir estados', () => {
    const {
        documentStateLabel,
        financialStateLabel,
        paymentStatusExplanation,
    } = loadTypeScript('utils/payment.ts')

    const approvedOnly = payment({ estadoDocumental: 'APROBADO', estado: 'PENDIENTE' })
    assert.equal(documentStateLabel(approvedOnly.estadoDocumental), 'Documento aprobado')
    assert.equal(financialStateLabel(approvedOnly.estado), 'Pago pendiente de acreditación')
    assert.match(paymentStatusExplanation(approvedOnly), /no acredita dinero/)

    const credited = payment({
        estadoDocumental: 'APROBADO',
        estado: 'ACREDITADO',
        montoUsd: '100.00',
        acreditadoEn: '2026-11-10T12:00:00.000Z',
    })
    assert.equal(financialStateLabel(credited.estado), 'Pago acreditado')
    assert.match(paymentStatusExplanation(credited), /abono confirmado/)
})

test('genera claves UUID v4 y las reconoce', () => {
    const { isIdempotencyKey, newIdempotencyKey } = loadTypeScript('utils/payment.ts')

    const key = newIdempotencyKey()
    assert.equal(isIdempotencyKey(key), true)
    assert.equal(key[14], '4')
    assert.match(key[19], /[89ab]/)
    assert.equal(isIdempotencyKey('no-es-uuid'), false)
    assert.equal(isIdempotencyKey(null), false)
})

function loadPaymentService(api) {
    return loadTypeScript('services/paymentService.ts', {
        axios: axiosStub,
        '@/services/api': { __esModule: true, default: api },
    })
}

test('consulta, detalla y declara pagos con la ruta y la cabecera contractuales', async () => {
    const calls = []
    const page = { items: [payment()], paginaSiguiente: null }
    const api = {
        get: async (...args) => {
            calls.push(['get', ...args])
            return { data: { data: page } }
        },
        post: async (...args) => {
            calls.push(['post', ...args])
            return { data: { data: payment(), meta: { replay: true } } }
        },
    }
    const service = loadPaymentService(api)
    const { signal } = new AbortController()

    assert.deepEqual(await service.listClientPayments(2, signal), page)
    assert.deepEqual(await service.getClientPayment(10, signal), page)
    const payload = {
        monto: '100.00',
        moneda: 'USD',
        comprobanteId: '00000000-0000-4000-8000-000000000001',
    }
    assert.deepEqual(
        await service.declareClientPayment(payload, '00000000-0000-4000-8000-000000000002', signal),
        { payment: payment(), replay: true },
    )
    assert.deepEqual(calls, [
        ['get', '/cuenta-corriente/pagos', { params: { pagina: 2 }, signal }],
        ['get', '/cuenta-corriente/pagos/10', { signal }],
        ['post', '/cuenta-corriente/pagos', payload, {
            headers: { 'Idempotency-Key': '00000000-0000-4000-8000-000000000002' },
            signal,
        }],
    ])
    assert.ok(calls.every(([, url]) => !url.includes('clienteId') && !url.includes('cuentaId')))
})

test('busca la declaración incierta por comprobante recorriendo páginas reales', async () => {
    const requested = []
    const target = payment({ id: 44 })
    const api = {
        get: async (_url, config) => {
            requested.push(config.params.pagina)
            if (config.params.pagina === 1) {
                return { data: { data: { items: [payment({ id: 43, comprobanteId: '00000000-0000-4000-8000-000000000099' })], paginaSiguiente: 2 } } }
            }
            return { data: { data: { items: [target], paginaSiguiente: null } } }
        },
    }
    const service = loadPaymentService(api)
    const result = await service.findClientPaymentByReceipt(target.comprobanteId)

    assert.deepEqual(requested, [1, 2])
    assert.equal(result.id, 44)
})

test('clasifica resultado incierto sin inventar éxito ni duplicar claves', () => {
    const service = loadPaymentService({})
    assert.equal(service.isUncertainDeclarationError(axiosError(503, { code: 'RESULTADO_DESCONOCIDO' })), true)
    assert.equal(service.isUncertainDeclarationError(axiosError(409, { code: 'CONFLICTO_CONCURRENCIA' })), true)
    assert.equal(service.isUncertainDeclarationError(axiosError(500, {})), true)
    assert.equal(service.isUncertainDeclarationError(axiosError(0, null, false)), true)
    assert.equal(service.isUncertainDeclarationError(axiosError(409, { code: 'COMPROBANTE_YA_DECLARADO' })), false)
    assert.equal(service.isUncertainDeclarationError(axiosError(400, { code: 'SOLICITUD_INVALIDA' })), false)
})

test('traduce errores contractuales sin exponer detalles internos', () => {
    const service = loadPaymentService({})

    assert.match(service.paymentErrorMessage(axiosError(404, { code: 'COMPROBANTE_NO_ENCONTRADO' }), 'fallback'), /comprobante propio/)
    assert.match(service.paymentErrorMessage(axiosError(409, { code: 'COMPROBANTE_YA_DECLARADO' }), 'fallback'), /historial de pagos/)
    assert.match(service.paymentErrorMessage(axiosError(401, {}), 'fallback'), /sesión expiró/i)
    assert.match(service.paymentErrorMessage(axiosError(403, {}), 'fallback'), /permiso/)
    assert.match(service.paymentErrorMessage(axiosError(503, { code: 'RESULTADO_DESCONOCIDO' }), 'fallback'), /misma clave|resultado/i)
    assert.equal(service.paymentErrorMessage(axiosError(500, { message: 'SQLSTATE error interno' }), 'fallback'),
        'El servidor no pudo confirmar la operación. No se generará una nueva declaración automáticamente.')
})

test('renderiza documento aprobado y pago pendiente como estados separados', async () => {
    const StatusBadges = loadSfc('components/PaymentStatusBadges.vue', {
        '@/utils/payment': loadTypeScript('utils/payment.ts'),
    })
    const html = await renderToString(createSSRApp(StatusBadges, {
        payment: payment({ estadoDocumental: 'APROBADO', estado: 'PENDIENTE' }),
    }))

    assert.match(html, /Documento aprobado/)
    assert.match(html, /Pago pendiente de acreditación/)
    assert.match(html, /no acredita dinero/)
    assert.doesNotMatch(html, /Pago acreditado/)
})

test('renderiza un pago acreditado con su importe USD confirmado', async () => {
    const StatusBadges = loadSfc('components/PaymentStatusBadges.vue', {
        '@/utils/payment': loadTypeScript('utils/payment.ts'),
    })
    const html = await renderToString(createSSRApp(StatusBadges, {
        payment: payment({
            estadoDocumental: 'APROBADO',
            estado: 'ACREDITADO',
            monto: '1000.00',
            moneda: 'ARS',
            montoUsd: '1.00',
            acreditadoEn: '2026-11-10T12:00:00.000Z',
        }),
    }))

    assert.match(html, /Pago acreditado/)
    assert.match(html, /abono confirmado/)
})

test('un timeout seguido de clave de idempotencia reutilizada libera el estado incierto', async t => {
    const { state, calls, events } = await mountDeclarationForm(t, async (_payload, _key, attempt) => {
        if (attempt === 1) throw axiosError(0, null, false)
        throw axiosError(409, {
            code: 'CLAVE_IDEMPOTENCIA_REUTILIZADA',
            message: 'La clave ya fue utilizada con otros datos.',
        })
    })
    prepareDeclaration(state)
    const key = state.idempotencyKey

    await state.sendDeclaration()
    assert.equal(state.uncertain, true)
    assert.equal(state.idempotencyKey, key)

    await state.sendDeclaration()
    assert.equal(state.uncertain, false)
    assert.equal(state.idempotencyKey, null)
    assert.equal(state.reviewed, null)
    assert.equal(state.checked, false)
    assert.equal(state.reviewVisible, false)
    assert.match(state.formError, /clave de idempotencia/i)
    assert.deepEqual(calls.map(call => call.key), [key, key])
    assert.deepEqual(events, [])
})

test('un timeout seguido de comprobante ya declarado cierra la incertidumbre y avisa al historial', async t => {
    const { state, calls, events } = await mountDeclarationForm(t, async (_payload, _key, attempt) => {
        if (attempt === 1) throw axiosError(0, null, false)
        throw axiosError(409, {
            code: 'COMPROBANTE_YA_DECLARADO',
            message: 'Ese comprobante ya tiene una declaración registrada.',
        })
    })
    prepareDeclaration(state)
    const key = state.idempotencyKey

    await state.sendDeclaration()
    await state.sendDeclaration()

    assert.equal(state.uncertain, false)
    assert.equal(state.idempotencyKey, null)
    assert.equal(state.reviewed, null)
    assert.equal(state.reviewVisible, false)
    assert.match(state.formError, /historial de pagos/)
    assert.deepEqual(calls.map(call => call.key), [key, key])
    assert.deepEqual(events, [[null]])
})

for (const [status, code, message] of [
    [400, 'SOLICITUD_INVALIDA', 'Los datos de la declaración no son válidos.'],
    [404, 'COMPROBANTE_NO_ENCONTRADO', 'No se encontró el comprobante indicado para esta cuenta.'],
]) {
    test(`un resultado incierto seguido de rechazo definitivo ${status} permite corregir el formulario`, async t => {
        const { state, calls, events } = await mountDeclarationForm(t, async (_payload, _key, attempt) => {
            if (attempt === 1) throw axiosError(undefined, null, false)
            throw axiosError(status, { code, message })
        })
        prepareDeclaration(state)
        const key = state.idempotencyKey

        await state.sendDeclaration()
        assert.equal(state.uncertain, true)

        await state.sendDeclaration()
        assert.equal(state.uncertain, false)
        assert.equal(state.idempotencyKey, null)
        assert.equal(state.reviewed, null)
        assert.equal(state.checked, false)
        assert.equal(state.reviewVisible, false)
        assert.match(state.formError, status === 404 ? /comprobante propio/ : new RegExp(message))
        assert.deepEqual(calls.map(call => call.key), [key, key])
        assert.deepEqual(events, [])
    })
}

test('un segundo error incierto conserva la misma clave y la revisión pendiente', async t => {
    const { state, calls, events } = await mountDeclarationForm(t, async (_payload, _key, attempt) => {
        if (attempt === 1) throw axiosError(undefined, null, false)
        throw axiosError(503, {
            code: 'RESULTADO_DESCONOCIDO',
            message: 'No se pudo confirmar el resultado.',
        })
    })
    prepareDeclaration(state)
    const key = state.idempotencyKey

    await state.sendDeclaration()
    await state.sendDeclaration()

    assert.equal(state.uncertain, true)
    assert.equal(state.idempotencyKey, key)
    assert.notEqual(state.reviewed, null)
    assert.equal(state.checked, true)
    assert.match(state.formError, /No generamos una nueva declaración/)
    assert.deepEqual(calls.map(call => call.key), [key, key])
    assert.deepEqual(events, [])
})

test('una respuesta perdida recuperada como replay no crea una segunda declaración', async t => {
    const { state, calls, events } = await mountDeclarationForm(t, async (_payload, _key, attempt) => {
        if (attempt === 1) throw axiosError(0, null, false)
        return { payment: payment({ id: 99 }), replay: true }
    })
    prepareDeclaration(state)
    const key = state.idempotencyKey

    await state.sendDeclaration()
    assert.equal(state.uncertain, true)

    await state.sendDeclaration()
    assert.equal(state.uncertain, false)
    assert.equal(state.idempotencyKey, null)
    assert.match(state.notice, /No se creó un pago duplicado/)
    assert.deepEqual(calls.map(call => call.key), [key, key])
    assert.deepEqual(events, [[99]])
})
