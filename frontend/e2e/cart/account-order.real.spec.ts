import { test, expect } from '@playwright/test'

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('cc258-empty@example.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/mi-cuenta\/datos$/)
}

test('H01/H02: dos pestañas rechazan cotización vieja y permiten una segunda compra', async ({ page, context }) => {
  // Conserva una cotización desactualizada y ejercita la recuperación manual con el transporte caído.
  await context.route('**/socket.io/**', route => route.abort())
  let dropPostResponse = false
  let failCartRead = false
  await page.route('**/api/pedidos/cuenta-corriente', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch()
    if (dropPostResponse) {
      dropPostResponse = false
      await response.body()
      return route.abort('failed')
    }
    return route.fulfill({ response })
  })
  await page.route('**/api/carrito', async route => {
    if (route.request().method() === 'GET' && failCartRead) {
      failCartRead = false
      return route.fulfill({ status: 500, json: { message: 'Error al resincronizar.' } })
    }
    return route.continue()
  })
  await signIn(page)
  await page.goto('/catalogo?busqueda=E2E-24')
  const card = page.locator('li').filter({
    has: page.getByRole('heading', { name: 'Producto E2E 24', exact: true }),
  })
  const add = card.getByRole('button', { name: 'Agregar', exact: true })
  await expect(add).toBeEnabled()
  const added = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/carrito/items' &&
    response.request().method() === 'POST')
  await add.click()
  expect((await added).status()).toBe(204)
  await page.goto('/carrito')

  const summary = page.getByRole('region', { name: 'Resumen del carrito' })
  await expect(summary).toContainText('USD 124.00')
  await expect(summary.getByRole('radio', { name: 'Cuenta corriente' })).toBeVisible()

  const secondTab = await context.newPage()
  await secondTab.goto(page.url())
  const staleSummary = secondTab.getByRole('region', { name: 'Resumen del carrito' })
  await expect(staleSummary).toContainText('USD 124.00')
  const quantity = secondTab.getByRole('region', { name: 'Contenido del carrito' })
    .getByRole('spinbutton', { name: 'Cantidad de Producto E2E 24' })
  await quantity.fill('2')
  await quantity.press('Tab')
  await expect(quantity).toHaveValue('2')

  await summary.getByRole('radio', { name: 'Cuenta corriente' }).check()
  await summary.getByRole('button', { name: 'Confirmar pedido a cuenta corriente' }).click()
  await expect(summary.getByRole('alert')).toContainText('El carrito o sus precios cambiaron')
  await summary.getByRole('button', { name: 'Actualizar carrito y crédito para reintentar' }).click()
  await expect(summary).toContainText('USD 248.00')
  await summary.getByRole('radio', { name: 'Cuenta corriente' }).check()
  await summary.getByRole('button', { name: 'Confirmar pedido a cuenta corriente' }).click()
  await expect(page.getByRole('list', { name: 'Comprobantes de pedidos confirmados' }))
    .toContainText('USD 248.00')
  await expect(page.getByText('Tu carrito está vacío.', { exact: true })).toBeVisible()

  await page.goto('/catalogo?busqueda=E2E-24')
  const secondAdd = page.locator('li').filter({
    has: page.getByRole('heading', { name: 'Producto E2E 24', exact: true }),
  }).getByRole('button', { name: 'Agregar', exact: true })
  const addedAgain = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/carrito/items' &&
    response.request().method() === 'POST')
  await secondAdd.click()
  expect((await addedAgain).status()).toBe(204)
  await page.getByRole('link', { name: 'Ver carrito completo' }).click()
  const nextSummary = page.getByRole('region', { name: 'Resumen del carrito' })
  await expect(nextSummary.getByRole('radio', { name: 'Cuenta corriente' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Comprobantes de pedidos confirmados' }))
    .toContainText('USD 248.00')
  await nextSummary.getByRole('radio', { name: 'Cuenta corriente' }).check()
  dropPostResponse = true
  await nextSummary.getByRole('button', { name: 'Confirmar pedido a cuenta corriente' }).click()
  await expect(nextSummary).toContainText('todavía no tiene un resultado definitivo')
  failCartRead = true
  await nextSummary.getByRole('button', { name: 'Consultar resultado' }).click()
  await expect(page.getByRole('list', { name: 'Comprobantes de pedidos confirmados' }))
    .toContainText('USD 124.00')
  await expect(page.getByRole('region', { name: 'Contenido del carrito' }).getByRole('alert')
    .filter({ hasText: 'servidor no pudo procesar el carrito' }))
    .toContainText('servidor no pudo procesar el carrito')
  await page.getByRole('region', { name: 'Contenido del carrito' })
    .getByRole('button', { name: 'Volver a consultar carrito' }).click()
  await expect(page.getByRole('list', { name: 'Comprobantes de pedidos confirmados' }).getByRole('status'))
    .toHaveCount(2)
  await expect(page.getByText('Tu carrito está vacío.', { exact: true })).toBeVisible()

  const cartResponse = await page.request.get('/api/carrito')
  expect(cartResponse.status()).toBe(200)
  expect((await cartResponse.json()).items).toEqual([])
  await secondTab.close()
})
