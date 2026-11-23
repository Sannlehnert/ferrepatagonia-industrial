import { expect, test as base, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

interface Db {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T>
  end(): Promise<void>
}

interface PaymentFixture {
  clientId: number
  userId: number
  accountId: number
  adminRevokedId: number
  adminRevokedEmail: string
  quoteId: number
  quoteReference: string
  directOrder360Id: number
  directOrder1280Id: number
  totalRowCount: number
  scenarios: Record<string, number>
}

const require = createRequire(import.meta.url)
const { connectOwned } = require('../../../backend/test/helpers/cc260-disposable.cjs') as {
  connectOwned(profile: unknown, runner: 'E2E'): Promise<{ connection: Db }>
}
const fixture = JSON.parse(process.env.E2E_PAYMENT_ACTIONS_FIXTURE ?? '{}') as PaymentFixture
const scenario = fixture.scenarios
const password = 'E2eLocal-214!'
const capturesDir = process.env.E2E_UPDATE_DOCS_CAPTURES === '1'
  ? resolve(process.cwd(), '../docs/335/captures')
  : resolve(process.cwd(), 'test-results/payment-actions-captures')

const test = base.extend<{ db: Db }>({
  db: async ({}, use) => {
    if (!process.env.CCE2E_TEST_PROFILE) throw new Error('Usar backend/test/helpers/run-e2e.cjs --payment-actions')
    const { connection } = await connectOwned(JSON.parse(process.env.CCE2E_TEST_PROFILE), 'E2E')
    try {
      await use(connection)
    } finally {
      await connection.end()
    }
  },
})

async function login(page: Page, email = 'admin@e2e.test') {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel(/^Contraseña/).fill(password)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login$/)
}

async function openPayments(page: Page) {
  await page.goto('/admin/pagos')
  await expect(page.getByRole('heading', { name: 'Gestión de pagos', exact: true })).toBeVisible()
  await expect(page.locator('[data-payment-id]').first()).toBeVisible()
}

function card(page: Page, paymentId: number): Locator {
  return page.locator(`[data-payment-id="${paymentId}"]`)
}

async function openAccreditation(page: Page, paymentId: number) {
  await card(page, paymentId)
    .getByRole('button', { name: `Acreditar pago ${paymentId}`, exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: new RegExp(`Acreditar pago #${paymentId}`) })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Consultando nuevamente el pago…')).toHaveCount(0)
  await expect(dialog.locator('dl')).toBeVisible()
  return dialog
}

async function submitAccreditation(dialog: Locator, evidence = 'Extracto bancario verificado TEST-ONLY #335') {
  await dialog.getByLabel('Evidencia de acreditación', { exact: true }).fill(evidence)
  await dialog.getByLabel(/Confirmo que verifiqué el comprobante/).check()
  await dialog.getByRole('button', { name: 'Confirmar acreditación', exact: true }).click()
}

async function openReview(page: Page, paymentId: number, action: 'Aprobar' | 'Rechazar') {
  await card(page, paymentId)
    .getByRole('button', { name: `${action} documento del pago ${paymentId}`, exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: new RegExp(`${action} documento`) })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Consultando el estado actual del pago…')).toHaveCount(0)
  await expect(dialog.locator('dl')).toBeVisible()
  return dialog
}

async function paymentRow(db: Db, paymentId: number) {
  const [row] = await db.query<Array<Record<string, unknown>>>(`
    SELECT p.*, m.id_movimiento_cuenta AS movimiento_id, m.monto AS movimiento_monto
    FROM PAGO p LEFT JOIN MOVIMIENTO_CUENTA_CORRIENTE m ON m.id_pago = p.id_pago
    WHERE p.id_pago = ?
  `, [paymentId])
  return row
}

async function abonoCount(db: Db, paymentId: number) {
  const [row] = await db.query<Array<{ total: number }>>(
    "SELECT COUNT(*) AS total FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago = ? AND tipo_movimiento = 'ABONO'",
    [paymentId],
  )
  return Number(row!.total)
}

