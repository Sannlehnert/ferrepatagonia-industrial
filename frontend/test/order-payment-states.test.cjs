const assert = require('node:assert/strict')
const { describe, test } = require('node:test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')
const { parse, compileScript } = require('@vue/compiler-sfc')
const { createRenderer, createSSRApp, effectScope, h, nextTick, reactive, ref } = require('vue')
const { renderToString } = require('@vue/server-renderer')

function loadTypeScript(relativePath, dependencies = {}) {
  const source = readFileSync(resolve(__dirname, '../src', relativePath), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)(
    name => dependencies[name] || require(name),
    mod,
    mod.exports,
  )
  return mod.exports
}

function loadSfc(relativePath, dependencies = {}, inlineTemplate = true) {
  const filename = resolve(__dirname, '../src', relativePath)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const compiled = compileScript(descriptor, {
    id: `${relativePath.replaceAll('/', '-')}-${inlineTemplate ? 'ssr' : 'mount'}`,
    inlineTemplate,
  }).content
  const output = ts.transpileModule(compiled, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)(
    name => dependencies[name] || require(name),
    mod,
    mod.exports,
  )
  return mod.exports.default
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
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setImmediate(r))
    await nextTick()
  }
}

const paymentUtils = loadTypeScript('utils/payment.ts')
const cuentaUtils = loadTypeScript('utils/cuentaCorriente.ts')
const deferredRealtime = loadTypeScript('composables/useDeferredRealtimeReconcile.ts')
const privateAccountRead = loadTypeScript('composables/usePrivateAccountRead.ts')
const accountFilters = loadTypeScript('utils/accountFilters.ts')
const receiptService = loadTypeScript('services/paymentReceiptService.ts', {
  './api': { __esModule: true, default: {} },
})
const adminOrderService = loadTypeScript('services/adminOrderService.ts', {
  './api': { __esModule: true, default: {} },
})

describe('Task #318 (T-S7-04.3) — Fuente única de verdad de los tres dominios', () => {
  test('estados comerciales del pedido nunca se etiquetan como Pagado y coinciden entre Mi Cuenta y ADMIN', () => {
    const expected = {
      CONFIRMADO: 'Confirmado',
      EN_PREPARACION: 'En preparación',
      ENVIADO: 'Enviado',
      ENTREGADO: 'Entregado',
      DEMO_REGISTRADO: 'Registrado (DEMO)',
    }
    for (const [state, label] of Object.entries(expected)) {
      const badge = paymentUtils.orderCommercialStateBadge(state)
      assert.equal(badge.label, label)
      assert.equal(adminOrderService.formatAdminOrderStatus(state), label)
      assert.doesNotMatch(badge.label, /pagado/i)
      assert.ok(badge.badgeClasses.includes('border'))
      assert.ok(badge.dotClasses.startsWith('bg-'))
    }
  })

  test('estados documentales distinguen pendiente, aprobado, rechazado y sin comprobante con color + texto', () => {
    assert.deepEqual(paymentUtils.orderDocumentStateBadge('APROBADO'), {
      label: 'Aprobado',
      badgeClasses: 'bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0]',
      dotClasses: 'bg-[#16A34A]',
    })
    assert.deepEqual(paymentUtils.orderDocumentStateBadge('PENDIENTE'), {
      label: 'Pendiente de revisión',
      badgeClasses: 'bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]',
      dotClasses: 'bg-[#B45309]',
    })
    assert.deepEqual(paymentUtils.orderDocumentStateBadge('RECHAZADO'), {
      label: 'Rechazado',
      badgeClasses: 'bg-[#FEE2E2] text-[#B91C1C] border border-[#FECACA]',
      dotClasses: 'bg-[#DC2626]',
    })
    assert.deepEqual(paymentUtils.orderDocumentStateBadge('SIN_COMPROBANTE'), {
      label: 'Sin comprobante',
      badgeClasses: 'bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0]',
      dotClasses: 'bg-[#64748B]',
    })
    assert.equal(
      paymentUtils.orderDocumentStateBadge('SIN_COMPROBANTE', { emptyLabel: 'No adjunto' }).label,
      'No adjunto',
    )
    assert.equal(
      paymentUtils.orderDocumentStateBadge(undefined).label,
      'Estado documental no determinable',
    )
  })

  test('estados financieros cubren TRANSFERENCIA y CUENTA_CORRIENTE según §7.1 sin falsos pagados', () => {
    const cases = [
      ['NO_DETERMINABLE', 'Estado financiero no determinable', 'bg-[#F1F5F9]'],
      ['SIN_PAGO_ACREDITADO', 'Sin pago acreditado', 'bg-[#FEF3C7]'],
      ['PAGO_PARCIAL', 'Pago parcial acreditado', 'bg-[#E0F2FE]'],
      ['ACREDITADO', 'Pago acreditado', 'bg-[#DCFCE7]'],
      ['CARGO_ANULADO', 'Cargo anulado', 'bg-[#FEE2E2]'],
      ['CARGO_PENDIENTE', 'Imputado a cuenta corriente — pendiente de cancelación', 'bg-[#FEF3C7]'],
      ['IMPUTADO_PARCIAL', 'Cancelado parcialmente en CC', 'bg-[#E0F2FE]'],
      ['CANCELADO_EN_CC', 'Cancelado en cuenta corriente', 'bg-[#DCFCE7]'],
    ]

    for (const [state, expectedLabel, expectedBg] of cases) {
      const badge = paymentUtils.orderFinancialStateBadge(state)
      assert.equal(badge.label, expectedLabel)
      assert.ok(badge.badgeClasses.includes(expectedBg), `${state}: ${badge.badgeClasses}`)
      assert.ok(badge.badgeClasses.includes('border'))
      assert.doesNotMatch(badge.label, /\bPagado\b/i)
    }

    assert.equal(paymentUtils.orderFinancialStateBadge(null).label, 'Estado financiero no determinable')
    assert.equal(paymentUtils.formatAccreditedUsdSummary('NO_DETERMINABLE', null), null)
    assert.equal(paymentUtils.formatAccreditedUsdSummary('SIN_PAGO_ACREDITADO', '0.00'), null)
    assert.equal(paymentUtils.formatAccreditedUsdSummary('CARGO_PENDIENTE', '0.00'), null)
    assert.match(paymentUtils.formatAccreditedUsdSummary('PAGO_PARCIAL', '50.00'), /Acreditado: US\$\s*50,00/)
    assert.match(paymentUtils.formatAccreditedUsdSummary('CANCELADO_EN_CC', '120.00'), /Cancelado en CC: US\$\s*120,00/)
  })
})

