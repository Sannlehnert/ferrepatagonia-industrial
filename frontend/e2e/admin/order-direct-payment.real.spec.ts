import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

interface OwnedSession {
  connection: {
    query<T = unknown>(statement: string, values?: unknown[]): Promise<T>
    end(): Promise<void>
  }
}

interface OrderFixture {
  clientId: number
  userId: number
  categoryId: number
  productId: number
  cartId: number
}

interface Customer extends OrderFixture {
  email: string
  password: string
  name: string
}

const require = createRequire(import.meta.url)
const { connectOwned } = require('../../../backend/test/helpers/cc260-disposable.cjs') as {
  connectOwned(profile: unknown, runner: 'E2E'): Promise<OwnedSession>
}
const { createOrderFixture } = require('../../../backend/test/helpers/account-order.fixture.cjs') as {
  createOrderFixture(
    session: OwnedSession,
    options?: Record<string, unknown>,
  ): Promise<OrderFixture>
}
const bcrypt = require('../../../backend/node_modules/bcrypt')

const adminCredentials = { email: 'admin@e2e.test', password: 'E2eLocal-214!' }
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwYMEAoAU7oL9W/sIDEAAAAASUVORK5CYII=',
  'base64',
)

const databaseTest = test.extend<{ session: OwnedSession; fixtures: OrderFixture[]; cleanup: void }>({
  session: async ({}, use) => {
    const profile = process.env.CCE2E_TEST_PROFILE
    if (!profile) throw new Error('Ejecutá las pruebas con backend/test/helpers/run-e2e.cjs')
    const owned = await connectOwned(JSON.parse(profile), 'E2E')
    try {
      await use(owned)
    } finally {
      await owned.connection.end()
    }
  },
  fixtures: async ({}, use) => {
    await use([])
  },
  cleanup: [async ({ session, fixtures }, use) => {
    await use()
    for (const fixture of fixtures) {
      await session.connection.query('UPDATE PRODUCTO SET activo = 0 WHERE id_producto = ?', [fixture.productId])
      await session.connection.query('UPDATE CATEGORIA SET activo = 0 WHERE id_categoria = ?', [fixture.categoryId])
    }
  }, { auto: true }],
})

async function customer(session: OwnedSession, fixtures: OrderFixture[]): Promise<Customer> {
  const fixture = await createOrderFixture(session, {
    clientType: 'PARTICULAR',
    withAccount: false,
    price: '10.00',
    quantity: 2,
    stock: 5,
  })
  fixtures.push(fixture)
  const email = `${randomUUID()}@example.test`
  const password = `Direct-${randomUUID()}!`
  const name = `Particular pago directo ${fixture.clientId}`
  await session.connection.query('UPDATE CLIENTE SET nombre_razon_social = ? WHERE id_cliente = ?', [name, fixture.clientId])
  await session.connection.query('UPDATE USUARIO SET email = ?, password_hash = ? WHERE id_usuario = ?', [
    email, await bcrypt.hash(password, 4), fixture.userId,
  ])
  return { ...fixture, email, password, name }
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel(/^Contraseña/).fill(password)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/mi-cuenta$/)
}

async function signInAdmin(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(adminCredentials.email)
  await page.getByLabel(/^Contraseña/).fill(adminCredentials.password)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard$/)
}

