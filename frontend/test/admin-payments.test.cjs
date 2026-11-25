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

function payment(overrides = {}) {
  return {
    id: 12,
    clienteId: 4,
    cliente: 'Empresa E2E aprobada',
    cuentaCorrienteId: 8,
    declaranteUsuarioId: 5,
    revisadoPorUsuarioId: null,
    acreditadoPorUsuarioId: null,
    claveIdempotencia: '8f1f2a10-6f4a-4c4e-9f51-53a3b0b32551',
    claveAcreditacion: null,
    comprobanteId: '8f1f2a10-6f4a-4c4e-9f51-53a3b0b32552',
    comprobanteTipoMime: 'image/png',
    comprobanteBytes: 2048,
    comprobanteRevisadoEn: null,
    pedidoId: null,
    monto: '1500.00',
    montoUsd: null,
    moneda: 'USD',
    observaciones: 'Transferencia declarada',
    estado: 'PENDIENTE',
    estadoDocumental: 'PENDIENTE',
    motivoRevision: null,
    evidenciaAcreditacion: null,
    fecha: '2026-11-21T10:00:00.000000Z',
    revisadoEn: null,
    acreditadoEn: null,
    movimientoId: null,
    movimientoEstado: null,
    movimientoMonto: null,
    ...overrides,
  }
}

function service(api) {
  return loadTypeScript('services/adminPaymentService.ts', {
    './api': { __esModule: true, default: api },
  })
}

test('decodifica el contrato ADMIN de pagos y rechaza importes o fechas inválidas', () => {
  const { decodeAdminPaymentPage, decodeAdminPayment } = service({})

  const page = decodeAdminPaymentPage({
    items: [payment(), payment({ id: 13, monto: '200.50', montoUsd: '200.50' })],
    paginaSiguiente: 2,
  })
  assert.equal(page.items.length, 2)
  assert.equal(page.items[0].fecha, '2026-11-21T10:00:00.000000Z')
  assert.equal(page.paginaSiguiente, 2)
  assert.equal(decodeAdminPayment(payment()).id, 12)

  assert.throws(() => decodeAdminPayment(payment({ monto: -1 })))
  assert.throws(() => decodeAdminPayment(payment({ monto: '1.001' })))
  assert.throws(() => decodeAdminPayment(payment({ estadoDocumental: 'VALIDADO' })))
  assert.throws(() => decodeAdminPayment(payment({ fecha: '2026-11-21 10:00:00' })))
  assert.throws(() => decodeAdminPayment(payment({ comprobanteTipoMime: 'text/plain' })))
  assert.throws(() => decodeAdminPaymentPage({ items: [], paginaSiguiente: 0 }))
  assert.throws(() => decodeAdminPaymentPage({ items: new Array(51).fill(payment()), paginaSiguiente: null }))
  assert.throws(() => decodeAdminPaymentPage(null))
})

test('mantiene separadas las etiquetas documentales y financieras', () => {
  const { documentLabel, financialLabel } = service({})
  assert.equal(documentLabel('PENDIENTE'), 'Pendiente de revisión')
  assert.equal(documentLabel('APROBADO'), 'Documento aprobado')
  assert.equal(documentLabel('RECHAZADO'), 'Documento rechazado')
  assert.equal(financialLabel('PENDIENTE'), 'Pendiente de acreditación')
  assert.equal(financialLabel('ACREDITADO'), 'Acreditado')
  assert.equal(financialLabel('RECHAZADO'), 'Pago rechazado')
  assert.equal(financialLabel('ANULADO'), 'Anulado')
  assert.equal(financialLabel('OTRO'), 'Estado financiero desconocido')
})

test('las acciones visibles respetan las compuertas documental y financiera', () => {
  const { canReview, canAccredit } = service({})

  assert.equal(canReview(payment()), true)
  assert.equal(canReview(payment({ estadoDocumental: 'APROBADO' })), false)
  assert.equal(canReview(payment({ estado: 'ACREDITADO', estadoDocumental: 'APROBADO' })), false)
  assert.equal(canReview(payment({ comprobanteId: null })), false)

  assert.equal(canAccredit(payment({ estadoDocumental: 'APROBADO' })), true)
  assert.equal(canAccredit(payment()), false, 'la revisión pendiente bloquea la acreditación')
  assert.equal(canAccredit(payment({ estadoDocumental: 'APROBADO', estado: 'ACREDITADO' })), false)
  assert.equal(canAccredit(payment({ estadoDocumental: 'APROBADO', comprobanteId: null })), false)
  assert.equal(canAccredit(payment({ estadoDocumental: 'APROBADO', moneda: null })), false)
  assert.equal(canAccredit(payment({ estadoDocumental: 'APROBADO', monto: '0.00' })), false)
})