async function totalAbonos(db: Db) {
  const [row] = await db.query<Array<{ total: number }>>(
    "SELECT COUNT(*) AS total FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE tipo_movimiento = 'ABONO'",
  )
  return Number(row!.total)
}

test.describe('Gestión ADMIN de pagos con backend real', () => {
  test('lista paginada, detalle y estados separados', async ({ page }) => {
    test.setTimeout(50_000)
    await login(page)
    await openPayments(page)

    await expect(page.getByText('La revisión documental no acredita dinero.')).toBeVisible()
    await expect(page.locator('[data-payment-id]')).toHaveCount(50)
    await expect(page.getByText(`Página 1`)).toBeVisible()

    const pending = card(page, scenario.pendingUsd!)
    await expect(pending).toContainText('Pendiente de revisión')
    await expect(pending).toContainText('Pendiente de acreditación')
    await expect(pending).toContainText('USD 100,00')
    await expect(pending).toContainText('Empresa Pagos E2E')
    await expect(pending.getByRole('button', { name: `Acreditar pago ${scenario.pendingUsd}`, exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: 'Siguiente página', exact: true }).click()
    await expect(page.getByText('Página 2')).toBeVisible()
    const secondPageCount = fixture.totalRowCount - 50
    await expect(page.locator('[data-payment-id]')).toHaveCount(secondPageCount)
    await page.getByRole('button', { name: 'Anterior', exact: true }).click()
    await expect(page.getByText('Página 1')).toBeVisible()

    const detail = card(page, scenario.approvedUsd!)
    await detail.getByRole('button', { name: `Ver detalle del pago ${scenario.approvedUsd}`, exact: true }).click()
    const detailDialog = page.getByRole('dialog', { name: `Pago #${scenario.approvedUsd}` })
    await expect(detailDialog).toBeVisible()
    await expect(detailDialog).toContainText('Empresa Pagos E2E')
    await expect(detailDialog).toContainText('USD 250,00')
    await expect(detailDialog).toContainText('Cuenta corriente')
    await expect(detailDialog.getByRole('link', { name: 'Descargar comprobante' })).toBeVisible()
    await expect(detailDialog).toContainText('Documento aprobado')
    await expect(detailDialog).toContainText('Pendiente de acreditación')
    await detailDialog.getByRole('button', { name: 'Cerrar detalle', exact: true }).click()
    await expect(page.getByRole('dialog', { name: `Pago #${scenario.approvedUsd}` })).toHaveCount(0)

    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
  })

  test('muestra el listado vacío y recupera la consulta real', async ({ page }) => {
    await login(page)
    await page.route('**/api/admin/pagos?**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { items: [], paginaSiguiente: null } }),
    }))
    await page.goto('/admin/pagos')
    await expect(page.getByText('No hay declaraciones de pago para mostrar.')).toBeVisible()
    await page.unroute('**/api/admin/pagos?**')
    await page.reload()
    await expect(page.locator('[data-payment-id]').first()).toBeVisible()
  })

  test('informa el error de consulta y permite reintentar sin datos inventados', async ({ page }) => {
    await login(page)
    await openPayments(page)
    await page.route('**/api/admin/pagos?**', route => route.abort(), { times: 1 })
    await page.getByRole('button', { name: 'Siguiente página', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'No se pudieron consultar las declaraciones de pago.' })).toBeVisible()
    await expect(page.locator('[data-payment-id]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Reintentar consulta', exact: true }).click()
    await expect(page.locator('[data-payment-id]').first()).toBeVisible()
  })

  test('aprueba documentación sin generar ningún ABONO', async ({ page, db }) => {
    test.setTimeout(50_000)
    const abonosBefore = await totalAbonos(db)
    expect(await abonoCount(db, scenario.approvalUsd!)).toBe(0)
    await login(page)
    await openPayments(page)

    const dialog = await openReview(page, scenario.approvalUsd!, 'Aprobar')
    await expect(dialog.getByText('La revisión documental no acredita dinero.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Confirmar aprobación', exact: true })).toBeDisabled()
    await dialog.getByLabel(/Confirmo que verifiqué el comprobante/).check()
    await dialog.getByRole('button', { name: 'Confirmar aprobación', exact: true }).click()

    await expect(dialog.getByRole('status').filter({ hasText: 'Documento aprobado.' })).toBeVisible()
    const row = await paymentRow(db, scenario.approvalUsd!)
    expect(row.estado_documental).toBe('APROBADO')
    expect(row.estado).toBe('PENDIENTE')
    expect(await abonoCount(db, scenario.approvalUsd!)).toBe(0)

    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click()
    const updated = card(page, scenario.approvalUsd!)
    await expect(updated.getByRole('button', { name: `Ver detalle del pago ${scenario.approvalUsd}`, exact: true })).toBeFocused()
    await expect(updated).toContainText('Documento aprobado')
    await expect(updated).toContainText('Pendiente de acreditación')
    await expect(updated.getByRole('button', { name: `Acreditar pago ${scenario.approvalUsd}`, exact: true })).toBeVisible()
    expect(await totalAbonos(db)).toBe(abonosBefore)
  })

  test('rechaza la documentación con motivo y deja el pago cerrado sin ABONO', async ({ page, db }) => {
    test.setTimeout(50_000)
    await login(page)
    await openPayments(page)

    const dialog = await openReview(page, scenario.rejectUsd!, 'Rechazar')
    await dialog.getByLabel('Motivo del rechazo documental', { exact: true }).fill('Importe no coincide con el extracto')
    await dialog.getByLabel(/Confirmo que verifiqué el comprobante/).check()
    await dialog.getByRole('button', { name: 'Confirmar rechazo', exact: true }).click()

    await expect(dialog.getByRole('status').filter({ hasText: 'Documento rechazado.' })).toBeVisible()
    const row = await paymentRow(db, scenario.rejectUsd!)
    expect(row.estado_documental).toBe('RECHAZADO')
    expect(row.estado).toBe('RECHAZADO')
    expect(row.motivo_revision).toBe('Importe no coincide con el extracto')
    expect(await abonoCount(db, scenario.rejectUsd!)).toBe(0)

    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click()
    const rejected = card(page, scenario.rejectUsd!)
    await expect(rejected).toContainText('Documento rechazado')
    await expect(rejected).toContainText('Pago rechazado')
    await expect(rejected.getByRole('button', { name: `Acreditar pago ${scenario.rejectUsd}`, exact: true })).toHaveCount(0)
  })

  test('acredita un pago USD y registra exactamente un ABONO', async ({ page, db }) => {
    test.setTimeout(50_000)
    expect(await abonoCount(db, scenario.approvedUsd!)).toBe(0)
    await login(page)
    await openPayments(page)

    const dialog = await openAccreditation(page, scenario.approvedUsd!)
    await expect(dialog).toContainText('USD 250,00')
    await submitAccreditation(dialog, 'Acreditación USD TEST-ONLY #335')
    await expect(dialog.getByRole('status').filter({ hasText: 'Acreditación confirmada por el servidor.' })).toBeVisible()

    const row = await paymentRow(db, scenario.approvedUsd!)
    expect(row.estado).toBe('ACREDITADO')
    expect(row.monto_usd).toBe('250.00')
    expect(row.fecha_acreditacion_utc).toBeTruthy()
    expect(row.evidencia_acreditacion).toBe('Acreditación USD TEST-ONLY #335')
    expect(await abonoCount(db, scenario.approvedUsd!)).toBe(1)

    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click()
    const accredited = card(page, scenario.approvedUsd!)
    await expect(accredited).toContainText('Acreditado')
    await expect(accredited.getByRole('button', { name: `Acreditar pago ${scenario.approvedUsd}`, exact: true })).toHaveCount(0)
  })

  test('acredita un pago ARS con cotización FER17-v1 confirmada por el backend', async ({ page, db }) => {
    test.setTimeout(50_000)
    expect(await abonoCount(db, scenario.approvedArs!)).toBe(0)
    await login(page)
    await openPayments(page)

    const dialog = await openAccreditation(page, scenario.approvedArs!)
    await expect(dialog).toContainText('ARS 300.000,00')
    await expect(dialog).toContainText('La interfaz no estima conversiones.')
    await expect(dialog).not.toContainText('USD 300,00')
    await submitAccreditation(dialog, 'Acreditación ARS TEST-ONLY #335')
    await expect(dialog.getByRole('status').filter({ hasText: 'Acreditación confirmada por el servidor.' })).toBeVisible()

    const row = await paymentRow(db, scenario.approvedArs!)
    expect(row.estado).toBe('ACREDITADO')
    expect(row.monto_usd).toBe('300.00')
    expect(Number(row.id_cotizacion)).toBe(fixture.quoteId)
    expect(Number(row.tasa_historica)).toBe(1000)
    expect(await abonoCount(db, scenario.approvedArs!)).toBe(1)
    const [movement] = await db.query<Array<{ monto: string }>>(
      'SELECT monto FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago = ?',
      [scenario.approvedArs],
    )
    expect(movement!.monto).toBe('300.00')
  })

  test('sin cotización no acredita, informa el error y conserva el pago pendiente', async ({ page, db }) => {
    test.setTimeout(50_000)
    await login(page)
    await openPayments(page)
    // El calendario existe, pero no hay cotización diaria para la referencia:
    // el backend responde COTIZACION_AUSENTE (409), no una conversión inventada.
    await db.query('UPDATE COTIZACION SET fecha_referencia = ? WHERE id_cotizacion = ?', ['2000-01-01', fixture.quoteId])
    try {
      const dialog = await openAccreditation(page, scenario.missingQuoteArs!)
      const responsePromise = page.waitForResponse(response =>
        response.request().method() === 'POST'
        && response.url().includes(`/api/admin/pagos/${scenario.missingQuoteArs}/acreditar`))
      await submitAccreditation(dialog, 'Intento sin cotización #335')
      const failed = await responsePromise
      expect(failed.status()).toBe(409)
      expect((await failed.json()).code).toBe('COTIZACION_AUSENTE')
      await expect(dialog.getByRole('alert').filter({ hasText: 'No existe una cotización FER17-v1 verificada' })).toBeVisible()
      const row = await paymentRow(db, scenario.missingQuoteArs!)
      expect(row.estado).toBe('PENDIENTE')
      expect(row.monto_usd).toBeNull()
      expect(await abonoCount(db, scenario.missingQuoteArs!)).toBe(0)
    } finally {
      await db.query('UPDATE COTIZACION SET fecha_referencia = ? WHERE id_cotizacion = ?', [fixture.quoteReference, fixture.quoteId])
    }
  })

  test('con cotización inválida no acredita y no deja movimientos', async ({ page, db }) => {
    test.setTimeout(50_000)
    await login(page)
    await openPayments(page)
    await db.query('UPDATE FER17_COTIZACION_VERIFICACION SET valida = 0 WHERE id_cotizacion = ?', [fixture.quoteId])
    try {
      const dialog = await openAccreditation(page, scenario.invalidQuoteArs!)
      await submitAccreditation(dialog, 'Intento con cotización inválida #335')
      await expect(dialog.getByRole('alert').filter({ hasText: 'no es válida o no está verificada' })).toBeVisible()
      const row = await paymentRow(db, scenario.invalidQuoteArs!)
      expect(row.estado).toBe('PENDIENTE')
      expect(row.monto_usd).toBeNull()
      expect(await abonoCount(db, scenario.invalidQuoteArs!)).toBe(0)
    } finally {
      await db.query('UPDATE FER17_COTIZACION_VERIFICACION SET valida = 1 WHERE id_cotizacion = ?', [fixture.quoteId])
    }
  })

  test('bloquea el doble clic y envía una sola acreditación', async ({ page, db }) => {
    test.setTimeout(50_000)
    await login(page)
    await openPayments(page)
    let submissions = 0
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes(`/api/admin/pagos/${scenario.doubleClickUsd}/acreditar`)) submissions += 1
    })

    const dialog = await openAccreditation(page, scenario.doubleClickUsd!)
    await dialog.getByLabel('Evidencia de acreditación', { exact: true }).fill('Doble clic TEST-ONLY #335')
    await dialog.getByLabel(/Confirmo que verifiqué el comprobante/).check()
    await dialog.getByRole('button', { name: 'Confirmar acreditación', exact: true }).dblclick()
    await expect(dialog.getByRole('status').filter({ hasText: 'Acreditación confirmada por el servidor.' })).toBeVisible()
    expect(submissions).toBe(1)
    expect(await abonoCount(db, scenario.doubleClickUsd!)).toBe(1)
  })

  test('ante un resultado incierto reconsulta y reintenta con la misma clave', async ({ page, db }) => {
    test.setTimeout(60_000)
    await login(page)
    await openPayments(page)
    const keys: Array<string | undefined> = []
    let first = true
    await page.route('**/api/admin/pagos/*/acreditar', async route => {
      keys.push(route.request().headers()['idempotency-key'])
      if (first) {
        first = false
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'RESULTADO_DESCONOCIDO',
            message: 'No se pudo confirmar el resultado de la operación. Reintentá con la misma clave de idempotencia.',
          }),
        })
        return
      }
      await route.continue()
    })

    const dialog = await openAccreditation(page, scenario.retryUsd!)
    try {
      await submitAccreditation(dialog, 'Reintento idempotente TEST-ONLY #335')
      await expect(dialog.getByRole('alert').filter({ hasText: 'El resultado es incierto.' })).toBeVisible()
      await expect(dialog.getByLabel('Evidencia de acreditación', { exact: true })).toBeDisabled()
      expect((await paymentRow(db, scenario.retryUsd!)).estado).toBe('PENDIENTE')
      expect(await abonoCount(db, scenario.retryUsd!)).toBe(0)

      await dialog.getByRole('button', { name: 'Reintentar con la misma clave', exact: true }).click()
      await expect(dialog.getByRole('status').filter({ hasText: 'Acreditación confirmada por el servidor.' })).toBeVisible()
      expect(keys.length).toBeGreaterThanOrEqual(2)
      expect(new Set(keys).size).toBe(1)
      expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      expect(await abonoCount(db, scenario.retryUsd!)).toBe(1)
    } finally {
      await page.unroute('**/api/admin/pagos/*/acreditar')
    }
  })

  test('una respuesta perdida se resuelve consultando el estado, sin duplicar ABONOS', async ({ page, db }) => {
    test.setTimeout(60_000)
    await login(page)
    await openPayments(page)
    let first = true
    await page.route('**/api/admin/pagos/*/acreditar', async route => {
      if (!first) {
        await route.continue()
        return
      }
      first = false
      await route.fetch()
      await route.abort('failed')
    })

    const dialog = await openAccreditation(page, scenario.lostResponseUsd!)
    try {
      await submitAccreditation(dialog, 'Respuesta perdida TEST-ONLY #335')
      await expect(dialog.getByRole('status').filter({ hasText: 'El servidor confirma que el pago está acreditado' })).toBeVisible()
      await expect(dialog.getByText('No afirmamos que la acreditación haya fallado ni que se haya completado.')).toHaveCount(0)
      const row = await paymentRow(db, scenario.lostResponseUsd!)
      expect(row.estado).toBe('ACREDITADO')
      expect(await abonoCount(db, scenario.lostResponseUsd!)).toBe(1)
    } finally {
      await page.unroute('**/api/admin/pagos/*/acreditar')
    }
  })

  test('no ofrece acciones sobre pagos ya acreditados, rechazados, anulados o sin comprobante', async ({ page }) => {
    await login(page)
    await openPayments(page)

    const accredited = card(page, scenario.accreditedUsd!)
    await expect(accredited).toContainText('Acreditado')
    await expect(accredited.getByRole('button', { name: /Acreditar pago/ })).toHaveCount(0)
    await expect(accredited.getByRole('button', { name: /documento del pago/ })).toHaveCount(0)

    const rejected = card(page, scenario.rejectedDoc!)
    await expect(rejected).toContainText('Documento rechazado')
    await expect(rejected).toContainText('Pago rechazado')
    await expect(rejected.getByRole('button', { name: /Acreditar pago|documento del pago/ })).toHaveCount(0)

    const annulled = card(page, scenario.annulled!)
    await expect(annulled).toContainText('Anulado')
    await expect(annulled.getByRole('button', { name: /Acreditar pago|documento del pago/ })).toHaveCount(0)

    const missing = card(page, scenario.missingReceipt!)
    await expect(missing).toContainText('Sin comprobante asociado')
    await expect(missing).toContainText('no se puede aprobar ni acreditar')
    await expect(missing.getByRole('button', { name: /Acreditar pago|documento del pago/ })).toHaveCount(0)
  })

  test('CLIENTE y usuario anónimo no acceden al listado ni a las acciones ADMIN', async ({ page, playwright, baseURL }) => {
    expect(baseURL).toBeTruthy()
    const anon = await playwright.request.newContext({ baseURL })
    try {
      const anonymous = await anon.get('/api/admin/pagos')
      expect(anonymous.status()).toBe(401)
    } finally {
      await anon.dispose()
    }

    await login(page, 'cliente@e2e.test')
    await page.goto('/admin/pagos')
    await expect(page).toHaveURL(/\/acceso-denegado$/)
    await expect(page.getByRole('heading', { name: 'Gestión de pagos' })).toHaveCount(0)
    expect((await page.request.get('/api/admin/pagos')).status()).toBe(403)
    expect((await page.request.fetch(`/api/admin/pagos/${scenario.approvedUsd}/revision`, {
      method: 'PATCH',
      data: { decision: 'APROBADO' },
    })).status()).toBe(403)
    expect((await page.request.post(`/api/admin/pagos/${scenario.approvedUsd}/acreditar`, {
      headers: { 'Idempotency-Key': randomUUID() },
      data: { evidencia: 'Cliente no autorizado' },
    })).status()).toBe(403)
  })

  test('una sesión ADMIN revocada no puede acreditar y no mueve saldos', async ({ page, db }) => {
    test.setTimeout(50_000)
    await login(page, fixture.adminRevokedEmail)
    await openPayments(page)
    await db.query('UPDATE USUARIO SET activo = 0 WHERE id_usuario = ?', [fixture.adminRevokedId])
    try {
      expect((await page.request.get('/api/admin/pagos')).status()).toBe(401)
      await card(page, scenario.revokedAdminUsd!)
        .getByRole('button', { name: `Acreditar pago ${scenario.revokedAdminUsd}`, exact: true })
        .click()
      await expect(page).toHaveURL(/\/login(?:\?|$)/)
      expect(await abonoCount(db, scenario.revokedAdminUsd!)).toBe(0)
      expect((await paymentRow(db, scenario.revokedAdminUsd!)).estado).toBe('PENDIENTE')
    } finally {
      await db.query('UPDATE USUARIO SET activo = 1 WHERE id_usuario = ?', [fixture.adminRevokedId])
    }
  })

  test('descarta respuestas tardías de una sesión ADMIN cerrada', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)
    await openPayments(page)

    let release!: () => void
    const gate = new Promise<void>(resolveGate => { release = resolveGate })
    await page.route('**/api/admin/pagos?**', async route => {
      const response = await route.fetch()
      await gate
      try {
        await route.fulfill({ response })
      } catch {
        // La navegación de cierre de sesión puede cancelar la respuesta.
      }
    })

    try {
      const started = page.waitForRequest(request =>
        request.method() === 'GET' && request.url().includes('/api/admin/pagos?pagina=2'))
      await page.getByRole('button', { name: 'Siguiente página', exact: true }).click()
      await started
      await page.getByRole('button', { name: /Cerrar sesión/ }).click()
      await expect(page).toHaveURL(/\/login(?:\?|$)/)
      release()

      await login(page, 'cliente@e2e.test')
      await page.goto('/mi-cuenta')
      await expect(page.getByText(/Pago #\d+/)).toHaveCount(0)
      expect((await page.request.get('/api/admin/pagos')).status()).toBe(403)
    } finally {
      release()
      await page.unroute('**/api/admin/pagos?**')
    }
  })
})

