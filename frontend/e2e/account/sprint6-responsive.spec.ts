import { expect, test, type Page } from '@playwright/test'

const viewports = [320, 360, 390, 768, 1024, 1280]

async function assertNoHorizontalScroll(page: Page, contextName: string) {
  const { scrollWidth, clientWidth } = await page.locator('html').evaluate(html => ({
    scrollWidth: html.scrollWidth,
    clientWidth: html.clientWidth,
  }))
  expect(
    scrollWidth,
    `Desborde horizontal en ${contextName}: scrollWidth (${scrollWidth}) > clientWidth (${clientWidth})`,
  ).toBeLessThanOrEqual(clientWidth)
}

async function loginClient(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('cliente@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible()
}

for (const width of viewports) {
  test.describe(`Validación de adaptabilidad responsive: ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } })

    test(`Detalle Público sin scroll horizontal a ${width}px`, async ({ page }) => {
      // 1. Detalle Público de Producto (#272)
      await page.goto('/producto/2')
      await expect(page.getByRole('heading', { name: /Producto E2E 02|Detalle del producto/ })).toBeVisible()
      await assertNoHorizontalScroll(page, `Detalle de Producto a ${width}px`)

      const addButton = page.getByRole('button', { name: 'Agregar', exact: true })
      if (await addButton.isVisible()) {
        const box = await addButton.boundingBox()
        expect(box).not.toBeNull()
        if (box) {
          expect(box.height).toBeGreaterThanOrEqual(44)
          expect(box.width).toBeGreaterThanOrEqual(44)
        }
      }
    })

    test(`Carrito, Mi Cuenta y Navegación sin desborde a ${width}px`, async ({ page }) => {
      await loginClient(page)

      // 2. Carrito de cliente
      await page.goto('/carrito')
      await expect(page.getByRole('heading', { name: 'Tu carrito', exact: true })).toBeVisible()
      await assertNoHorizontalScroll(page, `Carrito a ${width}px`)

      // 3. Mi Cuenta - Datos Personales (#274)
      await page.goto('/mi-cuenta/datos')
      await expect(page.getByRole('heading', { name: 'Mis datos', exact: true })).toBeVisible()
      await assertNoHorizontalScroll(page, `Mi Cuenta Datos a ${width}px`)

      // 4. Mi Cuenta - Historial de Pedidos (#274)
      await page.goto('/mi-cuenta/pedidos')
      await expect(page.getByRole('heading', { name: 'Mis pedidos', exact: true })).toBeVisible()
      await assertNoHorizontalScroll(page, `Historial de Pedidos a ${width}px`)

      // Validar área táctil del botón Cerrar Sesión
      const logoutBtn = page.getByRole('button', { name: 'Cerrar sesión', exact: true })
      await expect(logoutBtn).toBeVisible()
      const logoutBox = await logoutBtn.boundingBox()
      expect(logoutBox).not.toBeNull()
      if (logoutBox) {
        expect(logoutBox.height).toBeGreaterThanOrEqual(44)
        expect(logoutBox.width).toBeGreaterThanOrEqual(44)
      }
    })
  })
}
