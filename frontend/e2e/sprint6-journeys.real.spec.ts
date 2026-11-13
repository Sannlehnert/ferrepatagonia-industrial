import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { expect, test as base, type Locator, type Page } from '@playwright/test'

interface Session {
  connection: {
    query<T = unknown>(statement: string, values: unknown[]): Promise<T>
    end(): Promise<void>
  }
}

const require = createRequire(import.meta.url)
const { connectOwned } = require('../../backend/test/helpers/cc260-disposable.cjs') as {
  connectOwned(profile: unknown, runner: 'E2E'): Promise<Session>
}
const { createOrderFixture } = require('../../backend/test/helpers/account-order.fixture.cjs') as {
  createOrderFixture(session: Session, options: { limit: string }): Promise<{
    clientId: number; userId: number; categoryId: number; productId: number
  }>
}
const bcrypt = require('../../backend/node_modules/bcrypt')

const product = 'Llave industrial de ajuste ' + 'EXTRALARGA'.repeat(8)
const eligibilityPath = '/api/pedidos/cuenta-corriente/eligibilidad'

async function seed(session: Session, fixture: Awaited<ReturnType<typeof createOrderFixture>>) {
  const email = randomUUID() + '@e2e.test'
  const name = 'Empresa S6 ' + fixture.clientId
  const password = 'S6-' + randomUUID() + '!'
  await session.connection.query(
    'UPDATE USUARIO SET email = ?, password_hash = ? WHERE id_usuario = ?',
    [email, await bcrypt.hash(password, 4), fixture.userId],
  )
  await session.connection.query('UPDATE CLIENTE SET email = ?, nombre_razon_social = ? WHERE id_cliente = ?',
    [email, name, fixture.clientId])
  await session.connection.query('UPDATE PRODUCTO SET nombre = ? WHERE id_producto = ?', [product, fixture.productId])
  return { ...fixture, email, name, password, db: session.connection }
}

const test = base.extend<{ company: Awaited<ReturnType<typeof seed>> }>({
  company: async ({}, use) => {
    const profile = process.env.CCE2E_TEST_PROFILE
    if (!profile) throw new Error('Ejecutá las pruebas con backend/test/helpers/run-e2e.cjs')
    const session = await connectOwned(JSON.parse(profile), 'E2E')
    let fixture: Awaited<ReturnType<typeof createOrderFixture>> | undefined
    try {
      fixture = await createOrderFixture(session, { limit: '25.00' })
      await use(await seed(session, fixture))
    } finally {
      try {
        if (fixture) {
          // Preservar el catálogo base para las otras suites del mismo runner.
          await session.connection.query('UPDATE CATEGORIA SET activo = 0 WHERE id_categoria = ?', [fixture.categoryId])
        }
      } finally {
        await session.connection.end()
      }
    }
  },
})

async function login(page: Page, email: string, password: string, landing: string) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel(/^Contraseña/).fill(password)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(landing)
}

async function assertPageFits(page: Page) {
  const { scrollWidth, clientWidth } = await page.locator('html').evaluate(html => ({
    scrollWidth: html.scrollWidth,
    clientWidth: html.clientWidth,
  }))
  expect.soft(scrollWidth, 'El documento no debe tener desborde horizontal').toBeLessThanOrEqual(clientWidth)
}

async function assertControlFits(control: Locator) {
  await control.scrollIntoViewIfNeeded()
  const { left, right, width } = await control.evaluate(element => {
    const { left, right } = element.getBoundingClientRect()
    return { left, right, width: element.ownerDocument.documentElement.clientWidth }
  })
  expect.soft(left).toBeGreaterThanOrEqual(-1)
  expect.soft(right).toBeLessThanOrEqual(width + 1)
}