test('soporta pagos directos a pedidos TRANSFERENCIA con cuentaCorrienteId null y rechaza destino ausente', () => {
  const { decodeAdminPayment, canReview, canAccredit } = service({})
  const directOrderPayment = decodeAdminPayment(payment({
    id: 99,
    cuentaCorrienteId: null,
    pedidoId: 42,
    comprobanteId: null,
  }))
  assert.equal(directOrderPayment.cuentaCorrienteId, null)
  assert.equal(directOrderPayment.pedidoId, 42)
  assert.equal(canReview(directOrderPayment), false)
  assert.equal(canReview(payment({ cuentaCorrienteId: null, pedidoId: 42 })), false)
  // El fixture conserva declaranteUsuarioId: es una declaración con revisión pendiente.
  assert.equal(canAccredit(directOrderPayment), false)

  // Un pago directo registrado por ADMIN no tiene declarante ni comprobante y
  // el backend lo acredita contra la cobertura del pedido sin exigir revisión.
  const adminDirect = decodeAdminPayment(payment({
    id: 100,
    cuentaCorrienteId: null,
    pedidoId: 42,
    comprobanteId: null,
    declaranteUsuarioId: null,
    estadoDocumental: 'PENDIENTE',
  }))
  assert.equal(canAccredit(adminDirect), true)
  assert.equal(canAccredit(payment({
    id: 101,
    cuentaCorrienteId: null,
    pedidoId: 42,
    comprobanteId: null,
    declaranteUsuarioId: null,
    estado: 'ACREDITADO',
  })), false)
  assert.equal(canAccredit(payment({
    id: 102,
    cuentaCorrienteId: null,
    pedidoId: 42,
    comprobanteId: null,
    declaranteUsuarioId: null,
    monto: '0.00',
  })), false)

  assert.throws(() => decodeAdminPayment(payment({ cuentaCorrienteId: null, pedidoId: null })))
})

test('formatea importes sin convertir dinero a Number', () => {
  const { formatPaymentMoney } = service({})
  assert.equal(formatPaymentMoney('1500.50', 'USD'), 'USD 1.500,50')
  assert.equal(formatPaymentMoney('1500000.00', 'ARS'), 'ARS 1.500.000,00')
  assert.equal(formatPaymentMoney('12.00', null), 'Importe 12,00')
  assert.equal(formatPaymentMoney('1e3', 'USD'), 'Importe no disponible')
})

