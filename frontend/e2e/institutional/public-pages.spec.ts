import { expect, test } from '@playwright/test'

const faq = { path: '/ayuda', title: 'Preguntas frecuentes' }
const about = { path: '/sobre-nosotros', title: 'Ferrepatagonia Industrial' }

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 401, json: { message: 'No autenticado' } }),
  )
})

for (const width of [360, 390, 768, 1280]) {
  test(`las páginas públicas son accesibles y no desbordan a ${width} px`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      const source = message.location().url
      const path = new URL(source || page.url()).pathname
      const expectedGuestResponse = message.text().includes('401')
        && path === '/api/auth/me'
      // Vite's development inspector is absent from the production build.
      const devInspectorError = message.text().includes('404')
        && path === '/@id/virtual:vue-inspector-path:load.js'
      if (!expectedGuestResponse && !devInspectorError) {
        errors.push(`${message.text()} (${source})`)
      }
    })

    await page.setViewportSize({ width, height: 800 })
    await page.emulateMedia({ reducedMotion: 'reduce' })

    for (const destination of [faq, about]) {
      await page.goto(destination.path)
      await expect(page).toHaveURL(new RegExp(`${destination.path}$`))
      const main = page.getByRole('main')
      await expect(main.getByRole('heading', { level: 1 })).toHaveText(destination.title)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(main.getByRole('link').first()).toBeVisible()
      expect(await page.locator('html').evaluate(
        (root) => root.scrollWidth <= root.clientWidth,
      )).toBe(true)
    }

    expect(errors).toEqual([])
  })
}

test('el menú y el pie enlazan ambas páginas y sus accesos llevan a destinos reales', async ({ page }) => {
  await page.route('**/api/categorias', (route) =>
    route.fulfill({ json: { data: { categorias: [] } } }),
  )
  await page.route('**/api/catalogo?*', (route) =>
    route.fulfill({
      json: {
        data: {
          productos: [],
          pagination: {
            page: 1, limit: 12, total: 0, totalPages: 0, hasNext: false, hasPrevious: false,
          },
        },
      },
    }),
  )

  await page.goto(about.path)
  const menu = page.getByRole('navigation', { name: 'Menú principal' })
  const footer = page.getByRole('navigation', { name: 'Institucional' })
  const main = page.getByRole('main')

  await menu.getByRole('link', { name: faq.title }).click()
  await expect(page).toHaveURL(/\/ayuda$/)
  await footer.getByRole('link', { name: 'Quiénes somos' }).click()
  await expect(page).toHaveURL(/\/sobre-nosotros$/)
  await footer.getByRole('link', { name: faq.title }).click()
  await expect(page).toHaveURL(/\/ayuda$/)
  await menu.getByRole('link', { name: 'Quiénes somos' }).click()
  await expect(page).toHaveURL(/\/sobre-nosotros$/)
  await expect(main.getByRole('link', { name: 'Registrar una empresa' })).toHaveAttribute('href', '/registro')
  await main.getByRole('link', { name: 'Ver catálogo' }).click()
  await expect(page).toHaveURL(/\/catalogo$/)
  await expect(page.getByRole('heading', { name: 'Catálogo', exact: true })).toBeVisible()

  await menu.getByRole('link', { name: 'Quiénes somos' }).click()
  await main.getByRole('link', { name: 'Iniciar sesión' }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test('los acordeones se pueden abrir y cerrar con el teclado', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto(faq.path)
  const question = page.locator('summary').filter({ hasText: '¿Cómo encuentro un producto?' })
  const answer = page.getByText('Buscá por nombre o código en el buscador del sitio.', { exact: false })

  await expect(question).toBeVisible()
  await expect(answer).toBeHidden()

  // Enfocamos el título de la vista en lugar del navbar
  await page.getByRole('heading', { level: 1, name: faq.title }).focus()
  await page.keyboard.press('Tab')

  await expect(question).toBeFocused()
  await expect(question).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Enter')
  await expect(answer).toBeVisible()
  expect(await page.locator('html').evaluate(
    (root) => root.scrollWidth <= root.clientWidth,
  )).toBe(true)
  await page.keyboard.press('Space')
  await expect(answer).toBeHidden()
})