describe('Task #318 (T-S7-04.3) — Renderizado SSR de badges y separación de dominios', () => {
  test('AdminOrderReceiptSummary nunca muestra verde ni Revisados cuando estadoDocumental es RECHAZADO', async () => {
    const Component = loadSfc('components/AdminOrderReceiptSummary.vue', {
      '@/utils/payment': paymentUtils,
    })

    const rejectedHtml = await renderToString(createSSRApp(Component, {
      estadoDocumental: 'RECHAZADO',
      summary: { total: 1, pendientesRevision: 0 },
    }))
    assert.match(rejectedHtml, /Rechazado/)
    assert.match(rejectedHtml, /bg-\[#FEE2E2\]/)
    assert.match(rejectedHtml, /text-\[#B91C1C\]/)
    assert.doesNotMatch(rejectedHtml, /Revisados/)
    assert.doesNotMatch(rejectedHtml, /bg-\[#DCFCE7\]/)

    const pendingHtml = await renderToString(createSSRApp(Component, {
      estadoDocumental: 'PENDIENTE',
      summary: { total: 2, pendientesRevision: 1 },
    }))
    assert.match(pendingHtml, /Pendiente de revisión/)
    assert.match(pendingHtml, /bg-\[#FEF3C7\]/)
    assert.match(pendingHtml, /2 comprobantes/)
    assert.match(pendingHtml, /1 pendiente/)

    const approvedHtml = await renderToString(createSSRApp(Component, {
      estadoDocumental: 'APROBADO',
      summary: { total: 1, pendientesRevision: 0 },
    }))
    assert.match(approvedHtml, /Aprobado/)
    assert.match(approvedHtml, /bg-\[#DCFCE7\]/)

    const emptyHtml = await renderToString(createSSRApp(Component, {
      estadoDocumental: 'SIN_COMPROBANTE',
      summary: { total: 0, pendientesRevision: 0 },
    }))
    assert.match(emptyHtml, /Sin comprobante/)
    assert.match(emptyHtml, /bg-\[#F1F5F9\]/)

    // Fallback seguro sin estadoDocumental y con pendientesRevision=0: no inventa Aprobado.
    const unknownHtml = await renderToString(createSSRApp(Component, {
      summary: { total: 1, pendientesRevision: 0 },
    }))
    assert.match(unknownHtml, /Estado documental no determinable/)
    assert.doesNotMatch(unknownHtml, /Aprobado|Revisados/)
  })

  test('OrderFinancialStatusBadge renderiza color + texto y explicación sin falsos Pagados', async () => {
    const Component = loadSfc('components/OrderFinancialStatusBadge.vue', {
      '@/utils/payment': paymentUtils,
    })

    const htmlUncredited = await renderToString(createSSRApp(Component, {
      status: 'SIN_PAGO_ACREDITADO',
      montoAcreditadoUsd: '0.00',
      documentStatus: 'APROBADO',
      showExplanation: true,
    }))
    assert.match(htmlUncredited, /Sin pago acreditado/)
    assert.match(htmlUncredited, /bg-\[#FEF3C7\]/)
    assert.match(htmlUncredited, /todavía no fue acreditado/)
    assert.doesNotMatch(htmlUncredited, /Pago acreditado|\bPagado\b/)

    const htmlPartial = await renderToString(createSSRApp(Component, {
      status: 'PAGO_PARCIAL',
      montoAcreditadoUsd: '45.50',
      showExplanation: true,
    }))
    assert.match(htmlPartial, /Pago parcial acreditado/)
    assert.match(htmlPartial, /bg-\[#E0F2FE\]/)
    assert.match(htmlPartial, /Acreditado: US\$\s*45,50/)

    const htmlCcPending = await renderToString(createSSRApp(Component, {
      status: 'CARGO_PENDIENTE',
      montoAcreditadoUsd: '0.00',
      showExplanation: true,
    }))
    assert.match(htmlCcPending, /Imputado a cuenta corriente — pendiente de cancelación/)
    assert.match(htmlCcPending, /bg-\[#FEF3C7\]/)

    const htmlCcAnnulled = await renderToString(createSSRApp(Component, {
      status: 'CARGO_ANULADO',
      montoAcreditadoUsd: '0.00',
      showExplanation: true,
    }))
    assert.match(htmlCcAnnulled, /Cargo anulado/)
    assert.match(htmlCcAnnulled, /bg-\[#FEE2E2\]/)
  })

  test('ClientOrderDetail muestra los tres dominios separados y coherentes con el listado', async () => {
    const AdminOrderStatusBadge = loadSfc('components/AdminOrderStatusBadge.vue', {
      '@/utils/payment': paymentUtils,
    })
    const OrderFinancialStatusBadge = loadSfc('components/OrderFinancialStatusBadge.vue', {
      '@/utils/payment': paymentUtils,
    })

    async function renderDetail(orderDetail) {
      const ClientOrderDetail = loadSfc('components/ClientOrderDetail.vue', {
        '@/components/AdminOrderStatusBadge.vue': { __esModule: true, default: AdminOrderStatusBadge },
        '@/components/OrderFinancialStatusBadge.vue': { __esModule: true, default: OrderFinancialStatusBadge },
        '@/components/OrderPaymentReceipts.vue': { __esModule: true, default: { render: () => h('div', { 'data-receipts': '' }) } },
        '@/composables/useDeferredRealtimeReconcile': deferredRealtime,
        '@/composables/usePrivateAccountRead': {
          usePrivateAccountRead: () => ({
            data: ref(orderDetail),
            loading: ref(false),
            error: ref(null),
            load: async () => {},
          }),
        },
        '@/services/clientOrderService': { getClientOrderDetail: async () => orderDetail },
        '@/services/paymentReceiptService': receiptService,
        '@/services/realtime': { onRealtime() {} },
        '@/stores/auth': {
          useAuthStore: () => ({
            rol: 'CLIENTE',
            loggingIn: false,
            loggingOut: false,
            sessionVersion: 1,
            user: {
              id: 7,
              tipo_cliente: 'EMPRESA',
              estadoAprobacionEmpresa: 'APROBADA',
              cuentaCorrienteHabilitada: true,
            },
          }),
        },
        '@/utils/cuentaCorriente': cuentaUtils,
        '@/utils/payment': paymentUtils,
      })

      return renderToString(createSSRApp(ClientOrderDetail, { orderId: orderDetail.pedidoId }))
    }

    // Caso 1: Pedido ENTREGADO + comprobante APROBADO + SIN_PAGO_ACREDITADO -> jamas "Pagado"
    const deliveredUncreditedHtml = await renderDetail({
      pedidoId: 41,
      numero: 'PED-000041',
      fecha: '2026-11-20T12:00:00.000Z',
      estado: 'ENTREGADO',
      estadoPedido: 'ENTREGADO',
      estadoDocumental: 'APROBADO',
      estadoFinanciero: 'SIN_PAGO_ACREDITADO',
      montoAcreditadoUSD: '0.00',
      modalidadPago: 'TRANSFERENCIA',
      moneda: 'USD',
      subtotal: '150.00',
      descuento: '0.00',
      total: '150.00',
      totalUSD: '150.00',
      cantidadLineas: 1,
      cantidadUnidades: 1,
      items: [],
    })
    assert.match(deliveredUncreditedHtml, /Entregado/)
    assert.match(deliveredUncreditedHtml, /Aprobado/)
    assert.match(deliveredUncreditedHtml, /Sin pago acreditado/)
    assert.match(deliveredUncreditedHtml, /el pago todavía no fue acreditado/)
    assert.doesNotMatch(deliveredUncreditedHtml, /Pago acreditado|\bPagado\b/)

    // Caso 2: Pedido TRANSFERENCIA con comprobante RECHAZADO
    const rejectedReceiptHtml = await renderDetail({
      pedidoId: 42,
      numero: 'PED-000042',
      fecha: '2026-11-20T12:00:00.000Z',
      estado: 'CONFIRMADO',
      estadoPedido: 'CONFIRMADO',
      estadoDocumental: 'RECHAZADO',
      estadoFinanciero: 'SIN_PAGO_ACREDITADO',
      montoAcreditadoUSD: '0.00',
      modalidadPago: 'TRANSFERENCIA',
      moneda: 'USD',
      subtotal: '80.00',
      descuento: '0.00',
      total: '80.00',
      totalUSD: '80.00',
      cantidadLineas: 1,
      cantidadUnidades: 1,
      items: [],
    })
    assert.match(rejectedReceiptHtml, /Confirmado/)
    assert.match(rejectedReceiptHtml, /Rechazado/)
    assert.match(rejectedReceiptHtml, /bg-\[#FEE2E2\]/)
    assert.match(rejectedReceiptHtml, /Sin pago acreditado/)

    // Caso 3: Pedido CUENTA_CORRIENTE con CARGO_PENDIENTE y vencimiento
    const creditPendingHtml = await renderDetail({
      pedidoId: 43,
      numero: 'PED-000043',
      fecha: '2026-11-20T12:00:00.000Z',
      estado: 'EN_PREPARACION',
      estadoPedido: 'EN_PREPARACION',
      estadoDocumental: 'SIN_COMPROBANTE',
      estadoFinanciero: 'CARGO_PENDIENTE',
      montoAcreditadoUSD: '0.00',
      modalidadPago: 'CUENTA_CORRIENTE',
      moneda: 'USD',
      subtotal: '200.00',
      descuento: '0.00',
      total: '200.00',
      totalUSD: '200.00',
      venceEl: '2026-12-20',
      cantidadLineas: 1,
      cantidadUnidades: 1,
      items: [],
    })
    assert.match(creditPendingHtml, /En preparación/)
    assert.match(creditPendingHtml, /No adjunto/)
    assert.match(creditPendingHtml, /Imputado a cuenta corriente — pendiente de cancelación/)
    assert.match(creditPendingHtml, /Vencimiento del cargo:/)

    // Caso 4: Pedido DEMO_DIRECTO sin comprobantes -> paridad con listado ("No disponible para esta modalidad")
    const demoHtml = await renderDetail({
      pedidoId: 44,
      numero: 'PED-000044',
      fecha: '2026-11-20T12:00:00.000Z',
      estado: 'DEMO_REGISTRADO',
      estadoPedido: 'DEMO_REGISTRADO',
      estadoDocumental: 'SIN_COMPROBANTE',
      estadoFinanciero: 'NO_DETERMINABLE',
      montoAcreditadoUSD: '0.00',
      modalidadPago: 'DEMO_DIRECTO',
      moneda: 'USD',
      subtotal: '50.00',
      descuento: '0.00',
      total: '50.00',
      totalUSD: '50.00',
      cantidadLineas: 1,
      cantidadUnidades: 1,
      items: [],
    })
    assert.match(demoHtml, /No disponible para esta modalidad/)
  })
})

describe('Task #318 (T-S7-04.3) — Comprobantes: pendiente, aprobado, rechazado con motivo y revisión ADMIN', () => {
  const sampleReceipts = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      clienteId: 10,
      cliente: 'Constructora Patagónica S.A.',
      pedidoId: 5,
      cuentaCorrienteId: null,
      tipoMime: 'application/pdf',
      bytes: 1024,
      fecha: '2026-11-20T12:00:00.000Z',
      estadoRevision: 'PENDIENTE',
      revisadoEn: null,
      motivoRechazo: null,
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      clienteId: 10,
      cliente: 'Constructora Patagónica S.A.',
      pedidoId: 6,
      cuentaCorrienteId: null,
      tipoMime: 'image/png',
      bytes: 2048,
      fecha: '2026-11-20T13:00:00.000Z',
      estadoRevision: 'APROBADO',
      revisadoEn: '2026-11-20T14:00:00.000Z',
      motivoRechazo: null,
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      clienteId: 10,
      cliente: 'Constructora Patagónica S.A.',
      pedidoId: 7,
      cuentaCorrienteId: null,
      tipoMime: 'image/jpeg',
      bytes: 512,
      fecha: '2026-11-20T15:00:00.000Z',
      estadoRevision: 'RECHAZADO',
      revisadoEn: '2026-11-20T16:00:00.000Z',
      motivoRechazo: 'Imagen borrosa e importe ilegible',
    },
  ]

  test('PaymentReceipts renderiza pendiente, aprobado y rechazado con color + texto y motivo de rechazo', async () => {
    const receiptService = loadTypeScript('services/paymentReceiptService.ts', {
      './api': { __esModule: true, default: {} },
    })

    for (const mode of ['pedido', 'admin']) {
      const Component = loadSfc('components/PaymentReceipts.vue', {
        axios: { isAxiosError: () => false },
        '@/composables/useDeferredRealtimeReconcile': deferredRealtime,
        '@/composables/usePrivateAccountRead': {
          usePrivateAccountRead: () => ({
            data: ref({ items: sampleReceipts, paginaSiguiente: null }),
            loading: ref(false),
            error: ref(null),
            load: async () => {},
          }),
        },
        '@/services/paymentReceiptService': receiptService,
        '@/services/realtime': { onRealtime() {} },
        '@/stores/auth': {
          useAuthStore: () => ({
            isAuthenticated: true,
            rol: mode === 'admin' ? 'ADMIN' : 'CLIENTE',
            loggingIn: false,
            loggingOut: false,
            sessionVersion: 1,
            user: { id: 1 },
          }),
        },
        '@/utils/cuentaCorriente': cuentaUtils,
        '@/utils/payment': paymentUtils,
      })

      const html = await renderToString(createSSRApp(Component, {
        path: mode === 'admin' ? '/admin/comprobantes' : '/pedidos/5/comprobantes',
        mode,
      }))

      assert.match(html, /Pendiente de revisión/)
      assert.match(html, /bg-\[#FEF3C7\]/)
      assert.match(html, /Aprobado/)
      assert.match(html, /bg-\[#DCFCE7\]/)
      assert.match(html, /Rechazado/)
      assert.match(html, /bg-\[#FEE2E2\]/)
      assert.match(html, /Motivo de rechazo:/)
      assert.match(html, /Imagen borrosa e importe ilegible/)
      assert.match(html, /No implica acreditación financiera/)

      if (mode === 'admin') {
        assert.match(html, /Aprobar comprobante/)
        assert.match(html, /Rechazar comprobante/)
      } else {
        assert.match(html, /Podés adjuntar un nuevo comprobante/)
      }
    }
  })

  test('ADMIN puede rechazar un comprobante PENDIENTE exigiendo motivo y enviando Idempotency-Key UUID v4', async t => {
    const calls = []
    const receiptService = {
      ...loadTypeScript('services/paymentReceiptService.ts', {
        './api': { __esModule: true, default: {} },
      }),
      listPaymentReceipts: async () => ({ items: sampleReceipts, paginaSiguiente: null }),
      markPaymentReceiptReviewed: async (...args) => {
        calls.push(args)
      },
    }

    const Component = loadSfc('components/PaymentReceipts.vue', {
      axios: { isAxiosError: () => false },
      '@/composables/useDeferredRealtimeReconcile': deferredRealtime,
      '@/composables/usePrivateAccountRead': {
        usePrivateAccountRead: () => {
          const data = ref(null)
          return {
            data,
            loading: ref(false),
            error: ref(null),
            load: async loader => { data.value = await loader(new AbortController().signal) },
          }
        },
      },
      '@/services/paymentReceiptService': receiptService,
      '@/services/realtime': { onRealtime() {} },
      '@/stores/auth': {
        useAuthStore: () => reactive({
          isAuthenticated: true,
          rol: 'ADMIN',
          loggingIn: false,
          loggingOut: false,
          sessionVersion: 1,
          user: { id: 1 },
        }),
      },
      '@/utils/cuentaCorriente': cuentaUtils,
      '@/utils/payment': paymentUtils,
    }, false)

    Component.render = () => null
    const app = renderer.createApp(Component, { path: '/admin/comprobantes', mode: 'admin' })
    app.mount({})
    t.after(() => app.unmount())
    await settle()

    const state = app._instance.setupState
    state.openRejectForm(sampleReceipts[0].id)
    state.rejectReason = '   '
    state.confirmReject(sampleReceipts[0].id)
    await settle()
    assert.equal(calls.length, 0)
    assert.match(state.rejectValidationError, /motivo de rechazo/i)

    state.rejectReason = 'Monto no coincide con la transferencia'
    state.confirmReject(sampleReceipts[0].id)
    await settle()

    assert.equal(calls.length, 1)
    const [path, id, _signal, decision, key] = calls[0]
    assert.equal(path, '/admin/comprobantes')
    assert.equal(id, sampleReceipts[0].id)
    assert.deepEqual(decision, {
      estado: 'RECHAZADO',
      motivo: 'Monto no coincide con la transferencia',
    })
    assert.equal(paymentUtils.isIdempotencyKey(key), true)
    assert.equal(state.rejectingReceiptId, null)
  })
})

describe('Task #318 (T-S7-04.3) — Coherencia estructural de vistas y eventos Socket.IO (§8)', () => {
  test('vistas de Mi Cuenta y ADMIN eliminan heurísticas heredadas y comparten los tres dominios', () => {
    const historial = readFileSync(resolve(__dirname, '../src/views/cuenta/HistorialPedidos.vue'), 'utf8')
    const dashboardClient = readFileSync(resolve(__dirname, '../src/views/cuenta/MiCuentaDashboardView.vue'), 'utf8')
    const adminOrders = readFileSync(resolve(__dirname, '../src/views/admin/AdminOrdersView.vue'), 'utf8')
    const adminDashboard = readFileSync(resolve(__dirname, '../src/components/AdminDashboardOrders.vue'), 'utf8')
    const paymentReceipts = readFileSync(resolve(__dirname, '../src/components/PaymentReceipts.vue'), 'utf8')

    // Sin localStorage ni inferencias de estado documental a partir de PEDIDO.estado
    for (const source of [historial, dashboardClient, adminOrders, adminDashboard, paymentReceipts]) {
      assert.doesNotMatch(source, /localStorage/)
    }
    assert.doesNotMatch(dashboardClient, /estado\s*===\s*'PENDIENTE'/)
    assert.match(dashboardClient, /estadoDocumental\s*===\s*'SIN_COMPROBANTE'/)

    // HistorialPedidos usa los estados contractuales reales en filtro-estado (sin PENDIENTE/CANCELADO)
    const statusFilterBlock = historial.slice(
      historial.indexOf('id="filtro-estado"'),
      historial.indexOf('id="filtro-financiero"'),
    )
    assert.match(statusFilterBlock, /value="CONFIRMADO"/)
    assert.match(statusFilterBlock, /value="EN_PREPARACION"/)
    assert.match(statusFilterBlock, /value="ENVIADO"/)
    assert.match(statusFilterBlock, /value="ENTREGADO"/)
    assert.match(statusFilterBlock, /value="DEMO_REGISTRADO"/)
    assert.doesNotMatch(statusFilterBlock, /value="PENDIENTE"|value="CANCELADO"/)

    // Mi Cuenta y ADMIN consumen los mismos componentes para los 3 dominios
    for (const source of [historial, adminOrders, adminDashboard]) {
      assert.match(source, /AdminOrderStatusBadge/)
      assert.match(source, /OrderFinancialStatusBadge/)
      assert.match(source, /onRealtime/)
    }
    for (const source of [adminOrders, adminDashboard]) {
      assert.match(source, /:estado-documental="order\.estadoDocumental"/)
    }
    assert.match(adminOrders, /:estado-documental="selectedOrder\.estadoDocumental"/)
    assert.doesNotMatch(paymentReceipts, /<style\b/)
  })

  test('realtime.ts procesa y deduplica pedido.estado.actualizado.v1, comprobante.estado.actualizado.v1 y pago.acreditado.v1', async () => {
    const handlers = new Map()
    const fakeSocket = {
      on(event, fn) { handlers.set(event, fn) },
      connect() { handlers.get('connect')?.() },
      removeAllListeners() { handlers.clear() },
      disconnect() {},
    }
    const realtime = loadTypeScript('services/realtime.ts', {
      'socket.io-client': { io: () => fakeSocket },
    })

    const received = []
    const scope = effectScope()
    const auth = reactive({
      sessionChecked: true,
      sessionError: false,
      loggingIn: false,
      loggingOut: false,
      sessionVersion: 1,
      user: { id: 1, rol: 'ADMIN' },
      $onAction: () => () => {},
      clear() {},
      fetchSession: async () => true,
    })

    scope.run(() => {
      realtime.onRealtime(change => received.push(change))
      realtime.startRealtime(auth)
    })
    await settle()

    const ts1 = '2026-11-22T09:00:00.000Z'
    const orderStatusPayload = {
      version: 1,
      idEvento: `pedido.estado.actualizado.v1:12:EN_PREPARACION:${ts1}`,
      pedidoId: 12,
      estadoAnterior: 'CONFIRMADO',
      estadoNuevo: 'EN_PREPARACION',
      actualizadoEn: ts1,
    }
    // Emitido dos veces: debe deduplicarse
    handlers.get('pedido.estado.actualizado.v1')(orderStatusPayload)
    handlers.get('pedido.estado.actualizado.v1')(orderStatusPayload)

    // Payload inválido (estado PAGADO no permitido) debe ignorarse
    handlers.get('pedido.estado.actualizado.v1')({
      version: 1,
      idEvento: `pedido.estado.actualizado.v1:99:PAGADO:${ts1}`,
      pedidoId: 99,
      estadoAnterior: 'CONFIRMADO',
      estadoNuevo: 'PAGADO',
      actualizadoEn: ts1,
    })

    handlers.get('comprobante.estado.actualizado.v1')({
      version: 1,
      idEvento: 'comprobante.estado.actualizado.v1:11111111-1111-4111-8111-111111111111:RECHAZADO',
      comprobanteId: '11111111-1111-4111-8111-111111111111',
      pedidoId: 15,
      cuentaCorrienteId: null,
      estadoDocumental: 'RECHAZADO',
      actualizadoEn: ts1,
    })

    handlers.get('pago.acreditado.v1')({
      version: 1,
      idEvento: `pago.acreditado.v1:77:ACREDITADO:${ts1}`,
      pagoId: 77,
      pedidoId: null,
      cuentaCorrienteId: 3,
      estadoPago: 'ACREDITADO',
      montoUSD: '100.00',
      revisionCuenta: 'rev-2',
      actualizadoEn: ts1,
    })

    await new Promise(r => setTimeout(r, 60))
    scope.stop()

    assert.equal(received.length, 1)
    assert.deepEqual([...received[0].orders].sort((a, b) => a - b), [12, 15])
    assert.equal(received[0].receipts, true)
    assert.equal(received[0].payments, true)
    assert.equal(received[0].account, true)
  })
})

describe('Task #318 (S7-318-R02) — Reconciliación diferida en ventana de supresión Socket.IO', () => {
  const emptyChange = (overrides = {}) => ({
    cart: false,
    products: new Set(),
    orders: new Set(),
    receipts: false,
    payments: false,
    account: false,
    reconnect: false,
    ...overrides,
  })

  test('PaymentReceipts reconcilia automáticamente un evento dentro de los 800 ms sin requerir un segundo evento (escenario Bruno)', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
    t.after(() => t.mock.timers.reset())

    const receiptA = {
      id: 'aaaa1111-1111-4111-8111-111111111111',
      clienteId: 10,
      cliente: 'Constructora Patagónica S.A.',
      pedidoId: 5,
      cuentaCorrienteId: null,
      tipoMime: 'application/pdf',
      bytes: 1024,
      fecha: '2026-11-20T12:00:00.000Z',
      estadoRevision: 'PENDIENTE',
      revisadoEn: null,
      motivoRechazo: null,
    }
    const receiptB = {
      id: 'bbbb2222-2222-4222-8222-222222222222',
      clienteId: 10,
      cliente: 'Constructora Patagónica S.A.',
      pedidoId: 6,
      cuentaCorrienteId: null,
      tipoMime: 'image/png',
      bytes: 2048,
      fecha: '2026-11-20T13:00:00.000Z',
      estadoRevision: 'PENDIENTE',
      revisadoEn: null,
      motivoRechazo: null,
    }

    let serverReceipts = [
      { ...receiptA },
      { ...receiptB },
    ]
    let listCalls = 0
    let realtimeHandler

    const Component = loadSfc('components/PaymentReceipts.vue', {
      axios: { isAxiosError: () => false },
      '@/composables/useDeferredRealtimeReconcile': deferredRealtime,
      '@/composables/usePrivateAccountRead': privateAccountRead,
      '@/services/paymentReceiptService': {
        ...receiptService,
        listPaymentReceipts: async () => {
          listCalls++
          return { items: serverReceipts.map(item => ({ ...item })), paginaSiguiente: null }
        },
        markPaymentReceiptReviewed: async (_path, id) => {
          assert.equal(id, receiptA.id)
          serverReceipts = [
            { ...receiptA, estadoRevision: 'APROBADO', revisadoEn: '2026-11-20T14:00:00.000Z' },
            { ...serverReceipts[1] },
          ]
        },
      },
      '@/services/realtime': { onRealtime: handler => { realtimeHandler = handler } },
      '@/stores/auth': {
        useAuthStore: () => reactive({
          isAuthenticated: true,
          rol: 'ADMIN',
          loggingIn: false,
          loggingOut: false,
          sessionVersion: 1,
          user: { id: 1 },
        }),
      },
      '@/utils/cuentaCorriente': cuentaUtils,
      '@/utils/payment': paymentUtils,
    }, false)

    Component.render = () => null
    const app = renderer.createApp(Component, { path: '/admin/comprobantes', mode: 'admin' })
    app.mount({})
    t.after(() => app.unmount())
    await settle()

    const state = app._instance.setupState
    assert.equal(listCalls, 1)
    assert.equal(state.data.items[0].estadoRevision, 'PENDIENTE')
    assert.equal(state.data.items[1].estadoRevision, 'PENDIENTE')

    // Paso 1: ADMIN aprueba comprobante A y finaliza la recarga local (ventana de supresión de 800 ms)
    state.review(receiptA.id)
    await settle()
    assert.equal(listCalls, 2)
    assert.equal(state.data.items[0].estadoRevision, 'APROBADO')
    assert.equal(state.data.items[1].estadoRevision, 'PENDIENTE')
    assert.equal(state.busy, false)

    // Paso 2: +200 ms (dentro de 800 ms), B pasa a RECHAZADO en servidor y llega invalidación receipts: true
    t.mock.timers.tick(200)
    serverReceipts = [
      { ...serverReceipts[0] },
      {
        ...receiptB,
        estadoRevision: 'RECHAZADO',
        revisadoEn: '2026-11-20T14:05:00.000Z',
        motivoRechazo: 'Importe no coincide con el pedido',
      },
    ]
    realtimeHandler(emptyChange({ receipts: true, orders: new Set([6]) }))
    await settle()

    // Dentro de la ventana no dispara recarga prematura, pero no descarta el evento
    assert.equal(listCalls, 2)
    assert.equal(state.data.items[1].estadoRevision, 'PENDIENTE')

    // Paso 3: avanzar fuera de los 800 ms SIN emitir ningún otro evento
    t.mock.timers.tick(650)
    await settle()

    assert.equal(listCalls, 3)
    assert.equal(state.data.items[1].estadoRevision, 'RECHAZADO')
    assert.equal(state.data.items[1].motivoRechazo, 'Importe no coincide con el pedido')

    // Reconnect cancela cualquier timer pendiente y reconcilia de inmediato sin duplicados
    state.review(receiptA.id)
    await settle()
    assert.equal(listCalls, 4)
    t.mock.timers.tick(200)
    realtimeHandler(emptyChange({ receipts: true }))
    await settle()
    assert.equal(listCalls, 4)
    t.mock.timers.tick(100)
    serverReceipts = [
      { ...serverReceipts[0] },
      { ...serverReceipts[1], motivoRechazo: 'Actualizado tras reconexión' },
    ]
    realtimeHandler(emptyChange({ reconnect: true }))
    await settle()
    assert.equal(listCalls, 5)
    assert.equal(state.data.items[1].motivoRechazo, 'Actualizado tras reconexión')
    t.mock.timers.tick(700)
    await settle()
    assert.equal(listCalls, 5)

    // Desmontar limpia timers diferidos pendientes
    state.review(receiptA.id)
    await settle()
    assert.equal(listCalls, 6)
    t.mock.timers.tick(200)
    realtimeHandler(emptyChange({ receipts: true }))
    app.unmount()
    t.mock.timers.tick(2000)
    await settle()
    assert.equal(listCalls, 6)
  })

  test('ClientOrderDetail reconcilia automáticamente una invalidación recibida dentro de la ventana de 800 ms', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 2_000_000 })
    t.after(() => t.mock.timers.reset())

    let serverDetail = {
      pedidoId: 42,
      numero: 'PED-000042',
      fecha: '2026-11-20T12:00:00.000Z',
      estado: 'CONFIRMADO',
      estadoPedido: 'CONFIRMADO',
      estadoDocumental: 'PENDIENTE',
      estadoFinanciero: 'SIN_PAGO_ACREDITADO',
      montoAcreditadoUSD: '0.00',
      modalidadPago: 'TRANSFERENCIA',
      moneda: 'USD',
      subtotal: '100.00',
      descuento: '0.00',
      total: '100.00',
      totalUSD: '100.00',
      cantidadLineas: 1,
      cantidadUnidades: 1,
      items: [],
    }
    let detailCalls = 0
    let realtimeHandler

    const ClientOrderDetail = loadSfc('components/ClientOrderDetail.vue', {
      '@/components/AdminOrderStatusBadge.vue': { __esModule: true, default: {} },
      '@/components/OrderFinancialStatusBadge.vue': { __esModule: true, default: {} },
      '@/components/OrderPaymentReceipts.vue': { __esModule: true, default: {} },
      '@/composables/useDeferredRealtimeReconcile': deferredRealtime,
      '@/composables/usePrivateAccountRead': privateAccountRead,
      '@/services/clientOrderService': {
        getClientOrderDetail: async () => {
          detailCalls++
          return { ...serverDetail }
        },
      },
      '@/services/paymentReceiptService': receiptService,
      '@/services/realtime': { onRealtime: handler => { realtimeHandler = handler } },
      '@/stores/auth': {
        useAuthStore: () => reactive({
          rol: 'CLIENTE',
          loggingIn: false,
          loggingOut: false,
          sessionVersion: 1,
          user: {
            id: 7,
            tipo_cliente: 'EMPRESA',
            estadoAprobacionEmpresa: 'APROBADA',
            cuentaCorrienteHabilitada: true,
          },
        }),
      },
      '@/utils/cuentaCorriente': cuentaUtils,
      '@/utils/payment': paymentUtils,
    }, false)

    ClientOrderDetail.render = () => null
    const app = renderer.createApp(ClientOrderDetail, { orderId: 42 })
    app.mount({})
    t.after(() => app.unmount())
    await settle()

    const state = app._instance.setupState
    assert.equal(detailCalls, 1)
    assert.equal(state.detail.estadoDocumental, 'PENDIENTE')

    await state.handleReceiptUpdated()
    await settle()
    assert.equal(detailCalls, 2)

    // Invalidación dentro de la ventana de 800 ms
    t.mock.timers.tick(200)
    serverDetail = {
      ...serverDetail,
      estado: 'EN_PREPARACION',
      estadoPedido: 'EN_PREPARACION',
      estadoDocumental: 'RECHAZADO',
    }
    realtimeHandler(emptyChange({ orders: new Set([42]), receipts: true }))
    await settle()
    assert.equal(detailCalls, 2)
    assert.equal(state.detail.estadoDocumental, 'PENDIENTE')

    // Al vencer los 800 ms, reconcilia sin segundo evento
    t.mock.timers.tick(650)
    await settle()
    assert.equal(detailCalls, 3)
    assert.equal(state.detail.estadoDocumental, 'RECHAZADO')
    assert.equal(state.detail.estado, 'EN_PREPARACION')
  })

  test('HistorialPedidos reconcilia automáticamente una invalidación dentro de la ventana de 800 ms y limpia timers al desmontar', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 3_000_000 })
    const previousWindow = globalThis.window
    globalThis.window = {
      innerWidth: 1280,
      addEventListener() {},
      removeEventListener() {},
      matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
    }
    t.after(() => {
      globalThis.window = previousWindow
      t.mock.timers.reset()
    })

    let serverOrders = [
      {
        pedidoId: 42,
        numero: 'PED-000042',
        fecha: '2026-11-20T12:00:00.000Z',
        estado: 'CONFIRMADO',
        estadoPedido: 'CONFIRMADO',
        estadoDocumental: 'PENDIENTE',
        estadoFinanciero: 'SIN_PAGO_ACREDITADO',
        montoAcreditadoUSD: '0.00',
        modalidadPago: 'TRANSFERENCIA',
        moneda: 'USD',
        total: '100.00',
      },
    ]
    let listCalls = 0
    let realtimeHandler

    const HistorialPedidos = loadSfc('views/cuenta/HistorialPedidos.vue', {
      'vue-router': {
        useRoute: () => ({ query: {} }),
        useRouter: () => ({ replace: async () => {} }),
      },
      '@/components/AdminOrderStatusBadge.vue': { __esModule: true, default: {} },
      '@/components/ClientOrderDetail.vue': { __esModule: true, default: {} },
      '@/components/OrderFinancialStatusBadge.vue': { __esModule: true, default: {} },
      '@/components/OrderReceiptActions.vue': { __esModule: true, default: {} },
      '@/components/OrderReceiptDialog.vue': { __esModule: true, default: {} },
      '@/composables/useDeferredRealtimeReconcile': deferredRealtime,
      '@/composables/useOrderReceiptSummaries': {
        useOrderReceiptSummaries: () => ({
          loading: ref(false),
          status: () => 'PENDIENTE',
          refresh: () => {},
        }),
      },
      '@/composables/usePrivateAccountRead': privateAccountRead,
      '@/services/clientOrderService': {
        listClientOrders: async () => {
          listCalls++
          return serverOrders.map(order => ({ ...order }))
        },
      },
      '@/services/realtime': { onRealtime: handler => { realtimeHandler = handler } },
      '@/stores/auth': {
        useAuthStore: () => reactive({
          rol: 'CLIENTE',
          loggingIn: false,
          loggingOut: false,
          sessionVersion: 1,
          user: { id: 7 },
        }),
      },
      '@/utils/accountFilters': accountFilters,
      '@/utils/payment': paymentUtils,
    }, false)

    HistorialPedidos.render = () => null
    const app = renderer.createApp(HistorialPedidos)
    app.mount({})
    t.after(() => app.unmount())
    await settle()

    const state = app._instance.setupState
    assert.equal(listCalls, 1)
    assert.equal(state.orders[0].estado, 'CONFIRMADO')

    state.refreshOrderStates()
    await settle()
    assert.equal(listCalls, 2)

    // Invalidación dentro de los 800 ms
    t.mock.timers.tick(200)
    serverOrders = [
      {
        ...serverOrders[0],
        estado: 'EN_PREPARACION',
        estadoPedido: 'EN_PREPARACION',
        estadoFinanciero: 'ACREDITADO',
        montoAcreditadoUSD: '100.00',
      },
    ]
    realtimeHandler(emptyChange({ orders: new Set([42]), payments: true }))
    await settle()
    assert.equal(listCalls, 2)
    assert.equal(state.orders[0].estado, 'CONFIRMADO')

    // Vence el timer diferido sin un segundo evento
    t.mock.timers.tick(650)
    await settle()
    assert.equal(listCalls, 3)
    assert.equal(state.orders[0].estado, 'EN_PREPARACION')
    assert.equal(state.orders[0].estadoFinanciero, 'ACREDITADO')

    // Nueva ventana con evento pendiente cancelada al desmontar
    state.refreshOrderStates()
    await settle()
    assert.equal(listCalls, 4)
    t.mock.timers.tick(100)
    realtimeHandler(emptyChange({ orders: new Set([42]) }))
    app.unmount()
    t.mock.timers.tick(1000)
    await settle()
    assert.equal(listCalls, 4)
  })
})