test('crea el pago directo con el DTO exacto y conserva la Idempotency-Key', async () => {
  const calls = []
  const createdPayment = payment({
    id: 77,
    cuentaCorrienteId: null,
    pedidoId: 42,
    comprobanteId: null,
    declaranteUsuarioId: null,
    comprobanteTipoMime: null,
    comprobanteBytes: null,
    estadoDocumental: 'PENDIENTE',
    estado: 'PENDIENTE',
    monto: '125.00',
    montoUsd: null,
    observaciones: 'Pago directo',
  })
  const api = {
    get: async (url, config) => {
      calls.push({ method: 'GET', url, config })
      return { data: { data: { items: [createdPayment], paginaSiguiente: null } } }
    },
    post: async (url, body, config) => {
      calls.push({ method: 'POST', url, body, config })
      return { data: { data: createdPayment, meta: { replay: false } } }
    },
  }
  const {
    createAdminOrderPayment,
    findPaymentByIdempotencyKey,
    listAdminPaymentsForOrder,
    paymentRegistrationNotice,
  } = service(api)
  const key = '8f1f2a10-6f4a-4c4e-9f51-53a3b0b32554'
  const signal = new AbortController().signal

  const page = await listAdminPaymentsForOrder(42, signal)
  assert.equal(page.items.length, 1)
  assert.equal(findPaymentByIdempotencyKey(page, createdPayment.claveIdempotencia)?.id, 77)
  assert.equal(findPaymentByIdempotencyKey(page, key), null)

  const result = await createAdminOrderPayment({
    pedidoId: 42,
    monto: '125.00',
    moneda: 'USD',
    metodoPago: 'TRANSFERENCIA',
    referencia: 'TRF-42',
    observaciones: 'Pago directo',
  }, key, signal)
  assert.equal(result.payment.id, 77)
  assert.equal(result.replay, false)
  assert.match(paymentRegistrationNotice(result.payment), /Pago #77 registrado por el servidor/)
  assert.match(paymentRegistrationNotice(result.payment), /estado PENDIENTE/)
  assert.match(paymentRegistrationNotice(result.payment), /No se acreditó automáticamente/)

  assert.deepEqual(calls[0], {
    method: 'GET',
    url: '/admin/pagos',
    config: { params: { pagina: 1, pedidoId: 42 }, signal },
  })
  assert.deepEqual(calls[1], {
    method: 'POST',
    url: '/admin/pagos',
    body: {
      pedidoId: 42,
      cuentaCorrienteId: null,
      monto: '125.00',
      moneda: 'USD',
      metodoPago: 'TRANSFERENCIA',
      estado: 'PENDIENTE',
      comprobante: 'TRF-42',
      observaciones: 'Pago directo',
    },
    config: { signal, headers: { 'Idempotency-Key': key } },
  })

  calls.length = 0
  await createAdminOrderPayment({
    pedidoId: 42,
    monto: '125.00',
    moneda: 'ARS',
    metodoPago: 'TRANSFERENCIA',
    referencia: '   ',
    observaciones: '   ',
  }, key, signal)
  assert.deepEqual(calls[0].body, {
    pedidoId: 42,
    cuentaCorrienteId: null,
    monto: '125.00',
    moneda: 'ARS',
    metodoPago: 'TRANSFERENCIA',
    estado: 'PENDIENTE',
  })

  await assert.rejects(
    createAdminOrderPayment({
      pedidoId: 42, monto: '0.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA',
    }, key, signal),
    /mayor a cero/,
  )
  await assert.rejects(
    createAdminOrderPayment({
      pedidoId: 42, monto: '1.00', moneda: 'USD', metodoPago: 'TRANSFERENCIA',
    }, 'no-es-uuid', signal),
    /UUID v4/,
  )
})

test('usa el DTO exacto del backend y conserva la Idempotency-Key en acreditación', async () => {
  const calls = []
  const responsePayment = payment({ estadoDocumental: 'APROBADO' })
  const api = {
    get: async (url, config) => {
      calls.push({ method: 'GET', url, config })
      return { data: { data: url === '/admin/pagos' ? { items: [responsePayment], paginaSiguiente: null } : responsePayment } }
    },
    patch: async (url, body, config) => {
      calls.push({ method: 'PATCH', url, body, config })
      return { data: { data: payment({ estadoDocumental: 'RECHAZADO', estado: 'RECHAZADO', motivoRevision: 'Ilegible' }) } }
    },
    post: async (url, body, config) => {
      calls.push({ method: 'POST', url, body, config })
      return { data: { data: payment({ estadoDocumental: 'APROBADO', estado: 'ACREDITADO', montoUsd: '1500.00' }) } }
    },
  }
  const {
    listAdminPayments, getAdminPayment, reviewAdminPayment, accreditAdminPayment, isUuidV4,
  } = service(api)
  const signal = new AbortController().signal

  assert.equal((await listAdminPayments(2, signal)).items.length, 1)
  assert.equal((await getAdminPayment(12, signal)).id, 12)
  await reviewAdminPayment(12, 'APROBADO', undefined, signal)
  await reviewAdminPayment(12, 'RECHAZADO', 'Comprobante ilegible', signal)
  const key = '8f1f2a10-6f4a-4c4e-9f51-53a3b0b32553'
  assert.equal(isUuidV4(key), true)
  await accreditAdminPayment(12, 'Extracto BNA verificado', key, signal)

  assert.deepEqual(calls[0], {
    method: 'GET', url: '/admin/pagos', config: { params: { pagina: 2 }, signal },
  })
  assert.deepEqual(calls[2].body, { decision: 'APROBADO' })
  assert.deepEqual(calls[3].body, { decision: 'RECHAZADO', motivo: 'Comprobante ilegible' })
  assert.deepEqual(calls[4], {
    method: 'POST',
    url: '/admin/pagos/12/acreditar',
    body: { evidencia: 'Extracto BNA verificado' },
    config: { signal, headers: { 'Idempotency-Key': key } },
  })
  assert.equal(isUuidV4('no-es-uuid'), false)
  await assert.rejects(
    accreditAdminPayment(12, 'x', 'no-es-uuid', signal),
    /UUID v4/,
  )
})

test('traduce errores financieros sin afirmar resultados no confirmados', () => {
  const { mapPaymentError } = service({})
  assert.match(mapPaymentError('COTIZACION_AUSENTE', 409), /No existe una cotización FER17-v1/)
  assert.match(mapPaymentError('COTIZACION_INVALIDA', 422), /no es válida/)
  assert.match(mapPaymentError('PAGO_PENDIENTE_REVISION', 409), /No se acreditó dinero/)
  assert.match(mapPaymentError('PAGO_YA_ACREDITADO', 409), /No se generó otro movimiento/)
  assert.match(mapPaymentError(undefined, undefined), /No se confirmó ningún cambio/)
})

test('el diálogo de acreditación no genera la clave automáticamente en cada envío', () => {
  const source = readFileSync(
    resolve(__dirname, '../src/components/AdminPaymentAccreditationDialog.vue'),
    'utf8',
  )
  assert.match(source, /idempotencyKey \?\?= createAccreditationKey\(\)/)
  assert.match(source, /Reintentar con la misma clave/)
  assert.match(source, /No afirmamos que la acreditación haya fallado ni que se haya completado/)
  assert.match(source, /accreditationDestinationDescription/)
  assert.match(source, /accreditationConfirmationLabel/)
  assert.match(source, /accreditationSuccessNotice/)
  assert.match(source, /accreditationReconciledNotice/)
  assert.match(source, /id="payment-accreditation-description"[^>]*\[overflow-wrap:anywhere\]/)
  assert.doesNotMatch(source, /monto_usd\s*=|INSERT INTO MOVIMIENTO/)
})

test('adapta mensajes previos y posteriores de acreditación para cuenta corriente vs pedido directo', () => {
  const {
    accreditationDestinationDescription,
    accreditationConfirmationLabel,
    accreditationSuccessNotice,
    accreditationReconciledNotice,
    paymentUpdatedFeedback,
  } = service({})

  const accountPayment = payment({
    id: 41,
    cuentaCorrienteId: 10,
    pedidoId: null,
    estadoDocumental: 'APROBADO',
    estado: 'ACREDITADO',
    montoUsd: '250.00',
    movimientoId: 77,
  })
  const accountDesc = accreditationDestinationDescription(accountPayment)
  const accountConfirm = accreditationConfirmationLabel(accountPayment)
  const accountNotice = accreditationSuccessNotice(accountPayment)
  const accountReconciled = accreditationReconciledNotice(accountPayment)
  const accountFeedback = paymentUpdatedFeedback(accountPayment)

  assert.match(accountDesc, /cuenta corriente/)
  assert.match(accountDesc, /ABONO/)
  assert.match(accountDesc, /FIFO/)
  assert.match(accountConfirm, /ABONO/)
  assert.match(accountConfirm, /cuenta corriente/)
  assert.match(accountNotice, /ABONO/)
  assert.match(accountNotice, /#77/)
  assert.match(accountNotice, /cuenta corriente/)
  assert.match(accountNotice, /USD 250,00/)
  assert.match(accountReconciled, /ABONO/)
  assert.match(accountReconciled, /#77/)
  assert.match(accountFeedback, /cuenta corriente #10/)
  assert.match(accountFeedback, /USD 250,00/)

  const directOrderPayment = payment({
    id: 42,
    cuentaCorrienteId: null,
    pedidoId: 33,
    estadoDocumental: 'APROBADO',
    estado: 'ACREDITADO',
    montoUsd: '250.00',
    movimientoId: null,
  })
  const directDesc = accreditationDestinationDescription(directOrderPayment)
  const directConfirm = accreditationConfirmationLabel(directOrderPayment)
  const directNotice = accreditationSuccessNotice(directOrderPayment)
  const directReconciled = accreditationReconciledNotice(directOrderPayment)
  const directFeedback = paymentUpdatedFeedback(directOrderPayment)

  assert.match(directDesc, /Pedido #33/)
  assert.match(directDesc, /cobertura financiera exclusiva del pedido directo/)
  assert.doesNotMatch(directDesc, /ABONO|cuenta corriente/i)
  assert.match(directConfirm, /Pedido #33/)
  assert.match(directConfirm, /cobertura financiera/)
  assert.doesNotMatch(directConfirm, /abono|cuenta corriente/i)
  assert.match(directNotice, /Pedido #33/)
  assert.match(directNotice, /USD 250,00/)
  assert.doesNotMatch(directNotice, /abono|cuenta corriente/i)
  assert.match(directReconciled, /Pedido #33/)
  assert.match(directReconciled, /USD 250,00/)
  assert.doesNotMatch(directReconciled, /abono|cuenta corriente/i)
  assert.match(directFeedback, /Pedido #33/)
  assert.match(directFeedback, /USD 250,00/)
  assert.doesNotMatch(directFeedback, /abono|cuenta corriente/i)
})