for (const width of [320, 360, 390, 768, 1280]) {
  test.describe(`Gestión de pagos ADMIN a ${width}px`, () => {
    test.use({ viewport: { width, height: 850 } })

    test('es responsive, accesible por teclado y conserva el foco', async ({ page }) => {
      test.setTimeout(50_000)
      await login(page)
      await openPayments(page)

      expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
      const controls = page.locator('[data-payment-id] button:visible')
      expect(await controls.count()).toBeGreaterThan(0)
      for (const control of await controls.all()) {
        const height = await control.evaluate(element => element.getBoundingClientRect().height)
        expect(height).toBeGreaterThanOrEqual(44)
      }

      const detailButton = card(page, scenario.responsiveUsd!)
        .getByRole('button', { name: `Ver detalle del pago ${scenario.responsiveUsd}`, exact: true })
      await detailButton.click()
      const detailDialog = page.getByRole('dialog', { name: `Pago #${scenario.responsiveUsd}` })
      await expect(detailDialog).toBeVisible()
      await expect(detailDialog.getByRole('button', { name: 'Cerrar detalle', exact: true })).toBeFocused()
      expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
      if (width === 360 || width === 1280) {
        mkdirSync(capturesDir, { recursive: true })
        await page.screenshot({
          path: resolve(capturesDir, `payments-detalle-${width}.jpg`),
          type: 'jpeg',
          quality: 72,
        })
      }
      await detailDialog.getByRole('button', { name: 'Cerrar detalle', exact: true }).click()
      await expect(detailDialog).toHaveCount(0)
      await expect(detailButton).toBeFocused()

      const accreditationTrigger = card(page, scenario.responsiveUsd!)
        .getByRole('button', { name: `Acreditar pago ${scenario.responsiveUsd}`, exact: true })
      await accreditationTrigger.click()
      const dialog = page.getByRole('dialog', { name: new RegExp(`Acreditar pago #${scenario.responsiveUsd}`) })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByLabel('Evidencia de acreditación', { exact: true })).toBeFocused()
      expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
      if (width === 360 || width === 1280) {
        mkdirSync(capturesDir, { recursive: true })
        await page.screenshot({
          path: resolve(capturesDir, `payments-acreditacion-${width}.jpg`),
          type: 'jpeg',
          quality: 72,
        })
      }
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(accreditationTrigger).toBeFocused()

      mkdirSync(capturesDir, { recursive: true })
      await page.screenshot({
        path: resolve(capturesDir, `payments-${width}.jpg`),
        type: 'jpeg',
        quality: 72,
      })
    })
  })
}

