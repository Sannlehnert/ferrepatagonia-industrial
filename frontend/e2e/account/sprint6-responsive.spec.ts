import { expect, test, type Page } from '@playwright/test'

const viewports = [320, 360, 390, 768, 1024, 1280]

// El proyecto de tipos E2E usa Node; estas APIs solo existen dentro del navegador.
type SearchInput = {
  clientWidth: number
  placeholder: string
  ownerDocument: {
    fonts: { ready: Promise<unknown> }
    defaultView: {
      getComputedStyle(input: SearchInput, pseudo?: string): { getPropertyValue(name: string): string }
    }
    createElement(tag: 'canvas'): {
      getContext(kind: '2d'): { font: string; measureText(text: string): { width: number } }
    }
  }
}

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
  const logoutBtn = page.getByRole('button', { name: 'Cerrar sesión', exact: true })
  const menuToggle = page.getByRole('button', { name: 'Menú de navegación de cuenta' })
  await expect(logoutBtn.or(menuToggle)).toBeVisible()
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
      if (width === 320) {
        const search = page.getByRole('searchbox', { name: 'Buscar productos por nombre o código' })
        await expect(search).toBeVisible()
        const { textWidth, availableWidth } = await search.evaluate(async element => {
          const input = element as unknown as SearchInput
          const doc = input.ownerDocument
          await doc.fonts.ready
          const style = doc.defaultView.getComputedStyle(input)
          const placeholder = doc.defaultView.getComputedStyle(input, '::placeholder')
          const ctx = doc.createElement('canvas').getContext('2d')
          ctx.font = ['font-style', 'font-weight', 'font-size', 'font-family']
            .map(property => placeholder.getPropertyValue(property)).join(' ')
          return {
            textWidth: ctx.measureText(input.placeholder).width,
            availableWidth: input.clientWidth - parseFloat(style.getPropertyValue('padding-left'))
              - parseFloat(style.getPropertyValue('padding-right')),
          }
        })
        expect(textWidth, 'El placeholder completo debe caber en el buscador').toBeGreaterThan(0)
        expect(textWidth, 'El placeholder completo debe caber en el buscador').toBeLessThanOrEqual(availableWidth)
      }

      // 3. Mi Cuenta - Datos Personales (#274)
      await page.goto('/mi-cuenta/datos')
      await expect(page.getByRole('heading', { name: 'Mis datos', exact: true })).toBeVisible()
      await assertNoHorizontalScroll(page, `Mi Cuenta Datos a ${width}px`)

      // 4. Mi Cuenta - Historial de Pedidos (#274)
      await page.goto('/mi-cuenta/pedidos')
      await expect(page.getByRole('heading', { name: 'Mis pedidos', exact: true })).toBeVisible()
      await assertNoHorizontalScroll(page, `Historial de Pedidos a ${width}px`)

      // Validar área táctil del botón Cerrar Sesión
      const menuToggle = page.getByRole('button', { name: 'Menú de navegación de cuenta' })
      if (await menuToggle.isVisible()) {
        await menuToggle.click()
      }
      const logoutBtn = page.getByRole('button', { name: 'Cerrar sesión', exact: true })
      await expect(logoutBtn).toBeVisible()
      const logoutBox = await logoutBtn.boundingBox()
      expect(logoutBox).not.toBeNull()
      if (logoutBox) {
        expect(logoutBox.height).toBeGreaterThanOrEqual(44)
        expect(logoutBox.width).toBeGreaterThanOrEqual(44)
      }
      if (await menuToggle.isVisible()) {
        await assertNoHorizontalScroll(page, `Menú de cuenta desplegado a ${width}px`)
        await menuToggle.click()
      }
    })

    test(`Cabecera móvil, menú desplegable y botón Volver a ${width}px`, async ({ page }) => {
      await loginClient(page)
      const origin = '/catalogo?busqueda=Producto'
      await page.goto(origin)
      await expect(page.getByRole('heading', { name: 'Catálogo', exact: true })).toBeVisible()
      const publicMenu = page.getByRole('button', { name: 'Menú principal', exact: true })
      if (await publicMenu.isVisible()) await publicMenu.click()
      const accountLink = page.getByRole('banner').getByRole('link', { name: 'Mi cuenta', exact: true })
      await expect(accountLink).toBeVisible()
      await accountLink.click()
      await expect(page).toHaveURL('/mi-cuenta')

      if (width < 768) {
        // Validar área táctil del botón Volver (>= 44x44px)
        const backBtn = page.getByRole('button', { name: 'Volver', exact: true })
        await expect(backBtn).toBeVisible()
        const backBox = await backBtn.boundingBox()
        expect(backBox).not.toBeNull()
        if (backBox) {
          expect(backBox.height).toBeGreaterThanOrEqual(44)
          expect(backBox.width).toBeGreaterThanOrEqual(44)
        }

        // Validar despliegue del menú móvil con accesibilidad y navegación
        const menuToggle = page.getByRole('button', { name: 'Menú de navegación de cuenta' })
        await expect(menuToggle).toBeVisible()
        await menuToggle.click()

        const accountMenu = page.getByRole('navigation', { name: 'Menú de navegación de cuenta' })
        await expect(accountMenu.getByRole('link', { name: 'Pedidos sin comprobante', exact: true })).toBeVisible()
        await accountMenu.getByRole('link', { name: 'Historial de pedidos', exact: true }).click()
        await expect(page).toHaveURL('/mi-cuenta/pedidos')
        await expect(accountMenu).toBeHidden()
        await menuToggle.click()

        // Al hacer clic en un enlace del menú, debe cerrar el menú y navegar
        await accountMenu.getByRole('link', { name: 'Mis datos', exact: true }).click()
        await expect(page).toHaveURL('/mi-cuenta/datos')
        await expect(accountMenu).toBeHidden()

        // El regreso conserva la búsqueda de origen.
        await backBtn.click()
        await expect(page).toHaveURL(origin)
      }
    })
  })
}
