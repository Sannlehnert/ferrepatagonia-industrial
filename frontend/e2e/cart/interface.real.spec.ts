import { test, expect } from '@playwright/test'

test('API real: agrega desde catálogo y conserva el carrito al recargar', async ({
  page,
}) => {
  // Navegador, API y MariaDB reales del ejecutor aislado.
  // No se interceptan respuestas ni se usa la base local.
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(
    'cliente@e2e.test',
  )
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', {
    name: 'Ingresar',
    exact: true,
  }).click()

  await expect(page).toHaveURL(/\/mi-cuenta\/datos$/)

  await page.goto('/catalogo?busqueda=E2E-24')

  const card = page.locator('li').filter({
    has: page.getByRole('heading', {
      name: 'Producto E2E 24',
      exact: true,
    }),
  })
  const add = card.getByRole('button', {
    name: 'Agregar',
    exact: true,
  })

  await expect(card).toHaveCount(1)
  await expect(add).toBeEnabled()

  const creation = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/carrito/items' &&
    response.request().method() === 'POST',
  )

  await add.click()
  expect((await creation).status()).toBe(204)

  const dialog = page.getByRole('dialog', {
    name: 'Tu carrito',
  })
  const drawerQuantity = dialog.getByRole('spinbutton', {
    name: 'Cantidad de Producto E2E 24',
  })

  await expect(dialog).toBeVisible()
  await expect(drawerQuantity).toHaveValue('1')
  await expect(drawerQuantity).toBeEnabled()
  await expect(dialog.getByRole('region', {
    name: 'Resumen del carrito',
  })).toContainText('USD 111.60')

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  await page.reload()
  await expect(add).toBeEnabled()
  await add.click()

  await expect(dialog).toBeVisible()
  await expect(drawerQuantity).toHaveValue('2')
  await expect(drawerQuantity).toBeEnabled()

  await dialog.getByRole('link', {
    name: 'Ver carrito completo',
  }).click()

  await expect(page).toHaveURL(/\/carrito$/)
  await expect(dialog).toHaveCount(0)

  const quantity = page.getByRole('spinbutton', {
    name: 'Cantidad de Producto E2E 24',
  })

  await expect(quantity).toHaveValue('2')
  await expect(quantity).toBeEnabled()
  await expect(page.getByRole('region', {
    name: 'Resumen del carrito',
  })).toContainText('USD 223.20')

  await page.reload()
  await expect(quantity).toHaveValue('2')
  await expect(quantity).toBeEnabled()

  const response = await page.request.get('/api/carrito')
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({
    totalUSD: '223.20',
    items: [
      {
        id_producto: 24,
        cantidad: 2,
        precio: {
          precioUnitarioUSD: '111.60',
          subtotalUSD: '223.20',
        },
      },
    ],
  })

  await page.getByRole('button', {
    name: 'Eliminar Producto E2E 24 del carrito',
  }).click()

  await expect(page.getByText(
    'Tu carrito está vacío.',
    { exact: true },
  )).toBeVisible()

  await page.reload()
  await expect(page.getByText(
    'Tu carrito está vacío.',
    { exact: true },
  )).toBeVisible()
})