async function confirmTransferOrder(page: Page): Promise<number> {
  const eligibility = page.waitForResponse(response =>
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/pedidos/transferencia/eligibilidad')
  await page.goto('/carrito')
  expect((await eligibility).status()).toBe(200)

  const summary = page.getByRole('region', { name: 'Resumen del carrito' })
  const confirmation = page.waitForResponse(response =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/pedidos/transferencia')
  await summary.getByRole('button', { name: 'Confirmar pedido por transferencia' }).click()
  const response = await confirmation
  expect(response.status()).toBe(201)
  return (await response.json()).data.pedidoId as number
}

async function attachReceipt(page: Page) {
  const receipts = page.getByRole('region', { name: 'Comprobantes de pago' })
  await receipts.getByLabel(/Archivo \(PDF/).setInputFiles({
    name: 'transferencia.png', mimeType: 'image/png', buffer: png,
  })
  await receipts.getByRole('button', { name: 'Adjuntar comprobante' }).click()
  await expect(receipts.getByText(/Comprobante recibido/)).toBeVisible()
  await expect(receipts.getByText('Pendiente de revisión')).toBeVisible()
}

async function reviewReceipt(page: Page, orderId: number) {
  await page.goto('/admin/comprobantes')
  const receipts = page.getByRole('region', { name: 'Comprobantes de pago' })
  const operation = `Pedido PED-${String(orderId).padStart(6, '0')}`
  const row = receipts.getByRole('listitem').filter({ hasText: operation })
  await expect(row).toBeVisible()
  await expect(row).toContainText('Pendiente de revisión')
  await row.getByRole('button', { name: 'Aprobar comprobante' }).click()
  await expect(row.getByText('Aprobado', { exact: true })).toBeVisible()
}

async function openAdminOrder(page: Page, orderId: number) {
  await page.goto(`/admin/pedidos?q=${orderId}`)
  const detailButton = page.getByRole('button', { name: `Ver detalle del pedido ${orderId}` })
  await expect(detailButton).toBeVisible()
  await detailButton.click()
  const dialog = page.getByRole('dialog', { name: `Detalle del Pedido ${orderId}` })
  await expect(dialog).toBeVisible()
  return dialog
}

async function paymentRows(session: OwnedSession, orderId: number) {
  return session.connection.query<Array<{
    id_pago: number
    monto: string
    moneda: string
    estado: string
    id_cuenta_corriente: number | null
    id_comprobante: string | null
    monto_usd: string | null
  }>>(
    `SELECT id_pago, monto, moneda, estado, id_cuenta_corriente, id_comprobante, monto_usd
     FROM PAGO WHERE id_pedido = ? ORDER BY id_pago`,
    [orderId],
  )
}

async function abonoCount(session: OwnedSession, orderId: number) {
  const [row] = await session.connection.query<Array<{ total: number }>>(
    `SELECT COUNT(*) AS total
     FROM MOVIMIENTO_CUENTA_CORRIENTE m
     INNER JOIN PAGO p ON p.id_pago = m.id_pago
     WHERE p.id_pedido = ? AND m.tipo_movimiento = 'ABONO'`,
    [orderId],
  )
  return Number(row?.total ?? 0)
}

for (const width of [360, 1280]) {
  databaseTest(`ADMIN registra y acredita el pago directo desde el detalle del pedido (${width}px)`, async ({
    page, browser, session, fixtures,
  }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 900 })
    const client = await customer(session, fixtures)

    await signIn(page, client.email, client.password)
    const orderId = await confirmTransferOrder(page)
    await attachReceipt(page)

    const admin = await browser.newPage()
    await admin.setViewportSize({ width, height: 900 })
    try {
      await signInAdmin(admin)
      await reviewReceipt(admin, orderId)

      const dialog = await openAdminOrder(admin, orderId)
      await expect(dialog).toContainText('Sin pago acreditado')
      await expect(dialog.getByRole('button', { name: 'Registrar pago', exact: true })).toBeVisible()

      await dialog.getByRole('button', { name: 'Registrar pago', exact: true }).click()
      const registration = admin.getByRole('dialog', { name: `Registrar pago del pedido #${orderId}` })
      await expect(registration).toBeVisible()
      await expect(registration).toContainText(client.name)
      await expect(registration).toContainText('USD 20.00')
      await expect(registration).toContainText('Aprobado')

      await registration.getByLabel('Importe recibido', { exact: true }).fill('20.00')
      await registration.getByLabel('Moneda', { exact: true }).selectOption('USD')
      await registration.getByLabel('Referencia (opcional)', { exact: true }).fill(`TRF-${orderId}`)
      await registration.getByLabel('Observaciones (opcionales)', { exact: true }).fill('Pago directo E2E')
      await registration.getByRole('checkbox').check()

      const created = admin.waitForResponse(response =>
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/admin/pagos')
      await registration.getByRole('button', { name: 'Registrar pago', exact: true }).click()
      const createdResponse = await created
      expect(createdResponse.status()).toBe(201)
      const createdPayment = (await createdResponse.json()).data
      expect(createdPayment).toMatchObject({
        pedidoId: orderId,
        cuentaCorrienteId: null,
        monto: '20.00',
        moneda: 'USD',
        estado: 'PENDIENTE',
      })
      expect(createdPayment.comprobanteId).toBeNull()

      const success = registration.getByRole('status')
      await expect(success).toContainText(`Pago #${createdPayment.id} registrado por el servidor`)
      await expect(success).toContainText('PENDIENTE')
      await expect(success).toContainText('No se acreditó automáticamente')
      await expect(registration.getByRole('link', { name: 'Ir a Gestión de pagos' })).toBeVisible()

      const pendingRows = await paymentRows(session, orderId)
      expect(pendingRows).toEqual([{
        id_pago: createdPayment.id,
        monto: '20.00',
        moneda: 'USD',
        estado: 'PENDIENTE',
        id_cuenta_corriente: null,
        id_comprobante: null,
        monto_usd: null,
      }])
      expect(await abonoCount(session, orderId)).toBe(0)

      await registration.getByRole('button', { name: 'Cerrar', exact: true }).click()
      await expect(registration).toHaveCount(0)

      const registered = dialog.getByRole('region', { name: 'Pagos registrados del pedido' })
      const paymentRow = registered.getByRole('listitem').filter({ hasText: `Pago #${createdPayment.id}` })
      await expect(paymentRow).toContainText('Pendiente de acreditación')
      await paymentRow.getByRole('button', { name: `Acreditar pago ${createdPayment.id}`, exact: true }).click()

      const accreditation = admin.getByRole('dialog', { name: `Acreditar pago #${createdPayment.id}` })
      await expect(accreditation).toBeVisible()
      await expect(accreditation).toContainText(`Pedido #${orderId}`)
      await accreditation.getByLabel('Evidencia de acreditación', { exact: true }).fill('Extracto bancario E2E')
      await accreditation.getByRole('checkbox').check()

      const accredited = admin.waitForResponse(response =>
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/admin/pagos/${createdPayment.id}/acreditar`)
      await accreditation.getByRole('button', { name: 'Confirmar acreditación', exact: true }).click()
      const accreditedResponse = await accredited
      expect(accreditedResponse.status()).toBe(200)
      await expect(accreditation.getByRole('status')).toContainText('Acreditación confirmada por el servidor')
      await accreditation.getByRole('button', { name: 'Cerrar', exact: true }).click()
      await expect(accreditation).toHaveCount(0)

      await expect(registered.getByRole('listitem').filter({ hasText: `Pago #${createdPayment.id}` }))
        .toContainText('Acreditado')
      await expect(dialog).toContainText('Pago acreditado')
      await expect(dialog).toContainText('USD 20,00')

      const accreditedRows = await paymentRows(session, orderId)
      expect(accreditedRows).toHaveLength(1)
      expect(accreditedRows[0]).toMatchObject({
        id_pago: createdPayment.id,
        estado: 'ACREDITADO',
        id_cuenta_corriente: null,
        id_comprobante: null,
        monto_usd: '20.00',
      })
      expect(await abonoCount(session, orderId)).toBe(0)

      await dialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click()
      await expect(dialog).toHaveCount(0)

      await admin.goto('/admin/pagos')
      const paymentCard = admin.locator(`[data-payment-id="${createdPayment.id}"]`)
      await expect(paymentCard).toBeVisible()
      await expect(paymentCard).toContainText(`Pedido #${orderId}`)
      await expect(paymentCard).toContainText('Acreditado')
      await expect(paymentCard).toContainText('USD 20,00')

      await page.goto('/mi-cuenta/pedidos')
      await expect(page.getByRole('button', { name: /^Ver detalle de PED-/ })).toBeVisible()
      await page.getByRole('button', { name: /^Ver detalle de PED-/ }).click()
      await expect(page.getByRole('listitem').filter({ hasText: 'Pago acreditado' })).toContainText('Acreditado: US$ 20,00')
    } finally {
      await admin.close()
    }

    expect(await abonoCount(session, orderId)).toBe(0)
    expect(await paymentRows(session, orderId)).toHaveLength(1)
    if (width === 360) {
      const scrollWidth = await page.locator('html').evaluate(element => element.scrollWidth)
      expect(scrollWidth).toBeLessThanOrEqual(360)
    }
  })
}

databaseTest('bloquea el doble envío y no duplica el pago directo', async ({ page, browser, session, fixtures }) => {
  test.setTimeout(60_000)
  const client = await customer(session, fixtures)
  await signIn(page, client.email, client.password)
  const orderId = await confirmTransferOrder(page)

  const admin = await browser.newPage()
  try {
    await signInAdmin(admin)
    const dialog = await openAdminOrder(admin, orderId)
    await dialog.getByRole('button', { name: 'Registrar pago', exact: true }).click()
    const registration = admin.getByRole('dialog', { name: `Registrar pago del pedido #${orderId}` })
    await registration.getByLabel('Importe recibido', { exact: true }).fill('20.00')
    await registration.getByLabel('Moneda', { exact: true }).selectOption('USD')
    await registration.getByRole('checkbox').check()

    let posts = 0
    let release = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    await admin.route('**/api/admin/pagos', async route => {
      if (route.request().method() !== 'POST') return route.continue()
      posts++
      await gate
      await route.continue()
    })

    try {
      const created = admin.waitForResponse(response =>
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/admin/pagos')
      await registration.getByRole('button', { name: 'Registrar pago', exact: true }).click()
      await expect(registration.getByRole('button', { name: 'Registrando…', exact: true })).toBeDisabled()
      await expect.poll(() => posts).toBe(1)

      await registration.getByRole('button', { name: 'Registrando…', exact: true }).dispatchEvent('click')
      expect(posts).toBe(1)

      release()
      expect((await created).status()).toBe(201)
    } finally {
      release()
    }

    await expect(registration.getByRole('status')).toContainText('registrado por el servidor')
    const rows = await paymentRows(session, orderId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.estado).toBe('PENDIENTE')
    expect(await abonoCount(session, orderId)).toBe(0)
  } finally {
    await admin.close()
  }
})

databaseTest('recupera un resultado incierto sin duplicar el pago directo', async ({ page, browser, session, fixtures }) => {
  test.setTimeout(60_000)
  const client = await customer(session, fixtures)
  await signIn(page, client.email, client.password)
  const orderId = await confirmTransferOrder(page)

  const admin = await browser.newPage()
  try {
    await signInAdmin(admin)
    const dialog = await openAdminOrder(admin, orderId)
    await dialog.getByRole('button', { name: 'Registrar pago', exact: true }).click()
    const registration = admin.getByRole('dialog', { name: `Registrar pago del pedido #${orderId}` })
    await registration.getByLabel('Importe recibido', { exact: true }).fill('20.00')
    await registration.getByLabel('Moneda', { exact: true }).selectOption('USD')
    await registration.getByRole('checkbox').check()

    let key = ''
    let createdId = 0
    await admin.route('**/api/admin/pagos', async route => {
      if (route.request().method() !== 'POST') return route.continue()
      key = route.request().headers()['idempotency-key'] ?? ''
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      const response = await admin.request.post('/api/admin/pagos', {
        headers: { Origin: new URL(admin.url()).origin, 'Idempotency-Key': key },
        data: route.request().postDataJSON(),
      })
      expect(response.status()).toBe(201)
      createdId = (await response.json()).data.id
      await route.abort('failed')
    }, { times: 1 })

    await registration.getByRole('button', { name: 'Registrar pago', exact: true }).click()

    const success = registration.getByRole('status')
    await expect(success).toContainText(/El servidor confirmó el registro existente #\d+/)
    await expect.poll(() => createdId).toBeGreaterThan(0)
    await expect(success).toContainText(`#${createdId}`)
    await expect(success).toContainText('No se acreditó automáticamente')

    const rows = await paymentRows(session, orderId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id_pago: createdId, estado: 'PENDIENTE', monto: '20.00' })
    const [stored] = await session.connection.query<Array<{ clave_idempotencia: string }>>(
      'SELECT clave_idempotencia FROM PAGO WHERE id_pago = ?', [createdId],
    )
    expect(stored?.clave_idempotencia).toBe(key)
    expect(await abonoCount(session, orderId)).toBe(0)
  } finally {
    await admin.close()
  }
})

databaseTest('CLIENTE no puede registrar ni acreditar pagos administrativos', async ({ page, session, fixtures }) => {
  const client = await customer(session, fixtures)
  await signIn(page, client.email, client.password)

  const createResponse = await page.request.post('/api/admin/pagos', {
    headers: { Origin: new URL(page.url()).origin, 'Idempotency-Key': randomUUID() },
    data: {
      pedidoId: 1,
      cuentaCorrienteId: null,
      monto: '1.00',
      moneda: 'USD',
      metodoPago: 'TRANSFERENCIA',
      estado: 'PENDIENTE',
    },
  })
  expect(createResponse.status()).toBe(403)
  const accreditResponse = await page.request.post('/api/admin/pagos/1/acreditar', {
    headers: { Origin: new URL(page.url()).origin, 'Idempotency-Key': randomUUID() },
    data: { evidencia: 'Intento CLIENTE' },
  })
  expect(accreditResponse.status()).toBe(403)
})