test('la decisión de ADMIN modifica la elegibilidad visible de la empresa', async ({ page, browser, company }) => {
  await company.db.query("UPDATE CLIENTE SET estado_aprobacion_empresa = 'PENDIENTE' WHERE id_cliente = ?", [company.clientId])
  await page.setViewportSize({ width: 360, height: 844 })
  await login(page, 'admin@e2e.test', 'E2eLocal-214!', '/admin/dashboard')
  await page.goto('/admin/clientes')
  const table = page.getByRole('region', { name: /Listado de clientes/ })
  const row = table.getByRole('row').filter({ hasText: company.email })
  await expect(row.getByText('Pendiente', { exact: true })).toBeVisible()
  await assertPageFits(page)
  expect(await table.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)

  const clientContext = await browser.newContext()
  try {
    const client = await clientContext.newPage()
    await login(client, company.email, company.password, '/mi-cuenta/datos')
    const checkout = client.getByRole('region', { name: 'Confirmación de pedido' })
    async function readEligibility(navigate: () => Promise<unknown>) {
      const eligibility = client.waitForResponse(response =>
        new URL(response.url()).pathname === eligibilityPath && response.request().method() === 'GET')
      await navigate()
      const response = await eligibility
      expect(response.ok()).toBe(true)
      return (await response.json()).data
    }
    async function expectBlocked() {
      await expect(checkout.getByRole('alert')).toHaveText('La empresa no está aprobada para esta operación.')
      await expect(checkout.getByRole('button', { name: 'Finalizar compra' })).toBeDisabled()
      await expect(checkout.getByRole('radio', { name: 'Cuenta corriente' })).toHaveCount(0)
    }
    const blocked = { elegible: false, codigo: 'EMPRESA_NO_HABILITADA', cotizacion: null }
    expect(await readEligibility(() => client.goto('/carrito'))).toMatchObject(blocked)
    await expectBlocked()

    await row.getByRole('button', { name: 'Rechazar cuenta empresa de ' + company.name }).click()
    await expect(row.getByText('Rechazada', { exact: true })).toBeVisible()
    expect(await readEligibility(() => client.reload())).toMatchObject(blocked)
    await expectBlocked()

    await row.getByRole('button', { name: 'Aprobar cuenta empresa de ' + company.name }).click()
    await expect(row.getByText('Aprobada', { exact: true })).toBeVisible()
    expect(await readEligibility(() => client.reload())).toMatchObject({
      elegible: true, totalUSD: '20.00', creditoDisponibleUSD: '25.00', cotizacion: expect.any(String),
    })
    await checkout.getByRole('radio', { name: 'Cuenta corriente' }).check()
    await expect(checkout.getByRole('button', { name: 'Confirmar pedido a cuenta corriente' })).toBeEnabled()

    expect(await readEligibility(() =>
      client.getByRole('button', { name: 'Aumentar cantidad de ' + product }).click(),
    )).toMatchObject({ elegible: false, codigo: 'CREDITO_INSUFICIENTE', totalUSD: '30.00' })
    await expect(checkout.getByRole('alert')).toHaveText('El crédito disponible no alcanza para confirmar el pedido.')
    await expect(checkout.getByRole('button', { name: 'Finalizar compra' })).toBeDisabled()
  } finally {
    await clientContext.close()
  }
})

for (const width of [320, 360, 390, 768, 1024, 1280]) {
  test(`carrito y Mi Cuenta con datos reales a ${width} px`, async ({ page, company }, info) => {
    const order = await company.db.query<{ insertId: bigint }>(`
      INSERT INTO PEDIDO (id_cliente, estado, modalidad_pago, subtotal, descuento, total, moneda_total)
      VALUES (?, 'EN_PREPARACION', 'TRANSFERENCIA', 20, 0, 20, 'USD')
    `, [company.clientId])
    await company.db.query(`
      INSERT INTO DETALLE_PEDIDO (id_pedido, id_producto, cantidad, precio_unitario, descuento, subtotal)
      VALUES (?, ?, 2, 10, 0, 20)
    `, [order.insertId, company.productId])

    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await login(page, company.email, company.password, '/mi-cuenta/datos')

    async function capture(name: string) {
      if (process.env.SPRINT6_284_CAPTURES !== '1') return
      const path = info.outputPath(`${name}-${width}.png`)
      await page.screenshot({ path, fullPage: true, animations: 'disabled' })
      await info.attach(`${name} ${width} px`, { path, contentType: 'image/png' })
    }

    await assertPageFits(page)
    const mobileMenu = page.getByRole('button', { name: 'Menú de navegación de cuenta' })
    if (width < 768) {
      await expect(mobileMenu).toBeVisible()
      await mobileMenu.press('Enter')
      await expect(mobileMenu).toHaveAttribute('aria-expanded', 'true')
    }
    const accountNav = page.getByRole('link', { name: 'Historial de pedidos', exact: true })
    await expect(accountNav).toBeVisible()
    await assertPageFits(page)
    await accountNav.press('Enter')
    await expect(page).toHaveURL('/mi-cuenta/pedidos')
    if (width < 768) await expect(mobileMenu).toHaveAttribute('aria-expanded', 'false')
    const orderNumber = /^PED-\d+$/
    await expect(page.getByRole('heading', { name: orderNumber })).toBeVisible()
    const toggle = page.getByRole('button', { name: /^Ver detalle de PED-/ })
    await assertControlFits(toggle)
    await toggle.press('Enter')
    await expect(page.getByRole('button', { name: /^Ocultar detalle de PED-/ })).toBeFocused()
    await expect(page.getByText(product, { exact: true })).toBeVisible()
    await expect(page.getByText('Cantidad 2 · Precio unitario 10.00 USD')).toBeVisible()
    await assertPageFits(page)
    await capture('historial')

    await page.goto('/carrito')
    const quantity = page.getByRole('spinbutton', { name: 'Cantidad de ' + product })
    await expect(quantity).toHaveValue('2')
    await assertControlFits(quantity)
    const checkout = page.getByRole('region', { name: 'Confirmación de pedido' })
    await assertControlFits(checkout)
    const radio = checkout.getByRole('radio', { name: 'Cuenta corriente' })
    await expect(radio).toBeVisible()
    await radio.press('Space')
    const confirm = checkout.getByRole('button', { name: 'Confirmar pedido a cuenta corriente' })
    await expect(confirm).toBeEnabled()
    await assertControlFits(confirm)
    await assertPageFits(page)
    await capture('carrito')

    await page.getByRole('button', { name: 'Eliminar ' + product + ' del carrito' }).press('Enter')
    await expect(page.getByText('Tu carrito está vacío.', { exact: true })).toBeVisible()
    await assertPageFits(page)
    if (width === 320) await capture('carrito-vacio')
  })
}
