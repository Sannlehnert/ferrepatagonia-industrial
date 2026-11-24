import { test, expect } from '@playwright/test'

type CartWarningBrowser = typeof globalThis & {
  __cartWarnings?: string[]
  document: { body: { innerText: string } }
  MutationObserver: new (callback: () => void) => {
    observe(target: unknown, options: Record<string, boolean>): void
  }
}

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

  await expect(page).toHaveURL(/\/mi-cuenta$/)

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

  // D354-06: una actualización de cantidad exitosa contra el backend real no
  // debe mostrar advertencias de resincronización en ningún instante.
  await page.evaluate(() => {
    const browser = globalThis as CartWarningBrowser
    const phrases = [
      'Volvé a consultar el carrito',
      'Stock y precio pendientes de confirmar.',
    ]
    const seen: string[] = []
    browser.__cartWarnings = seen
    const scan = () => {
      const text = browser.document.body.innerText
      for (const phrase of phrases) {
        if (text.includes(phrase) && !seen.includes(phrase)) seen.push(phrase)
      }
    }
    new browser.MutationObserver(scan).observe(browser.document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    })
    scan()
  })
  const update = page.waitForResponse(request =>
    new URL(request.url()).pathname === '/api/carrito/items/24' &&
    request.request().method() === 'PATCH')
  await page.getByRole('button', {
    name: 'Aumentar cantidad de Producto E2E 24',
  }).click()
  expect((await update).status()).toBe(204)
  await expect(quantity).toHaveValue('3')
  const updatedSummary = page.getByRole('region', { name: 'Resumen del carrito' })
  await expect(updatedSummary).toContainText('USD 334.80')
  await expect(page.getByText('Volvé a consultar el carrito', { exact: false })).toHaveCount(0)
  await expect(page.getByText('Stock y precio pendientes de confirmar.', { exact: true }))
    .toHaveCount(0)
  expect(await page.evaluate(() =>
    (globalThis as CartWarningBrowser).__cartWarnings ?? [],
  )).toEqual([])

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