const directOrderViewports = [
  { width: 360, paymentKey: 'directOrderUsd360' as const, orderKey: 'directOrder360Id' as const, expectedUsd: 'USD 175,00', expectedDbUsd: '175.00' },
  { width: 1280, paymentKey: 'directOrderUsd1280' as const, orderKey: 'directOrder1280Id' as const, expectedUsd: 'USD 185,00', expectedDbUsd: '185.00' },
]

for (const { width, paymentKey, orderKey, expectedUsd, expectedDbUsd } of directOrderViewports) {
  test.describe(`Acreditación de pago directo a pedido TRANSFERENCIA a ${width}px`, () => {
    test.use({ viewport: { width, height: 850 } })

    test('adapta los mensajes sin anunciar ABONO en cuenta corriente y acredita sin desborde', async ({ page, db }) => {
      test.setTimeout(50_000)
      const paymentId = scenario[paymentKey]!
      const orderId = fixture[orderKey]
      expect(await abonoCount(db, paymentId)).toBe(0)

      await login(page)
      await openPayments(page)

      const paymentCard = card(page, paymentId)
      await expect(paymentCard).toContainText(`Pedido #${orderId}`)
      expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)

      const dialog = await openAccreditation(page, paymentId)
      const description = dialog.locator('#payment-accreditation-description')
      await expect(description).toContainText(`Pedido #${orderId}`)
      await expect(description).toContainText('cobertura financiera exclusiva del pedido directo')
      await expect(description).not.toContainText(/ABONO|cuenta corriente/i)

      const checkboxLabel = dialog.locator('label:has(input[type="checkbox"])')
      await expect(checkboxLabel).toContainText(`Pedido #${orderId}`)
      await expect(checkboxLabel).toContainText('cobertura financiera')
      await expect(checkboxLabel).not.toContainText(/abono|cuenta corriente/i)

      expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
      mkdirSync(capturesDir, { recursive: true })
      await page.screenshot({
        path: resolve(capturesDir, `payments-direct-order-previo-${width}.jpg`),
        type: 'jpeg',
        quality: 72,
      })

      const responsePromise = page.waitForResponse(response =>
        response.request().method() === 'POST'
        && response.url().includes(`/api/admin/pagos/${paymentId}/acreditar`))
      await submitAccreditation(dialog, `Acreditación pedido directo TEST-ONLY #335 (${width}px)`)
      const accreditedResponse = await responsePromise
      expect(accreditedResponse.status()).toBe(200)

      const statusBanner = dialog.getByRole('status').filter({ hasText: 'Acreditación confirmada por el servidor.' })
      await expect(statusBanner).toBeVisible()
      await expect(statusBanner).toContainText(`Pedido #${orderId}`)
      await expect(statusBanner).toContainText(expectedUsd)
      await expect(statusBanner).not.toContainText(/abono|cuenta corriente/i)
      expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)

      await page.screenshot({
        path: resolve(capturesDir, `payments-direct-order-acreditado-${width}.jpg`),
        type: 'jpeg',
        quality: 72,
      })

      await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click()
      await expect(dialog).toHaveCount(0)

      const feedback = page.locator('.payments-feedback')
      await expect(feedback).toContainText(`Pedido #${orderId}`)
      await expect(feedback).toContainText(expectedUsd)
      await expect(feedback).not.toContainText(/abono|cuenta corriente/i)
      await expect(paymentCard).toContainText('Acreditado')
      await expect(paymentCard.getByRole('button', { name: `Acreditar pago ${paymentId}`, exact: true })).toHaveCount(0)
      expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)

      const row = await paymentRow(db, paymentId)
      expect(row.estado).toBe('ACREDITADO')
      expect(row.id_cuenta_corriente).toBeNull()
      expect(Number(row.id_pedido)).toBe(orderId)
      expect(row.monto_usd).toBe(expectedDbUsd)
      expect(await abonoCount(db, paymentId)).toBe(0)
    })
  })
}
