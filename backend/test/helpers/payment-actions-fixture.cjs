const assert = require('node:assert/strict')
const { createHash, randomUUID } = require('node:crypto')
const bcrypt = require('bcryptjs')

const PASSWORD = 'E2eLocal-214!'

function sha(value) {
  return createHash('sha256').update(String(value)).digest()
}

function referenceCalendar() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const cursor = new Date(`${today}T12:00:00Z`)
  const days = {}
  let reference = null
  for (let index = 0; index < 15; index += 1) {
    cursor.setUTCDate(cursor.getUTCDate() - 1)
    const key = cursor.toISOString().slice(0, 10)
    const weekend = cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6
    days[key] = !weekend
    if (!weekend && reference === null) reference = key
  }
  assert.ok(reference, 'La fixture #335 necesita una referencia cambiaria hábil.')
  return { days, reference }
}

async function seedPaymentActions(session) {
  const { connection } = session
  const insert = async (sql, values = []) =>
    Number((await connection.query(sql, values)).insertId)

  const clientId = await insert(`
    INSERT INTO CLIENTE
      (tipo_cliente, nombre_razon_social, email, cuit, estado_aprobacion_empresa, es_fiel, activo)
    VALUES ('EMPRESA', 'Empresa Pagos E2E', 'pagos-empresa@e2e.test', '30-33500001-9', 'APROBADA', 0, 1)
  `)

  const hash = bcrypt.hashSync(PASSWORD, '$2b$04$abcdefghijklmnopqrstuu')
  const userId = await insert(`
    INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo)
    VALUES (?, 'pagos-empresa@e2e.test', ?, 'CLIENTE', 1)
  `, [clientId, hash])

  const adminRevokedId = await insert(`
    INSERT INTO USUARIO (id_cliente, email, password_hash, rol, activo)
    VALUES (NULL, 'admin-revocado-335@e2e.test', ?, 'ADMIN', 1)
  `, [hash])

  const accountId = await insert(`
    INSERT INTO CUENTA_CORRIENTE
      (id_cliente, limite_credito, habilitada, cobertura, plazo_dias,
       moneda_limite, evidencia_limite, evidencia_plazo, evidencia_cobertura,
       cobertura_desde_utc, origen_datos)
    VALUES (?, 999999.00, 1, 'COMPLETA', 30, 'USD',
      'TEST-ONLY fixture #335', 'TEST-ONLY fixture #335', 'TEST-ONLY fixture #335',
      UTC_TIMESTAMP(3) - INTERVAL 2 DAY, 'REAL')
  `, [clientId])

  const { days, reference } = referenceCalendar()
  const now = Date.now()
  const loadedAt = new Date(now - 4000)
  const verifiedAt = new Date(now - 3000)
  const loadedParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(loadedAt)
  const loadedPart = Object.fromEntries(loadedParts.map(part => [part.type, part.value]))
  const sqlLoaded = `${loadedPart.year}-${loadedPart.month}-${loadedPart.day} ${loadedPart.hour}:${loadedPart.minute}:${loadedPart.second}`
  const sqlLoadedMs = loadedAt.toISOString().slice(0, 23).replace('T', ' ')
  const sqlVerified = verifiedAt.toISOString().slice(0, 23).replace('T', ' ')

  await connection.query(`
    INSERT INTO FER17_CALENDARIO
      (version, dias_json, evidencia, id_admin, verificado_utc, activo, sintetica)
    VALUES ('fixture-335', ?, 'TEST-ONLY calendario #335', 1,
      UTC_TIMESTAMP(3) - INTERVAL 5 SECOND, 1, 0)
  `, [JSON.stringify(days)])

  const quoteId = await insert(`
    INSERT INTO COTIZACION (tasa, fecha_referencia, fecha_carga, actor, valida)
    VALUES (1000.00000000, ?, ?, 'BNA FIXTURE #335', 1)
  `, [reference, sqlLoaded])

  await connection.query(`
    INSERT INTO FER17_COTIZACION_VERIFICACION
      (id_cotizacion, tasa_verificada, referencia_verificada, cargada_utc,
       actor_carga_verificado, banco, tipo, evidencia, id_admin, verificado_utc,
       valida, sintetica)
    VALUES (?, 1000.00000000, ?, ?, 'BNA FIXTURE #335', 'BNA', 'VENDEDOR',
      'TEST-ONLY verificación #335', 1, ?, 1, 0)
  `, [quoteId, reference, sqlLoadedMs, sqlVerified])

  async function createReceipt(label, mime = 'image/png', options = {}) {
    const receiptId = randomUUID()
    const bytes = 512 + (label.length % 1024)
    const receiptOrderId = options.orderId ?? null
    const receiptAccountId = options.accountId === undefined ? accountId : options.accountId
    await connection.query(`
      INSERT INTO COMPROBANTE_PAGO
        (id_comprobante, id_cliente, id_usuario_carga, id_pedido, id_cuenta_corriente,
         tipo_mime, bytes, sha256, fecha_utc)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
    `, [receiptId, clientId, userId, receiptOrderId, receiptAccountId, mime, bytes, sha(`#335-receipt:${label}`)])
    return receiptId
  }

  async function createDirectOrder(label, amount = '175.00') {
    return insert(`
      INSERT INTO PEDIDO
        (id_cliente, estado, modalidad_pago, subtotal, descuento, total,
         moneda_total, evidencia_total_usd)
      VALUES (?, 'CONFIRMADO', 'TRANSFERENCIA', ?, 0, ?, 'USD', ?)
    `, [clientId, amount, amount, `Fixture #335 ${label}`])
  }

  async function createPayment(label, options = {}) {
    const {
      amount = '100.00',
      currency = 'USD',
      documentState = 'PENDIENTE',
      financialState = 'PENDIENTE',
      withReceipt = true,
      reason = null,
      accredited = false,
      secondsAgo = 0,
      createMovement = false,
      orderId = null,
      targetAccountId = accountId,
    } = options

    const receiptId = withReceipt
      ? await createReceipt(label, 'image/png', { orderId, accountId: targetAccountId })
      : null
    const declarationKey = withReceipt ? randomUUID() : null
    const declarationHash = withReceipt ? sha(`#335-declaration:${label}:${amount}:${currency}`).toString('hex') : null
    const approved = documentState === 'APROBADO' || documentState === 'RECHAZADO'
    const rejected = documentState === 'RECHAZADO'
    const closed = financialState === 'RECHAZADO' || financialState === 'ANULADO'
    const accreditationKey = accredited ? randomUUID() : null
    const accreditationHash = accredited ? sha(`#335-accreditation:${label}:${amount}`).toString('hex') : null
    const montoUsd = accredited ? (currency === 'USD' ? amount : '300.00') : null
    const tasa = accredited && currency === 'ARS' ? '1000.00000000' : null
    const idCotizacion = accredited && currency === 'ARS' ? quoteId : null
    const payload = [
      targetAccountId,
      orderId,
      amount,
      financialState,
      receiptId,
      `Fixture #335 ${label}`,
      currency,
      withReceipt ? userId : null,
      declarationKey,
      declarationHash,
      receiptId,
      documentState,
      approved ? 1 : null,
      approved ? '2026-01-01 00:00:00.000' : null,
      rejected ? reason : null,
      closed ? reason ?? 'Cierre fixture #335' : null,
      closed ? 1 : null,
      closed ? '2026-01-01 00:00:01.000' : null,
      accredited ? 1 : null,
      accreditationKey,
      accreditationHash,
      montoUsd,
      accredited ? '2026-01-02 12:00:00.000' : null,
      accredited ? `Acreditación fixture #335 ${label}` : null,
      accredited ? 1 : null,
      idCotizacion,
      tasa,
      secondsAgo,
    ]

    const paymentId = await insert(`
      INSERT INTO PAGO (
        id_cuenta_corriente, id_pedido, monto, metodo_pago, estado, comprobante, observaciones, moneda,
        id_usuario_declarante, clave_idempotencia, huella_declaracion, id_comprobante,
        estado_documental, id_admin_revision, revision_utc, motivo_revision,
        motivo_cierre, id_admin_cierre, fecha_cierre_utc,
        id_admin_acreditacion, clave_acreditacion, huella_acreditacion,
        monto_usd, fecha_acreditacion_utc, evidencia_acreditacion, id_admin_actor,
        id_cotizacion, tasa_historica, fecha
      ) VALUES (
        ?, ?, ?, 'TRANSFERENCIA', ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? SECOND)
      )
    `, payload)

    if ((createMovement || accredited) && targetAccountId !== null) {
      await connection.query(`
        INSERT INTO MOVIMIENTO_CUENTA_CORRIENTE
          (id_cuenta_corriente, tipo_movimiento, origen, id_pago, monto, moneda,
           estado, autorizado_por, observaciones, huella_registro,
           monto_original, moneda_original, evidencia_origen)
        VALUES (?, 'ABONO', 'PAGO', ?, ?, 'USD', 'ACREDITADO', '1', ?,
          SHA2(?, 256), ?, 'USD', JSON_OBJECT('fixture', '#335'))
      `, [
        accountId,
        paymentId,
        montoUsd ?? amount,
        `Movimiento fixture #335 ${label}`,
        `#335-movement:${label}`,
        montoUsd ?? amount,
      ])
    }

    return paymentId
  }

  for (let index = 0; index < 40; index += 1) {
    await createPayment(`bulk-${index}`, {
      amount: `${100 + index}.00`,
      secondsAgo: 3600 + index * 60,
    })
  }

  const scenarios = {}
  scenarios.pendingUsd = await createPayment('pending-usd', { amount: '100.00', secondsAgo: 1 })
  scenarios.pendingArs = await createPayment('pending-ars', {
    amount: '150000.00', currency: 'ARS', secondsAgo: 2,
  })
  scenarios.approvalUsd = await createPayment('approval-usd', { amount: '120.00', secondsAgo: 3 })
  scenarios.rejectUsd = await createPayment('reject-usd', { amount: '110.00', secondsAgo: 4 })
  scenarios.approvedUsd = await createPayment('approved-usd', {
    amount: '250.00', documentState: 'APROBADO', secondsAgo: 5,
  })
  scenarios.approvedArs = await createPayment('approved-ars', {
    amount: '300000.00', currency: 'ARS', documentState: 'APROBADO', secondsAgo: 6,
  })
  scenarios.missingQuoteArs = await createPayment('missing-quote-ars', {
    amount: '330000.00', currency: 'ARS', documentState: 'APROBADO', secondsAgo: 7,
  })
  scenarios.invalidQuoteArs = await createPayment('invalid-quote-ars', {
    amount: '340000.00', currency: 'ARS', documentState: 'APROBADO', secondsAgo: 8,
  })
  scenarios.retryUsd = await createPayment('retry-usd', {
    amount: '260.00', documentState: 'APROBADO', secondsAgo: 9,
  })
  scenarios.doubleClickUsd = await createPayment('double-click-usd', {
    amount: '270.00', documentState: 'APROBADO', secondsAgo: 10,
  })
  scenarios.lostResponseUsd = await createPayment('lost-response-usd', {
    amount: '280.00', documentState: 'APROBADO', secondsAgo: 11,
  })
  scenarios.revokedAdminUsd = await createPayment('revoked-admin-usd', {
    amount: '290.00', documentState: 'APROBADO', secondsAgo: 12,
  })
  scenarios.responsiveUsd = await createPayment('responsive-usd', {
    amount: '99.90', documentState: 'APROBADO', secondsAgo: 13,
  })
  scenarios.rejectedDoc = await createPayment('rejected-doc', {
    amount: '80.00', documentState: 'RECHAZADO', financialState: 'RECHAZADO',
    reason: 'Comprobante ilegible', secondsAgo: 14,
  })
  scenarios.accreditedUsd = await createPayment('accredited-usd', {
    amount: '60.00', documentState: 'APROBADO', financialState: 'ACREDITADO',
    accredited: true, secondsAgo: 15,
  })
  scenarios.annulled = await createPayment('annulled', {
    amount: '40.00', documentState: 'APROBADO', financialState: 'ANULADO',
    reason: 'Anulación fixture #335', secondsAgo: 16,
  })
  scenarios.missingReceipt = await createPayment('missing-receipt', {
    amount: '30.00', withReceipt: false, secondsAgo: 17,
  })
  const directOrder360Id = await createDirectOrder('direct-order-360', '175.00')
  scenarios.directOrderUsd360 = await createPayment('direct-order-usd-360', {
    amount: '175.00',
    documentState: 'APROBADO',
    secondsAgo: 18,
    orderId: directOrder360Id,
    targetAccountId: null,
  })
  const directOrder1280Id = await createDirectOrder('direct-order-1280', '185.00')
  scenarios.directOrderUsd1280 = await createPayment('direct-order-usd-1280', {
    amount: '185.00',
    documentState: 'APROBADO',
    secondsAgo: 19,
    orderId: directOrder1280Id,
    targetAccountId: null,
  })

  return {
    clientId,
    userId,
    accountId,
    adminRevokedId,
    adminRevokedEmail: 'admin-revocado-335@e2e.test',
    quoteId,
    quoteReference: reference,
    directOrder360Id,
    directOrder1280Id,
    totalRowCount: 40 + Object.keys(scenarios).length,
    scenarios,
  }
}

module.exports = { seedPaymentActions, credentials: {
  company: { email: 'pagos-empresa@e2e.test', password: PASSWORD },
  adminRevoked: { email: 'admin-revocado-335@e2e.test', password: PASSWORD },
} }
